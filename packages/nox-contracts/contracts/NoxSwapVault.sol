// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// NoxSwapVault is a dark pool over Uniswap V3. Users deposit a public token
// pair, then submit swap intents whose amount AND direction are encrypted
// (Nox handles computed inside a TEE). At the end of an epoch only the two
// aggregate sums are made publicly decryptable; opposing flow is crossed
// internally at the pool's spot price and only the net residual is traded
// through the unmodified Uniswap router. Outputs are credited back to each
// participant's confidential balance pro-rata, so no observer learns who
// swapped, in which direction, or how much.

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

/// @dev Minimal Uniswap V3 interfaces, declared locally so the workspace does
/// not need the v3-periphery package (whose pragma predates this toolchain).
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(
        ExactInputSingleParams calldata params
    ) external payable returns (uint256 amountOut);
}

interface IUniswapV3Pool {
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );

    function token0() external view returns (address);
}

contract NoxSwapVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- config

    IERC20 public immutable token0; // e.g. WETH
    IERC20 public immutable token1; // e.g. USDC
    ISwapRouter02 public immutable router;
    IUniswapV3Pool public immutable pool;
    uint24 public immutable poolFee;
    // Uniswap sorts pool tokens by address; the vault's pair order need not
    // match. When they differ, slot0's price must be applied inverted.
    bool public immutable vaultAlignedWithPool;

    // -------------------------------------------------------------- balances

    // Confidential per-user balances. Deposits are public at the ERC-20 edge
    // (unavoidable); everything after the deposit is hidden.
    mapping(address => euint256) private _balance0;
    mapping(address => euint256) private _balance1;

    // ---------------------------------------------------------------- epochs

    struct Epoch {
        address[] participants;
        // Encrypted per-user contribution of each side. A user selling token0
        // has in1 == enc(0) and vice-versa, so the direction never leaks.
        mapping(address => euint256) in0;
        mapping(address => euint256) in1;
        euint256 totalIn0;
        euint256 totalIn1;
        bool closed;
        bool settled;
        // Public clearing results (aggregates only), set at settlement.
        uint256 revealedIn0;
        uint256 revealedIn1;
        uint256 out1PerSide0; // total token1 paid to token0-sellers
        uint256 out0PerSide1; // total token0 paid to token1-sellers
    }

    uint256 public currentEpochId;
    mapping(uint256 => Epoch) private _epochs;

    // ---------------------------------------------------------------- events

    event Deposited(address indexed user, address indexed token, uint256 amount);
    event Withdrawn(address indexed user, address indexed token, uint256 amount);
    event IntentSubmitted(uint256 indexed epochId, address indexed user);
    event EpochClosed(uint256 indexed epochId, bytes32 totalIn0Handle, bytes32 totalIn1Handle);
    event EpochSettled(
        uint256 indexed epochId,
        uint256 totalIn0,
        uint256 totalIn1,
        uint256 residualSwapped,
        bool residualIsToken0
    );

    error EpochNotOpen();
    error EpochNotClosed();
    error AlreadySettled();
    error NothingToSettle();

    constructor(IERC20 token0_, IERC20 token1_, ISwapRouter02 router_, IUniswapV3Pool pool_, uint24 poolFee_) {
        token0 = token0_;
        token1 = token1_;
        router = router_;
        pool = pool_;
        poolFee = poolFee_;
        vaultAlignedWithPool = pool_.token0() == address(token0_);
        _openEpoch();
    }

    // ------------------------------------------------------ deposit/withdraw

    /// @notice Deposit `amount` of `token` (token0 or token1). The transfer is
    /// public but the resulting vault balance handle is confidential.
    function deposit(IERC20 token, uint256 amount) external nonReentrant {
        require(address(token) == address(token0) || address(token) == address(token1), "unsupported token");
        token.safeTransferFrom(msg.sender, address(this), amount);

        mapping(address => euint256) storage bal = address(token) == address(token0) ? _balance0 : _balance1;
        euint256 credited = Nox.toEuint256(amount);
        if (euint256.unwrap(bal[msg.sender]) == bytes32(0)) {
            bal[msg.sender] = credited;
        } else {
            bal[msg.sender] = Nox.add(bal[msg.sender], credited);
        }
        _persistBalanceAcl(msg.sender);
        emit Deposited(msg.sender, address(token), amount);
    }

    /// @dev Pending two-phase withdrawal: the encrypted requested amount
    /// (clamped to the balance) is made publicly decryptable — revealing only
    /// what the ERC-20 transfer would reveal anyway — and finalised with the
    /// gateway proof. The running balance itself is never disclosed.
    struct PendingWithdrawal {
        IERC20 token;
        euint256 amount;
        bool active;
    }
    mapping(address => PendingWithdrawal) private _pendingWithdrawals;

    event WithdrawalRequested(address indexed user, address indexed token, bytes32 amountHandle);

    /// @notice Phase 1: request a withdrawal of an encrypted `amount` of `token`.
    /// If the balance is insufficient the effective withdrawal becomes enc(0)
    /// (no revert — a revert would leak the balance comparison).
    function requestWithdraw(
        IERC20 token,
        externalEuint256 amountHandle,
        bytes calldata amountProof
    ) external nonReentrant {
        require(address(token) == address(token0) || address(token) == address(token1), "unsupported token");
        require(!_pendingWithdrawals[msg.sender].active, "pending withdrawal exists");
        mapping(address => euint256) storage bal = address(token) == address(token0) ? _balance0 : _balance1;

        euint256 amount = Nox.fromExternal(amountHandle, amountProof);
        (ebool ok, euint256 updated) = Nox.safeSub(_userBal(token, msg.sender), amount);
        euint256 effective = Nox.select(ok, amount, Nox.toEuint256(0));
        bal[msg.sender] = Nox.select(ok, updated, bal[msg.sender]);
        _persistBalanceAcl(msg.sender);

        _pendingWithdrawals[msg.sender] = PendingWithdrawal({token: token, amount: effective, active: true});
        Nox.allowThis(effective);
        Nox.allowPublicDecryption(effective);
        emit WithdrawalRequested(msg.sender, address(token), euint256.unwrap(effective));
    }

    /// @notice Phase 2: finalise with the decryption proof for the requested
    /// amount handle; the contract verifies it on-chain and pays out.
    function finalizeWithdraw(bytes calldata decryptionProof) external nonReentrant {
        PendingWithdrawal memory pending = _pendingWithdrawals[msg.sender];
        require(pending.active, "no pending withdrawal");
        delete _pendingWithdrawals[msg.sender];

        uint256 amount = Nox.publicDecrypt(pending.amount, decryptionProof);
        if (amount > 0) {
            pending.token.safeTransfer(msg.sender, amount);
        }
        emit Withdrawn(msg.sender, address(pending.token), amount);
    }

    // ---------------------------------------------------------------- intents

    /// @notice Submit an encrypted swap intent for the current epoch.
    /// @param amountHandle Encrypted input amount (client-side encrypted).
    /// @param amountProof  Proof binding the encrypted amount to this contract.
    /// @param dirHandle    Encrypted direction: true = sell token0 for token1.
    /// @param dirProof     Proof for the encrypted direction.
    /// @dev The intent is debited from the confidential balance immediately.
    /// If the balance is insufficient the effective intent becomes enc(0) —
    /// no revert, because reverting would leak the balance comparison.
    function submitIntent(
        externalEuint256 amountHandle,
        bytes calldata amountProof,
        externalEuint256 dirHandle,
        bytes calldata dirProof
    ) external nonReentrant {
        Epoch storage epoch = _epochs[currentEpochId];
        if (epoch.closed) revert EpochNotOpen();

        euint256 amount = Nox.fromExternal(amountHandle, amountProof);
        // Direction arrives as an encrypted uint (0 or 1); normalise to ebool.
        euint256 dirRaw = Nox.fromExternal(dirHandle, dirProof);
        ebool sellToken0 = Nox.gt(dirRaw, Nox.toEuint256(0));

        euint256 zero = Nox.toEuint256(0);

        // Side-0 leg: only meaningful if selling token0 AND balance covers it.
        (ebool ok0, euint256 newBal0) = Nox.safeSub(_userBal0(msg.sender), amount);
        euint256 eff0 = Nox.select(sellToken0, Nox.select(ok0, amount, zero), zero);
        _balance0[msg.sender] = Nox.select(sellToken0, Nox.select(ok0, newBal0, _userBal0(msg.sender)), _userBal0(msg.sender));

        // Side-1 leg: only meaningful if selling token1 AND balance covers it.
        (ebool ok1, euint256 newBal1) = Nox.safeSub(_userBal1(msg.sender), amount);
        euint256 eff1 = Nox.select(sellToken0, zero, Nox.select(ok1, amount, zero));
        _balance1[msg.sender] = Nox.select(sellToken0, _userBal1(msg.sender), Nox.select(ok1, newBal1, _userBal1(msg.sender)));

        if (euint256.unwrap(epoch.in0[msg.sender]) == bytes32(0)) {
            epoch.participants.push(msg.sender);
            epoch.in0[msg.sender] = eff0;
            epoch.in1[msg.sender] = eff1;
        } else {
            epoch.in0[msg.sender] = Nox.add(epoch.in0[msg.sender], eff0);
            epoch.in1[msg.sender] = Nox.add(epoch.in1[msg.sender], eff1);
        }
        epoch.totalIn0 = Nox.add(_orZero(epoch.totalIn0), eff0);
        epoch.totalIn1 = Nox.add(_orZero(epoch.totalIn1), eff1);

        // Persist ACLs: the contract computes on these next epoch phase.
        Nox.allowThis(epoch.in0[msg.sender]);
        Nox.allowThis(epoch.in1[msg.sender]);
        Nox.allowThis(epoch.totalIn0);
        Nox.allowThis(epoch.totalIn1);
        _persistBalanceAcl(msg.sender);

        emit IntentSubmitted(currentEpochId, msg.sender);
    }

    // ------------------------------------------------------------ settlement

    /// @notice Close the current epoch: the two aggregate sums (and nothing
    /// else) become publicly decryptable, and a fresh epoch opens for intents.
    function closeEpoch() external {
        Epoch storage epoch = _epochs[currentEpochId];
        if (epoch.closed) revert EpochNotOpen();
        if (epoch.participants.length == 0) revert NothingToSettle();
        epoch.closed = true;

        Nox.allowPublicDecryption(epoch.totalIn0);
        Nox.allowPublicDecryption(epoch.totalIn1);
        emit EpochClosed(
            currentEpochId,
            euint256.unwrap(epoch.totalIn0),
            euint256.unwrap(epoch.totalIn1)
        );
        currentEpochId += 1;
        _openEpoch();
    }

    /// @notice Settle a closed epoch. Anyone may call with the two decryption
    /// proofs for the aggregate sums (fetched from the Nox gateway).
    /// Opposing flow is crossed at the pool spot price; only the residual is
    /// swapped through Uniswap. Proceeds are credited pro-rata to hidden
    /// balances at a uniform clearing price.
    function settleEpoch(
        uint256 epochId,
        bytes calldata proofIn0,
        bytes calldata proofIn1
    ) external nonReentrant {
        Epoch storage epoch = _epochs[epochId];
        if (!epoch.closed) revert EpochNotClosed();
        if (epoch.settled) revert AlreadySettled();
        epoch.settled = true;

        uint256 t0 = Nox.publicDecrypt(epoch.totalIn0, proofIn0);
        uint256 t1 = Nox.publicDecrypt(epoch.totalIn1, proofIn1);
        epoch.revealedIn0 = t0;
        epoch.revealedIn1 = t1;
        if (t0 == 0 && t1 == 0) revert NothingToSettle();

        // Value of the token1 side expressed in token0 units at pool spot.
        uint256 t1InToken0 = _convert1to0(t1);

        uint256 out1ForSide0; // token1 owed to sellers of token0
        uint256 out0ForSide1; // token0 owed to sellers of token1
        uint256 residual;
        bool residualIsToken0;

        if (t0 > t1InToken0) {
            // Net sellers of token0: cross the covered part, swap the rest.
            residual = t0 - t1InToken0;
            residualIsToken0 = true;
            uint256 swappedOut1 = 0;
            if (residual > 0) {
                token0.forceApprove(address(router), residual);
                swappedOut1 = router.exactInputSingle(
                    ISwapRouter02.ExactInputSingleParams({
                        tokenIn: address(token0),
                        tokenOut: address(token1),
                        fee: poolFee,
                        recipient: address(this),
                        amountIn: residual,
                        amountOutMinimum: 0, // epoch batching is the MEV guard; hardening: TWAP bound
                        sqrtPriceLimitX96: 0
                    })
                );
            }
            // Side-0 sellers share the crossed token1 plus the swap output.
            out1ForSide0 = t1 + swappedOut1;
            // Side-1 sellers are fully crossed at spot.
            out0ForSide1 = t1InToken0;
        } else {
            // Net sellers of token1 (or perfectly crossed).
            uint256 t0InToken1 = _convert0to1(t0);
            residual = t1 - t0InToken1;
            residualIsToken0 = false;
            uint256 swappedOut0 = 0;
            if (residual > 0) {
                token1.forceApprove(address(router), residual);
                swappedOut0 = router.exactInputSingle(
                    ISwapRouter02.ExactInputSingleParams({
                        tokenIn: address(token1),
                        tokenOut: address(token0),
                        fee: poolFee,
                        recipient: address(this),
                        amountIn: residual,
                        amountOutMinimum: 0,
                        sqrtPriceLimitX96: 0
                    })
                );
            }
            out0ForSide1 = t0 + swappedOut0;
            out1ForSide0 = t0InToken1;
        }

        epoch.out1PerSide0 = out1ForSide0;
        epoch.out0PerSide1 = out0ForSide1;

        // Pro-rata confidential distribution at the uniform clearing price:
        // credit_i = in_i * totalOut / totalIn, computed on ciphertext so the
        // individual shares never appear in plaintext.
        for (uint256 i = 0; i < epoch.participants.length; i++) {
            address user = epoch.participants[i];
            if (t0 > 0 && out1ForSide0 > 0) {
                euint256 share1 = Nox.div(
                    Nox.mul(epoch.in0[user], Nox.toEuint256(out1ForSide0)),
                    Nox.toEuint256(t0)
                );
                _balance1[user] = Nox.add(_userBal1(user), share1);
            }
            if (t1 > 0 && out0ForSide1 > 0) {
                euint256 share0 = Nox.div(
                    Nox.mul(epoch.in1[user], Nox.toEuint256(out0ForSide1)),
                    Nox.toEuint256(t1)
                );
                _balance0[user] = Nox.add(_userBal0(user), share0);
            }
            _persistBalanceAcl(user);
        }

        emit EpochSettled(epochId, t0, t1, residual, residualIsToken0);
    }

    // ------------------------------------------------------------ visibility

    /// @notice Handle of the caller's confidential balances (decryptable only
    /// by the owner and any viewer they add).
    function balanceHandles(address user) external view returns (bytes32 h0, bytes32 h1) {
        h0 = euint256.unwrap(_balance0[user]);
        h1 = euint256.unwrap(_balance1[user]);
    }

    /// @notice Selective disclosure: let `viewer` (e.g. an auditor) decrypt
    /// the caller's balance handles without making them public.
    function grantAuditorView(address viewer) external {
        if (euint256.unwrap(_balance0[msg.sender]) != bytes32(0)) {
            Nox.addViewer(_balance0[msg.sender], viewer);
        }
        if (euint256.unwrap(_balance1[msg.sender]) != bytes32(0)) {
            Nox.addViewer(_balance1[msg.sender], viewer);
        }
    }

    function epochInfo(
        uint256 epochId
    )
        external
        view
        returns (
            uint256 participantCount,
            bool closed,
            bool settled,
            uint256 revealedIn0,
            uint256 revealedIn1,
            uint256 out1PerSide0,
            uint256 out0PerSide1
        )
    {
        Epoch storage e = _epochs[epochId];
        return (
            e.participants.length,
            e.closed,
            e.settled,
            e.revealedIn0,
            e.revealedIn1,
            e.out1PerSide0,
            e.out0PerSide1
        );
    }

    function epochTotalsHandles(uint256 epochId) external view returns (bytes32 h0, bytes32 h1) {
        Epoch storage e = _epochs[epochId];
        h0 = euint256.unwrap(e.totalIn0);
        h1 = euint256.unwrap(e.totalIn1);
    }

    // -------------------------------------------------------------- internal

    function _openEpoch() internal {
        Epoch storage epoch = _epochs[currentEpochId];
        epoch.totalIn0 = Nox.toEuint256(0);
        epoch.totalIn1 = Nox.toEuint256(0);
        Nox.allowThis(epoch.totalIn0);
        Nox.allowThis(epoch.totalIn1);
    }

    function _userBal(IERC20 token, address user) internal returns (euint256) {
        return address(token) == address(token0) ? _userBal0(user) : _userBal1(user);
    }

    function _userBal0(address user) internal returns (euint256) {
        if (euint256.unwrap(_balance0[user]) == bytes32(0)) {
            _balance0[user] = Nox.toEuint256(0);
        }
        return _balance0[user];
    }

    function _userBal1(address user) internal returns (euint256) {
        if (euint256.unwrap(_balance1[user]) == bytes32(0)) {
            _balance1[user] = Nox.toEuint256(0);
        }
        return _balance1[user];
    }

    function _orZero(euint256 v) internal returns (euint256) {
        return euint256.unwrap(v) == bytes32(0) ? Nox.toEuint256(0) : v;
    }

    function _persistBalanceAcl(address user) internal {
        Nox.allowThis(_balance0[user]);
        Nox.allow(_balance0[user], user);
        Nox.allowThis(_balance1[user]);
        Nox.allow(_balance1[user], user);
    }

    /// @dev Spot conversions between the vault pair's raw units using the
    /// pool's sqrtPriceX96, honouring pool token ordering. price(pool t1 per
    /// pool t0) = sqrtP^2 / 2^192.
    function _convert0to1(uint256 amount0) internal view returns (uint256) {
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        if (priceX192 == 0) return 0;
        return
            vaultAlignedWithPool
                ? _mulDiv(amount0, priceX192, 1 << 192)
                : _mulDiv(amount0, 1 << 192, priceX192);
    }

    function _convert1to0(uint256 amount1) internal view returns (uint256) {
        (uint160 sqrtPriceX96, , , , , , ) = pool.slot0();
        uint256 priceX192 = uint256(sqrtPriceX96) * uint256(sqrtPriceX96);
        if (priceX192 == 0) return 0;
        return
            vaultAlignedWithPool
                ? _mulDiv(amount1, 1 << 192, priceX192)
                : _mulDiv(amount1, priceX192, 1 << 192);
    }

    /// @dev Floor mulDiv without full-width math; sufficient for testnet
    /// magnitudes (a * b fits 512 bits only when values are extreme — we keep
    /// demo amounts far below that and document the limit).
    function _mulDiv(uint256 a, uint256 b, uint256 denominator) internal pure returns (uint256) {
        return (a * b) / denominator;
    }
}

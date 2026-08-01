// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// A piggy bank is a simple savings container: anyone can put money in
// and only the owner can take it out. This version keeps the balance
// encrypted so nobody can see how much is inside. It tracks an encrypted
// number only - deposits and withdrawals move no real ETH or tokens.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract ConfidentialPiggyBank is Ownable {
    euint256 public balance;

    constructor() Ownable(msg.sender) {
        balance = Nox.toEuint256(0);
        Nox.allowThis(balance);
        Nox.allow(balance, owner());
    }

    /// @notice Adds an encrypted `amount` to the piggy bank. Anyone can deposit.
    /// @dev Uses `safeAdd` so a deposit that would overflow the balance is ignored
    /// (balance left unchanged) rather than silently wrapping past 2**256 - 1.
    function deposit(externalEuint256 inputHandle, bytes calldata inputProof) external {
        euint256 amount = Nox.fromExternal(inputHandle, inputProof);
        (ebool success, euint256 updated) = Nox.safeAdd(balance, amount);
        balance = Nox.select(success, updated, balance);
        Nox.allowThis(balance);
        Nox.allow(balance, owner());
    }

    /// @notice Removes an encrypted `amount` from the piggy bank. Only the owner can withdraw.
    /// @dev Uses `safeSub` so a withdrawal larger than the balance is ignored (balance
    /// left unchanged) rather than underflowing to a huge encrypted value. The overflow
    /// flag is itself encrypted, so we can't `revert` on it; `select` keeps the old
    /// balance when the operation would underflow. This is the same clamp pattern the
    /// ERC-7984 reference implementation uses in `_update`.
    function withdraw(externalEuint256 inputHandle, bytes calldata inputProof) external onlyOwner {
        euint256 amount = Nox.fromExternal(inputHandle, inputProof);
        (ebool success, euint256 updated) = Nox.safeSub(balance, amount);
        balance = Nox.select(success, updated, balance);
        Nox.allowThis(balance);
        Nox.allow(balance, owner());
    }
}

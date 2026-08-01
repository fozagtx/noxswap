// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// A confidential fungible token (ERC-7984): balances, transfers and the total
// supply are all encrypted, so no on-chain observer can tell who holds how much
// or how large any transfer is. Transfers, operators and balance/supply views
// come from the ERC7984 reference implementation; this contract only adds an
// owner-gated mint and a self-service burn, both taking encrypted amounts.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC7984} from "@iexec-nox/nox-confidential-contracts/contracts/token/ERC7984.sol";
import {Nox, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract ConfidentialToken is ERC7984, Ownable {
    constructor(
        string memory name,
        string memory symbol,
        string memory contractURI
    ) ERC7984(name, symbol, contractURI) Ownable(msg.sender) {}

    /**
     * @notice Mints an encrypted `amount` of tokens to `to`. Only the owner can mint.
     * @param to The recipient of the newly minted tokens.
     * @param encryptedAmount The amount to mint, encrypted client-side and bound to this contract.
     * @param inputProof The proof attesting the caller may use `encryptedAmount`.
     * @return minted The amount actually minted (encrypted; less than requested on overflow).
     */
    function mint(
        address to,
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external onlyOwner returns (euint256 minted) {
        minted = _mint(to, Nox.fromExternal(encryptedAmount, inputProof));
    }

    /**
     * @notice Burns an encrypted `amount` of tokens from the caller's own balance.
     * @param encryptedAmount The amount to burn, encrypted client-side and bound to this contract.
     * @param inputProof The proof attesting the caller may use `encryptedAmount`.
     * @return burned The amount actually burned (encrypted; less than requested on underflow).
     */
    function burn(
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint256 burned) {
        burned = _burn(msg.sender, Nox.fromExternal(encryptedAmount, inputProof));
    }

    /**
     * @dev The ERC7984 optimized mint/burn primitives persist this contract's ACL on the
     * updated balances but not on the new total-supply handle. Without that grant, the next
     * operation that reads the total supply (a second mint, or any burn) reverts because the
     * contract is no longer allowed to use the handle. Re-granting it after every update keeps
     * mint and burn repeatable.
     */
    function _update(
        address from,
        address to,
        euint256 amount
    ) internal override returns (euint256 transferred) {
        transferred = super._update(from, to, amount);
        Nox.allowThis(confidentialTotalSupply());
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// A sealed-bid auction: bidders submit encrypted bids and nobody -
// not even the other bidders - can see how much anyone offered. The
// contract keeps a running encrypted maximum, so only the auctioneer
// (the owner) can decrypt the winning amount while bidding is open, and
// can later reveal it to everyone by closing the auction.

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Nox, ebool, euint256, externalEuint256} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract ConfidentialAuction is Ownable {
    euint256 public highestBid;
    bool public closed;

    /// @dev A bid was submitted after the auction was closed.
    error AuctionClosed();

    constructor() Ownable(msg.sender) {
        highestBid = Nox.toEuint256(0);
        Nox.allowThis(highestBid);
        Nox.allow(highestBid, owner());
    }

    /// @notice Submits an encrypted bid. Anyone can bid while the auction is open.
    function bid(externalEuint256 inputHandle, bytes calldata inputProof) external {
        require(!closed, AuctionClosed());
        euint256 amount = Nox.fromExternal(inputHandle, inputProof);

        // Keep whichever is larger without ever revealing either value:
        // isHigher is an encrypted boolean, select picks the branch in the TEE.
        ebool isHigher = Nox.gt(amount, highestBid);
        highestBid = Nox.select(isHigher, amount, highestBid);

        Nox.allowThis(highestBid);
        Nox.allow(highestBid, owner());
    }

    /// @notice Closes bidding and makes the winning bid publicly decryptable by anyone. Only the owner.
    /// @dev Reveals the winning *amount* only. The contract never records which address
    /// submitted the highest bid, so the winner's identity is out of scope for this example.
    function closeAndReveal() external onlyOwner {
        closed = true;
        Nox.allowPublicDecryption(highestBid);
    }
}

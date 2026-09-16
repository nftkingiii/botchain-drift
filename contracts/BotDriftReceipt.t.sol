// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import './BotDriftReceipt.sol';

contract BotDriftReceiptTest {
    function testConstructorAndAnchor() public {
        BotDriftReceipt receipt = new BotDriftReceipt(968, 'bot-drift-receipt-v1');
        require(receipt.targetChainId() == 968, 'chain id mismatch');
        require(keccak256(bytes(receipt.schemaVersion())) == keccak256(bytes('bot-drift-receipt-v1')), 'schema mismatch');
        receipt.anchor(bytes32(uint256(1)), bytes32(uint256(2)));
        (address author, bytes32 rehearsalId, bytes32 artifactHash, uint64 createdAt) = receipt.receipts(bytes32(uint256(1)));
        require(author == address(this), 'author mismatch');
        require(rehearsalId == bytes32(uint256(1)), 'rehearsal mismatch');
        require(artifactHash == bytes32(uint256(2)), 'artifact mismatch');
        require(createdAt > 0, 'timestamp missing');
    }
}

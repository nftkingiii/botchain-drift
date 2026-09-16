// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BotDriftReceipt {
    uint256 public immutable targetChainId;
    string public schemaVersion;

    struct Receipt {
        address author;
        bytes32 rehearsalId;
        bytes32 artifactHash;
        uint64 createdAt;
    }

    mapping(bytes32 => Receipt) public receipts;

    event ReceiptAnchored(bytes32 indexed rehearsalId, bytes32 indexed artifactHash, address indexed author, uint64 createdAt);

    constructor(uint256 chainId, string memory version) {
        require(chainId == 968, 'wrong target chain');
        require(bytes(version).length > 0, 'schema version required');
        targetChainId = chainId;
        schemaVersion = version;
    }

    function anchor(bytes32 rehearsalId, bytes32 artifactHash) external {
        require(receipts[rehearsalId].createdAt == 0, 'receipt already anchored');
        receipts[rehearsalId] = Receipt(msg.sender, rehearsalId, artifactHash, uint64(block.timestamp));
        emit ReceiptAnchored(rehearsalId, artifactHash, msg.sender, uint64(block.timestamp));
    }
}

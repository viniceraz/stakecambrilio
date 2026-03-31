// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Chainlink VRF v2.5 — importable from Remix via npm
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title  CambrilioFlip
 * @notice P2P coin-flip betting with real NFT escrow on Base.
 *
 * Security properties
 * ───────────────────
 * ✔ Checks-Effects-Interactions order on every write function.
 * ✔ Custom reentrancy guard on all state-mutating paths, including the
 *   Chainlink VRF callback.
 * ✔ Verifiable randomness via Chainlink VRF v2.5 (not block.prevrandao).
 * ✔ 24-hour timeout on Active rooms so escrowed NFTs are never locked
 *   permanently if participants go silent or VRF is delayed.
 * ✔ Duplicate-tokenId check on createRoom / joinRoom.
 */

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

contract CambrilioFlip is VRFConsumerBaseV2Plus {

    // ─── CONSTANTS ───────────────────────────────────────────────
    uint8   public constant HEADS        = 0;
    uint8   public constant TAILS        = 1;
    uint256 public constant FLIP_TIMEOUT = 24 hours;

    // ─── CHAINLINK VRF CONFIG ────────────────────────────────────
    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint32  public constant  CALLBACK_GAS_BASE      = 200_000;  // overhead fixo do callback
    uint32  public constant  CALLBACK_GAS_PER_NFT   = 65_000;   // por transferFrom (creator + challenger)
    uint16  public constant  REQUEST_CONFIRMATIONS = 3;

    // ─── PROTOCOL FEE ────────────────────────────────────────────
    uint256 public constant  PROTOCOL_FEE           = 0.00024 ether; // por jogador, por sala

    // ─── STATE ───────────────────────────────────────────────────
    IERC721 public immutable nftContract;
    bool    public paused;

    uint256 public roomCount;

    // Status flow:
    //   Waiting ──[join]──► Active ──[flip()]──► Flipping ──[VRF]──► Complete
    //   Waiting ──[cancel]──► Cancelled
    //   Active / Flipping ──[timeout]──► Expired
    enum Status { Waiting, Active, Flipping, Complete, Cancelled, Expired }

    struct Room {
        address   creator;
        address   challenger;
        uint8     nftCount;
        uint8     creatorChoice;   // 0=heads 1=tails
        uint8     coinResult;      // only valid when Complete
        Status    status;
        address   winner;
        uint256   createdAt;
        uint256   activatedAt;     // set when challenger joins
        uint256   vrfRequestId;    // non-zero once flip() is called
        uint256   ethAmount;       // ETH each player bets (0 = NFT-only room)
        string    name;            // optional room name set by creator
        uint256[] creatorTokenIds;
        uint256[] challengerTokenIds;
    }

    mapping(uint256 => Room)    private _rooms;
    mapping(uint256 => uint256) public  vrfRequestToRoom; // requestId → roomId

    uint256 public pendingFees; // ETH acumulado de taxas (5% de cada aposta)

    // ─── EVENTS ──────────────────────────────────────────────────
    event RoomCreated(
        uint256 indexed roomId,
        address indexed creator,
        uint256[]       tokenIds,
        uint8           choice
    );
    event RoomJoined(
        uint256 indexed roomId,
        address indexed challenger,
        uint256[]       tokenIds
    );
    event FlipRequested(uint256 indexed roomId, uint256 indexed requestId);
    event FlipResult(
        uint256 indexed roomId,
        uint8           result,
        address indexed winner,
        uint256[]       winnerTokenIds
    );
    event RoomCancelled(uint256 indexed roomId, address indexed creator);
    event RoomExpired(uint256 indexed roomId);

    // ─── REENTRANCY GUARD ────────────────────────────────────────
    bool private _locked;

    modifier noReentrancy() {
        require(!_locked, "Reentrant call");
        _locked = true;
        _;
        _locked = false;
    }

    modifier notPaused() {
        require(!paused, "Contract paused");
        _;
    }

    // ─── CONSTRUCTOR ─────────────────────────────────────────────
    /**
     * @param _nftContract     Cambrilio ERC-721 address.
     * @param _vrfCoordinator  Chainlink VRF Coordinator v2.5 on Base.
     *                         Get from: https://docs.chain.link/vrf/v2-5/supported-networks
     * @param _keyHash         Gas-lane key hash for Base.
     *                         Get from the same page above.
     * @param _subscriptionId  Your VRF subscription ID from https://vrf.chain.link
     */
    constructor(
        address _nftContract,
        address _vrfCoordinator,
        bytes32 _keyHash,
        uint256 _subscriptionId
    ) VRFConsumerBaseV2Plus(_vrfCoordinator) {
        nftContract    = IERC721(_nftContract);
        keyHash        = _keyHash;
        subscriptionId = _subscriptionId;
    }

    // ─── WRITE FUNCTIONS ─────────────────────────────────────────

    /**
     * @notice Create a bet room. Call nftContract.setApprovalForAll(address(this), true) first.
     * @param tokenIds  Cambrilio token IDs to wager (1–20, no duplicates).
     * @param choice    0 = HEADS, 1 = TAILS.
     */
    function createRoom(uint256[] calldata tokenIds, uint8 choice, string calldata name)
        external
        payable
        notPaused
        noReentrancy
    {
        // ── Checks ──────────────────────────────────────────────
        require(tokenIds.length >= 1 && tokenIds.length <= 20, "1-20 NFTs");
        require(choice == HEADS || choice == TAILS, "Invalid choice");
        require(bytes(name).length <= 32, "Name too long");
        require(msg.value >= PROTOCOL_FEE, "Protocol fee required");
        _requireNoDuplicates(tokenIds);

        // ── Effects ─────────────────────────────────────────────
        uint256 roomId = roomCount++;
        Room storage r = _rooms[roomId];
        r.creator       = msg.sender;
        r.nftCount      = uint8(tokenIds.length);
        r.creatorChoice = choice;
        r.status        = Status.Waiting;
        r.createdAt     = block.timestamp;
        r.ethAmount     = msg.value - PROTOCOL_FEE; // desconta a fee do protocolo
        r.name          = name;
        pendingFees    += PROTOCOL_FEE;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            r.creatorTokenIds.push(tokenIds[i]);
        }

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < tokenIds.length; i++) {
            nftContract.transferFrom(msg.sender, address(this), tokenIds[i]);
        }

        emit RoomCreated(roomId, msg.sender, tokenIds, choice);
    }

    /**
     * @notice Join an open room. Call nftContract.setApprovalForAll(address(this), true) first.
     * @param roomId    Room to join.
     * @param tokenIds  Your token IDs — must match the room's nftCount exactly, no duplicates.
     */
    function joinRoom(uint256 roomId, uint256[] calldata tokenIds)
        external
        payable
        notPaused
        noReentrancy
    {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(r.status == Status.Waiting,                "Room not open");
        require(msg.sender != r.creator,                   "Cannot join own room");
        require(tokenIds.length == r.nftCount,             "Wrong NFT count");
        require(msg.value == r.ethAmount + PROTOCOL_FEE,   "Wrong ETH amount");
        _requireNoDuplicates(tokenIds);

        // ── Effects ─────────────────────────────────────────────
        r.challenger  = msg.sender;
        r.status      = Status.Active;
        r.activatedAt = block.timestamp;
        pendingFees  += PROTOCOL_FEE;

        for (uint256 i = 0; i < tokenIds.length; i++) {
            r.challengerTokenIds.push(tokenIds[i]);
        }

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < tokenIds.length; i++) {
            nftContract.transferFrom(msg.sender, address(this), tokenIds[i]);
        }

        emit RoomJoined(roomId, msg.sender, tokenIds);
    }

    /**
     * @notice Request a Chainlink VRF coin flip for an active room.
     *         Either participant can call this.
     *         Result arrives in fulfillRandomWords() within ~1-3 blocks.
     */
    function flip(uint256 roomId) external notPaused noReentrancy {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(r.status == Status.Active,                                "Room not active");
        require(msg.sender == r.creator || msg.sender == r.challenger,   "Not a participant");
        require(block.timestamp <= r.activatedAt + FLIP_TIMEOUT,         "Room timed out - use refundExpired");
        require(r.vrfRequestId == 0,                                      "Flip already requested");

        // ── Effects ─────────────────────────────────────────────
        r.status = Status.Flipping;

        // ── Interactions (Chainlink VRF) ──────────────────────────
        // Gas dinâmico: base + 2 transfers por NFT (creator e challenger)
        uint32 callbackGas = CALLBACK_GAS_BASE + CALLBACK_GAS_PER_NFT * uint32(r.nftCount) * 2;

        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash:             keyHash,
                subId:               subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit:    callbackGas,
                numWords:            1,
                extraArgs:           VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({ nativePayment: false })
                )
            })
        );

        r.vrfRequestId              = requestId;
        vrfRequestToRoom[requestId] = roomId;

        emit FlipRequested(roomId, requestId);
    }

    /**
     * @notice Called by Chainlink VRF coordinator with the random result.
     *         Determines the winner and transfers all escrowed NFTs to them.
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override noReentrancy {
        uint256 roomId = vrfRequestToRoom[requestId];
        Room storage r = _rooms[roomId];

        // Guard: skip if room is not in Flipping state (prevents double-fulfillment)
        if (r.status != Status.Flipping) return;

        // ── Effects ─────────────────────────────────────────────
        uint8   result = uint8(randomWords[0] % 2);
        address winner = (result == r.creatorChoice) ? r.creator : r.challenger;

        r.coinResult = result;
        r.winner     = winner;
        r.status     = Status.Complete;

        // Build list of all tokens for the event
        uint256 total = r.creatorTokenIds.length + r.challengerTokenIds.length;
        uint256[] memory allTokens = new uint256[](total);
        uint256 idx;

        // ── Interactions ─────────────────────────────────────────
        // State is already written above — safe to interact last
        for (uint256 i = 0; i < r.creatorTokenIds.length; i++) {
            nftContract.transferFrom(address(this), winner, r.creatorTokenIds[i]);
            allTokens[idx++] = r.creatorTokenIds[i];
        }
        for (uint256 i = 0; i < r.challengerTokenIds.length; i++) {
            nftContract.transferFrom(address(this), winner, r.challengerTokenIds[i]);
            allTokens[idx++] = r.challengerTokenIds[i];
        }

        // Transfere ETH ao vencedor descontando 5% de taxa
        if (r.ethAmount > 0) {
            uint256 totalEth  = r.ethAmount * 2;
            uint256 fee       = totalEth * 5 / 100;
            uint256 winnerEth = totalEth - fee;
            pendingFees += fee;
            (bool ok,) = winner.call{value: winnerEth}("");
            require(ok, "ETH transfer failed");
        }

        emit FlipResult(roomId, result, winner, allTokens);
    }

    /**
     * @notice Cancel a waiting room (only creator, before anyone joins).
     *         NFTs are returned to the creator.
     */
    function cancelRoom(uint256 roomId) external noReentrancy {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(r.status == Status.Waiting, "Only waiting rooms can be cancelled");
        require(msg.sender == r.creator,    "Only creator can cancel");

        // ── Effects ─────────────────────────────────────────────
        r.status = Status.Cancelled;

        uint256 feeRefund = PROTOCOL_FEE * 95 / 100; // 95% devolvido, 5% fica no contrato
        pendingFees -= feeRefund;

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < r.creatorTokenIds.length; i++) {
            nftContract.transferFrom(address(this), r.creator, r.creatorTokenIds[i]);
        }

        uint256 refundAmount = r.ethAmount + feeRefund;
        if (refundAmount > 0) {
            (bool ok,) = r.creator.call{value: refundAmount}("");
            require(ok, "ETH refund failed");
        }

        emit RoomCancelled(roomId, msg.sender);
    }

    /**
     * @notice Refund both players if the room has been active for over 24 hours
     *         without a flip being triggered, OR if Chainlink VRF never responded.
     *         Anyone can call this — it is a safety hatch, not a game function.
     */
    function refundExpired(uint256 roomId) external noReentrancy {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(
            r.status == Status.Active || r.status == Status.Flipping,
            "Room not refundable"
        );
        require(
            block.timestamp > r.activatedAt + FLIP_TIMEOUT,
            "Room has not expired yet"
        );

        // ── Effects ─────────────────────────────────────────────
        r.status = Status.Expired;

        uint256 feeRefund = PROTOCOL_FEE * 95 / 100; // 95% devolvido a cada jogador
        pendingFees -= feeRefund * 2;

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < r.creatorTokenIds.length; i++) {
            nftContract.transferFrom(address(this), r.creator, r.creatorTokenIds[i]);
        }
        for (uint256 i = 0; i < r.challengerTokenIds.length; i++) {
            nftContract.transferFrom(address(this), r.challenger, r.challengerTokenIds[i]);
        }

        uint256 creatorRefund     = r.ethAmount + feeRefund;
        uint256 challengerRefund  = r.ethAmount + feeRefund;
        (bool ok1,) = r.creator.call{value: creatorRefund}("");
        require(ok1, "ETH refund creator failed");
        (bool ok2,) = r.challenger.call{value: challengerRefund}("");
        require(ok2, "ETH refund challenger failed");

        emit RoomExpired(roomId);
    }

    // ─── VIEW FUNCTIONS ──────────────────────────────────────────

    /// @notice Basic room data (no token-ID arrays).
    function getRoom(uint256 roomId)
        external
        view
        returns (
            address creator,
            address challenger,
            uint8   nftCount,
            uint8   status,        // 0=Waiting 1=Active 2=Flipping 3=Complete 4=Cancelled 5=Expired
            address winner,
            uint8   coinResult,
            uint8   creatorChoice,
            uint256 createdAt,
            uint256 activatedAt,
            uint256 ethAmount,
            string  memory name
        )
    {
        Room storage r = _rooms[roomId];
        return (
            r.creator, r.challenger, r.nftCount, uint8(r.status),
            r.winner, r.coinResult, r.creatorChoice, r.createdAt, r.activatedAt, r.ethAmount, r.name
        );
    }

    /// @notice Escrowed token IDs for a room.
    function getRoomTokenIds(uint256 roomId)
        external
        view
        returns (uint256[] memory creatorTokenIds, uint256[] memory challengerTokenIds)
    {
        Room storage r = _rooms[roomId];
        return (r.creatorTokenIds, r.challengerTokenIds);
    }

    /// @notice Batch-read basic data for the most recent `count` rooms.
    function getRecentRooms(uint256 count)
        external
        view
        returns (
            uint256[] memory ids,
            address[] memory creators,
            address[] memory challengers,
            uint8[]   memory nftCounts,
            uint8[]   memory statuses,
            address[] memory winners,
            uint8[]   memory coinResults,
            uint8[]   memory creatorChoices,
            uint256[] memory createdAts
        )
    {
        uint256 total = roomCount;
        uint256 start = total > count ? total - count : 0;
        uint256 len   = total - start;

        ids            = new uint256[](len);
        creators       = new address[](len);
        challengers    = new address[](len);
        nftCounts      = new uint8[](len);
        statuses       = new uint8[](len);
        winners        = new address[](len);
        coinResults    = new uint8[](len);
        creatorChoices = new uint8[](len);
        createdAts     = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            uint256 rid    = start + i;
            Room storage r = _rooms[rid];
            ids[i]            = rid;
            creators[i]       = r.creator;
            challengers[i]    = r.challenger;
            nftCounts[i]      = r.nftCount;
            statuses[i]       = uint8(r.status);
            winners[i]        = r.winner;
            coinResults[i]    = r.coinResult;
            creatorChoices[i] = r.creatorChoice;
            createdAts[i]     = r.createdAt;
        }
    }

    /// @notice Returns ethAmount and name for the most recent `count` rooms (complements getRecentRooms).
    function getRecentRoomsExtra(uint256 count)
        external
        view
        returns (
            uint256[] memory ids,
            uint256[] memory ethAmounts,
            string[]  memory names
        )
    {
        uint256 total = roomCount;
        uint256 start = total > count ? total - count : 0;
        uint256 len   = total - start;

        ids        = new uint256[](len);
        ethAmounts = new uint256[](len);
        names      = new string[](len);

        for (uint256 i = 0; i < len; i++) {
            uint256 rid    = start + i;
            Room storage r = _rooms[rid];
            ids[i]        = rid;
            ethAmounts[i] = r.ethAmount;
            names[i]      = r.name;
        }
    }

    // ─── ADMIN ───────────────────────────────────────────────────
    // onlyOwner is inherited from ConfirmedOwner (via VRFConsumerBaseV2Plus)

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
    }

    /// @notice Saca as taxas acumuladas (5% de cada aposta ETH) para uma carteira.
    function withdrawFees(address to) external onlyOwner noReentrancy {
        require(to != address(0), "Zero address");
        uint256 amount = pendingFees;
        require(amount > 0, "No fees");
        pendingFees = 0;
        (bool ok,) = to.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    /**
     * @notice Emergency recovery — returns specific escrowed NFTs to a given address.
     *         Use only if a room gets stuck in an unexpected state.
     */
    function emergencyWithdraw(uint256[] calldata tokenIds, address to)
        external
        onlyOwner
        noReentrancy
    {
        require(to != address(0), "Zero address");
        for (uint256 i = 0; i < tokenIds.length; i++) {
            nftContract.transferFrom(address(this), to, tokenIds[i]);
        }
    }

    // ─── INTERNAL HELPERS ────────────────────────────────────────

    /// @dev O(n²) duplicate check — safe for the 1–20 token limit.
    function _requireNoDuplicates(uint256[] calldata tokenIds) internal pure {
        for (uint256 i = 0; i < tokenIds.length; i++) {
            for (uint256 j = i + 1; j < tokenIds.length; j++) {
                require(tokenIds[i] != tokenIds[j], "Duplicate token ID");
            }
        }
    }
}

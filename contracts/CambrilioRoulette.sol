// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Chainlink VRF v2.5 — importable from Remix via npm
import {VRFConsumerBaseV2Plus} from "@chainlink/contracts/src/v0.8/vrf/dev/VRFConsumerBaseV2Plus.sol";
import {VRFV2PlusClient} from "@chainlink/contracts/src/v0.8/vrf/dev/libraries/VRFV2PlusClient.sol";

/**
 * @title  CambrilioRoulette
 * @notice P2P roulette with real NFT escrow on Base.
 *
 * Rules
 * ─────
 * • Creator picks RED or BLACK; challenger automatically gets the other color.
 * • 31 roulette slots: 0 = GREEN, 1–15 = RED, 16–30 = BLACK (perfectly fair).
 * • RED wins  → RED player receives all NFTs (and ETH) from BLACK player.
 * • BLACK wins → BLACK player receives all NFTs (and ETH) from RED player.
 * • GREEN (0)  → ALL NFTs stay locked in the contract; ETH also kept as
 *                protocol revenue. Owner can recover NFTs via emergencyWithdraw
 *                and ETH via withdrawFees.
 *
 * Security properties
 * ───────────────────
 * ✔ Checks-Effects-Interactions order on every write function.
 * ✔ Custom reentrancy guard on all state-mutating paths, including VRF callback.
 * ✔ Verifiable randomness via Chainlink VRF v2.5 (not block.prevrandao).
 * ✔ 24-hour timeout on Active rooms — escrowed NFTs are never permanently locked.
 * ✔ Duplicate-tokenId check on createRoom / joinRoom.
 */

interface IERC721 {
    function transferFrom(address from, address to, uint256 tokenId) external;
}

contract CambrilioRoulette is VRFConsumerBaseV2Plus {

    // ─── CONSTANTS ───────────────────────────────────────────────
    uint8   public constant RED            = 0;
    uint8   public constant BLACK          = 1;
    uint8   public constant GREEN          = 2;   // result only, not a valid choice

    uint256 public constant SPIN_TIMEOUT   = 24 hours;
    uint256 public constant PROTOCOL_FEE   = 0.00024 ether; // per player, per room

    // ─── CHAINLINK VRF CONFIG ────────────────────────────────────
    bytes32 public immutable keyHash;
    uint256 public immutable subscriptionId;
    uint32  public constant  CALLBACK_GAS_BASE    = 200_000;
    uint32  public constant  CALLBACK_GAS_PER_NFT = 65_000;
    uint16  public constant  REQUEST_CONFIRMATIONS = 3;

    // ─── STATE ───────────────────────────────────────────────────
    IERC721 public immutable nftContract;
    bool    public paused;

    uint256 public roomCount;

    // Status flow:
    //   Waiting ──[joinRoom]──► Active ──[spin()]──► Spinning ──[VRF]──► Complete
    //   Waiting ──[cancelRoom]──► Cancelled
    //   Active / Spinning ──[refundExpired]──► Expired
    enum Status { Waiting, Active, Spinning, Complete, Cancelled, Expired }

    struct Room {
        address   redPlayer;
        address   blackPlayer;
        uint8     nftCount;
        uint8     result;         // 0=RED 1=BLACK 2=GREEN — valid only when Complete
        uint8     spinSlot;       // 0-30 — actual roulette number, emitted for frontend animation
        Status    status;
        address   winner;         // address(0) if GREEN
        uint256   createdAt;
        uint256   activatedAt;    // set when challenger joins
        uint256   vrfRequestId;   // non-zero once spin() is called
        uint256   ethAmount;      // ETH each player bets (0 = NFT-only room)
        string    name;           // optional room name set by creator
        uint256[] redTokenIds;
        uint256[] blackTokenIds;
    }

    mapping(uint256 => Room)    private _rooms;
    mapping(uint256 => uint256) public  vrfRequestToRoom; // requestId → roomId

    uint256 public pendingFees; // accumulated protocol ETH (fees + GREEN pot)

    // ─── EVENTS ──────────────────────────────────────────────────
    event RoomCreated(
        uint256 indexed roomId,
        address indexed creator,
        uint8           color,
        uint256[]       tokenIds
    );
    event RoomJoined(
        uint256 indexed roomId,
        address indexed challenger,
        uint8           color,
        uint256[]       tokenIds
    );
    event SpinRequested(uint256 indexed roomId, uint256 indexed requestId);
    event SpinResult(
        uint256 indexed roomId,
        uint8           slot,           // 0-30 — for frontend roulette animation
        uint8           result,         // 0=RED 1=BLACK 2=GREEN
        address indexed winner,         // address(0) on GREEN
        uint256[]       winnerTokenIds  // empty on GREEN
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
     * @param _keyHash         Gas-lane key hash for Base.
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
     * @notice Create a roulette room. Call nftContract.setApprovalForAll(address(this), true) first.
     * @param tokenIds  Cambrilio token IDs to wager (1–20, no duplicates).
     * @param color     0 = RED, 1 = BLACK. Challenger automatically gets the opposite.
     * @param name      Optional room label (max 32 bytes).
     */
    function createRoom(uint256[] calldata tokenIds, uint8 color, string calldata name)
        external
        payable
        notPaused
        noReentrancy
    {
        // ── Checks ──────────────────────────────────────────────
        require(tokenIds.length >= 1 && tokenIds.length <= 20, "1-20 NFTs");
        require(color == RED || color == BLACK, "Invalid color: use 0=RED or 1=BLACK");
        require(bytes(name).length <= 32, "Name too long");
        require(msg.value >= PROTOCOL_FEE, "Protocol fee required");
        _requireNoDuplicates(tokenIds);

        // ── Effects ─────────────────────────────────────────────
        uint256 roomId = roomCount++;
        Room storage r = _rooms[roomId];
        r.nftCount   = uint8(tokenIds.length);
        r.status     = Status.Waiting;
        r.createdAt  = block.timestamp;
        r.ethAmount  = msg.value - PROTOCOL_FEE;
        r.name       = name;
        pendingFees += PROTOCOL_FEE;

        if (color == RED) {
            r.redPlayer = msg.sender;
            for (uint256 i = 0; i < tokenIds.length; i++) {
                r.redTokenIds.push(tokenIds[i]);
            }
        } else {
            r.blackPlayer = msg.sender;
            for (uint256 i = 0; i < tokenIds.length; i++) {
                r.blackTokenIds.push(tokenIds[i]);
            }
        }

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < tokenIds.length; i++) {
            nftContract.transferFrom(msg.sender, address(this), tokenIds[i]);
        }

        emit RoomCreated(roomId, msg.sender, color, tokenIds);
    }

    /**
     * @notice Join an open room as the opposite color. Call setApprovalForAll first.
     * @param roomId    Room to join.
     * @param tokenIds  Your token IDs — must match the room's nftCount, no duplicates.
     */
    function joinRoom(uint256 roomId, uint256[] calldata tokenIds)
        external
        payable
        notPaused
        noReentrancy
    {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(r.status == Status.Waiting,               "Room not open");
        require(tokenIds.length == r.nftCount,            "Wrong NFT count");
        require(msg.value == r.ethAmount + PROTOCOL_FEE,  "Wrong ETH amount");
        _requireNoDuplicates(tokenIds);

        uint8   challengerColor;

        if (r.redPlayer != address(0)) {
            // Creator chose RED → challenger is BLACK
            require(msg.sender != r.redPlayer, "Cannot join own room");
            challengerColor = BLACK;
            r.blackPlayer   = msg.sender;
            for (uint256 i = 0; i < tokenIds.length; i++) {
                r.blackTokenIds.push(tokenIds[i]);
            }
        } else {
            // Creator chose BLACK → challenger is RED
            require(msg.sender != r.blackPlayer, "Cannot join own room");
            challengerColor = RED;
            r.redPlayer     = msg.sender;
            for (uint256 i = 0; i < tokenIds.length; i++) {
                r.redTokenIds.push(tokenIds[i]);
            }
        }

        // ── Effects ─────────────────────────────────────────────
        r.status      = Status.Active;
        r.activatedAt = block.timestamp;
        pendingFees  += PROTOCOL_FEE;

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < tokenIds.length; i++) {
            nftContract.transferFrom(msg.sender, address(this), tokenIds[i]);
        }

        emit RoomJoined(roomId, msg.sender, challengerColor, tokenIds);
    }

    /**
     * @notice Request a Chainlink VRF spin for an active room.
     *         Either participant can call this.
     *         Result arrives in fulfillRandomWords() within ~1-3 blocks.
     */
    function spin(uint256 roomId) external notPaused noReentrancy {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(r.status == Status.Active,                                  "Room not active");
        require(msg.sender == r.redPlayer || msg.sender == r.blackPlayer,   "Not a participant");
        require(block.timestamp <= r.activatedAt + SPIN_TIMEOUT,            "Room timed out - use refundExpired");
        require(r.vrfRequestId == 0,                                        "Spin already requested");

        // ── Effects ─────────────────────────────────────────────
        r.status = Status.Spinning;

        // ── Interactions (Chainlink VRF) ──────────────────────────
        // Dynamic gas: base + 2 transfers per NFT (red player + black player)
        uint32 callbackGas = CALLBACK_GAS_BASE + CALLBACK_GAS_PER_NFT * uint32(r.nftCount) * 2;

        uint256 requestId = s_vrfCoordinator.requestRandomWords(
            VRFV2PlusClient.RandomWordsRequest({
                keyHash:              keyHash,
                subId:                subscriptionId,
                requestConfirmations: REQUEST_CONFIRMATIONS,
                callbackGasLimit:     callbackGas,
                numWords:             1,
                extraArgs:            VRFV2PlusClient._argsToBytes(
                    VRFV2PlusClient.ExtraArgsV1({ nativePayment: false })
                )
            })
        );

        r.vrfRequestId              = requestId;
        vrfRequestToRoom[requestId] = roomId;

        emit SpinRequested(roomId, requestId);
    }

    /**
     * @notice Called by Chainlink VRF coordinator with the random result.
     *
     *         Roulette layout (31 slots):
     *           slot  0       → GREEN  — NFTs + ETH stay in contract (protocol revenue)
     *           slots 1–15    → RED    — RED player wins all NFTs and ETH
     *           slots 16–30   → BLACK  — BLACK player wins all NFTs and ETH
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] calldata randomWords
    ) internal override noReentrancy {
        uint256 roomId = vrfRequestToRoom[requestId];
        Room storage r = _rooms[roomId];

        // Guard: skip if room is not Spinning (prevents double-fulfillment)
        if (r.status != Status.Spinning) return;

        // ── Determine result ─────────────────────────────────────
        uint8   slot   = uint8(randomWords[0] % 31); // 0-30
        uint8   result;
        address winner;

        if (slot == 0) {
            result = GREEN;
            winner = address(0);
        } else if (slot <= 15) {
            result = RED;
            winner = r.redPlayer;
        } else {
            result = BLACK;
            winner = r.blackPlayer;
        }

        // ── Effects ─────────────────────────────────────────────
        r.spinSlot = slot;
        r.result   = result;
        r.winner   = winner;
        r.status   = Status.Complete;

        uint256 total = r.redTokenIds.length + r.blackTokenIds.length;
        uint256[] memory allTokens = new uint256[](total);
        uint256 idx;

        // ── Interactions ─────────────────────────────────────────
        if (winner != address(0)) {
            // RED or BLACK wins: transfer all NFTs to winner
            for (uint256 i = 0; i < r.redTokenIds.length; i++) {
                nftContract.transferFrom(address(this), winner, r.redTokenIds[i]);
                allTokens[idx++] = r.redTokenIds[i];
            }
            for (uint256 i = 0; i < r.blackTokenIds.length; i++) {
                nftContract.transferFrom(address(this), winner, r.blackTokenIds[i]);
                allTokens[idx++] = r.blackTokenIds[i];
            }

            // Transfer ETH to winner minus 5% fee
            if (r.ethAmount > 0) {
                uint256 totalEth  = r.ethAmount * 2;
                uint256 fee       = totalEth * 5 / 100;
                uint256 winnerEth = totalEth - fee;
                pendingFees += fee;
                (bool ok,) = winner.call{value: winnerEth}("");
                require(ok, "ETH transfer failed");
            }

            emit SpinResult(roomId, slot, result, winner, allTokens);
        } else {
            // GREEN: NFTs stay locked in contract, ETH fully becomes protocol revenue
            for (uint256 i = 0; i < r.redTokenIds.length; i++) {
                allTokens[idx++] = r.redTokenIds[i];
            }
            for (uint256 i = 0; i < r.blackTokenIds.length; i++) {
                allTokens[idx++] = r.blackTokenIds[i];
            }

            if (r.ethAmount > 0) {
                pendingFees += r.ethAmount * 2; // full ETH from both players
            }

            // Emit empty winner array — frontend should show "house wins"
            uint256[] memory empty = new uint256[](0);
            emit SpinResult(roomId, slot, result, address(0), empty);
        }
    }

    /**
     * @notice Cancel a waiting room (only creator, before anyone joins).
     *         NFTs are returned to the creator.
     */
    function cancelRoom(uint256 roomId) external noReentrancy {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(r.status == Status.Waiting, "Only waiting rooms can be cancelled");

        address creator;
        bool    isRed;

        if (r.redPlayer != address(0)) {
            creator = r.redPlayer;
            isRed   = true;
        } else {
            creator = r.blackPlayer;
            isRed   = false;
        }
        require(msg.sender == creator, "Only creator can cancel");

        // ── Effects ─────────────────────────────────────────────
        r.status = Status.Cancelled;

        uint256 feeRefund = PROTOCOL_FEE * 95 / 100; // 95% refunded, 5% stays
        pendingFees -= feeRefund;

        // ── Interactions ─────────────────────────────────────────
        uint256[] storage creatorTokenIds = isRed ? r.redTokenIds : r.blackTokenIds;
        for (uint256 i = 0; i < creatorTokenIds.length; i++) {
            nftContract.transferFrom(address(this), creator, creatorTokenIds[i]);
        }

        uint256 refundAmount = r.ethAmount + feeRefund;
        if (refundAmount > 0) {
            (bool ok,) = creator.call{value: refundAmount}("");
            require(ok, "ETH refund failed");
        }

        emit RoomCancelled(roomId, msg.sender);
    }

    /**
     * @notice Refund both players if the room has been Active/Spinning for over 24 hours.
     *         Anyone can call this — safety hatch, not a game function.
     */
    function refundExpired(uint256 roomId) external noReentrancy {
        // ── Checks ──────────────────────────────────────────────
        Room storage r = _rooms[roomId];
        require(
            r.status == Status.Active || r.status == Status.Spinning,
            "Room not refundable"
        );
        require(
            block.timestamp > r.activatedAt + SPIN_TIMEOUT,
            "Room has not expired yet"
        );

        // ── Effects ─────────────────────────────────────────────
        r.status = Status.Expired;

        uint256 feeRefund = PROTOCOL_FEE * 95 / 100; // 95% refunded to each player
        pendingFees -= feeRefund * 2;

        // ── Interactions ─────────────────────────────────────────
        for (uint256 i = 0; i < r.redTokenIds.length; i++) {
            nftContract.transferFrom(address(this), r.redPlayer, r.redTokenIds[i]);
        }
        for (uint256 i = 0; i < r.blackTokenIds.length; i++) {
            nftContract.transferFrom(address(this), r.blackPlayer, r.blackTokenIds[i]);
        }

        uint256 playerRefund = r.ethAmount + feeRefund;
        (bool ok1,) = r.redPlayer.call{value: playerRefund}("");
        require(ok1, "ETH refund red player failed");
        (bool ok2,) = r.blackPlayer.call{value: playerRefund}("");
        require(ok2, "ETH refund black player failed");

        emit RoomExpired(roomId);
    }

    // ─── VIEW FUNCTIONS ──────────────────────────────────────────

    /// @notice Basic room data (no token-ID arrays).
    function getRoom(uint256 roomId)
        external
        view
        returns (
            address redPlayer,
            address blackPlayer,
            uint8   nftCount,
            uint8   status,       // 0=Waiting 1=Active 2=Spinning 3=Complete 4=Cancelled 5=Expired
            address winner,       // address(0) if GREEN or not yet resolved
            uint8   result,       // 0=RED 1=BLACK 2=GREEN — valid only when Complete
            uint8   spinSlot,     // 0-30 — actual roulette number, for frontend animation
            uint256 createdAt,
            uint256 activatedAt,
            uint256 ethAmount,
            string  memory name
        )
    {
        Room storage r = _rooms[roomId];
        return (
            r.redPlayer, r.blackPlayer, r.nftCount, uint8(r.status),
            r.winner, r.result, r.spinSlot,
            r.createdAt, r.activatedAt, r.ethAmount, r.name
        );
    }

    /// @notice Escrowed token IDs for a room.
    function getRoomTokenIds(uint256 roomId)
        external
        view
        returns (uint256[] memory redTokenIds, uint256[] memory blackTokenIds)
    {
        Room storage r = _rooms[roomId];
        return (r.redTokenIds, r.blackTokenIds);
    }

    /// @notice Batch-read basic data for the most recent `count` rooms.
    function getRecentRooms(uint256 count)
        external
        view
        returns (
            uint256[] memory ids,
            address[] memory redPlayers,
            address[] memory blackPlayers,
            uint8[]   memory nftCounts,
            uint8[]   memory statuses,
            address[] memory winners,
            uint8[]   memory results,
            uint8[]   memory spinSlots,
            uint256[] memory createdAts
        )
    {
        uint256 total = roomCount;
        uint256 start = total > count ? total - count : 0;
        uint256 len   = total - start;

        ids          = new uint256[](len);
        redPlayers   = new address[](len);
        blackPlayers = new address[](len);
        nftCounts    = new uint8[](len);
        statuses     = new uint8[](len);
        winners      = new address[](len);
        results      = new uint8[](len);
        spinSlots    = new uint8[](len);
        createdAts   = new uint256[](len);

        for (uint256 i = 0; i < len; i++) {
            uint256 rid    = start + i;
            Room storage r = _rooms[rid];
            ids[i]          = rid;
            redPlayers[i]   = r.redPlayer;
            blackPlayers[i] = r.blackPlayer;
            nftCounts[i]    = r.nftCount;
            statuses[i]     = uint8(r.status);
            winners[i]      = r.winner;
            results[i]      = r.result;
            spinSlots[i]    = r.spinSlot;
            createdAts[i]   = r.createdAt;
        }
    }

    /// @notice Returns ethAmount and name for the most recent `count` rooms.
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

    /// @notice Withdraw accumulated fees and GREEN-pot ETH.
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
     *         Use to recover NFTs locked after a GREEN result or any stuck room.
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

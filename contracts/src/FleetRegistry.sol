// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QorePQC} from "./lib/QorePQC.sol";

/// @title FleetRegistry: an on-chain immune memory for robot fleets.
/// @notice "A stolen key can only stop robots. Only a post-quantum key can bring them back."
///   - Restricting actions (quarantine) need only a classical key: the rate-capped sentinel, or the owner.
///   - Widening actions (release, sentinel rotation, cap changes) need the owner's ML-DSA-87 signature,
///     verified on chain against the key the chain's PQC registry holds for `owner`
///     (registered && possessionProven). Anyone may relay a PQ-signed action.
/// Robots and gateways cache `epoch` and the quarantine set; the chain is not in the control loop.
contract FleetRegistry {
    struct Robot {
        bool enrolled;
        bool quarantined;
        uint64 sinceEpoch;
        bytes32 reasonHash;
    }

    bytes32 public constant RELEASE_DOMAIN = keccak256("OPSONIN:FLEET_RELEASE_V1");
    bytes32 public constant ROTATE_DOMAIN = keccak256("OPSONIN:SENTINEL_ROTATE_V1");
    bytes32 public constant CAP_DOMAIN = keccak256("OPSONIN:CAP_CHANGE_V1");

    address public immutable owner;
    address public sentinel;
    uint64 public epoch;
    uint256 public ownerNonce;

    /// Sentinel rate cap: at most `maxQuarantinePerWindow` robots per `windowBlocks` blocks.
    uint32 public maxQuarantinePerWindow;
    uint32 public windowBlocks;
    uint64 public windowStart;
    uint32 public usedInWindow;

    mapping(bytes32 => Robot) public robots;

    event Enrolled(bytes32 indexed id, uint64 epoch);
    event Quarantined(bytes32 indexed id, uint64 epoch, bytes32 reasonHash, address indexed by);
    event Released(bytes32 indexed id, uint64 epoch, uint256 ownerNonce);
    event SentinelRotated(address indexed previous, address indexed next, uint256 ownerNonce);
    event CapChanged(uint32 maxPerWindow, uint32 windowBlocks, uint256 ownerNonce);

    error NotOwner();
    error NotSentinel();
    error NotEnrolled(bytes32 id);
    error CapExceeded(uint32 used, uint32 max);
    error BadPqSignature();
    error Expired();
    error Empty();
    error BadCap();

    constructor(address owner_, address sentinel_, uint32 maxPerWindow_, uint32 windowBlocks_) {
        if (maxPerWindow_ == 0 || windowBlocks_ == 0) revert BadCap();
        owner = owner_;
        sentinel = sentinel_;
        maxQuarantinePerWindow = maxPerWindow_;
        windowBlocks = windowBlocks_;
        windowStart = uint64(block.number);
    }

    // ------------------------------------------------------------------ enrol

    /// @notice Classical owner key is enough: enrolment grants no robot any new capability.
    function enroll(bytes32[] calldata ids) external {
        if (msg.sender != owner) revert NotOwner();
        if (ids.length == 0) revert Empty();
        uint64 e = ++epoch;
        for (uint256 i; i < ids.length; ++i) {
            Robot storage r = robots[ids[i]];
            if (r.enrolled) continue;
            r.enrolled = true;
            r.sinceEpoch = e;
            emit Enrolled(ids[i], e);
        }
    }

    // ------------------------------------------------------------- restrict

    /// @notice Sentinel quarantine: restrict-only, batched, rate-capped. Already-quarantined ids are skipped.
    function quarantine(bytes32[] calldata ids, bytes32 reasonHash) external {
        if (msg.sender != sentinel) revert NotSentinel();
        uint32 n = _quarantine(ids, reasonHash);
        if (block.number >= uint256(windowStart) + windowBlocks) {
            windowStart = uint64(block.number);
            usedInWindow = 0;
        }
        uint32 used = usedInWindow + n;
        if (used > maxQuarantinePerWindow) revert CapExceeded(used, maxQuarantinePerWindow);
        usedInWindow = used;
    }

    /// @notice Owner escalation beyond the sentinel cap. Still restrict-only, so a classical key suffices.
    function ownerQuarantine(bytes32[] calldata ids, bytes32 reasonHash) external {
        if (msg.sender != owner) revert NotOwner();
        _quarantine(ids, reasonHash);
    }

    function _quarantine(bytes32[] calldata ids, bytes32 reasonHash) private returns (uint32 n) {
        if (ids.length == 0) revert Empty();
        uint64 e = ++epoch;
        for (uint256 i; i < ids.length; ++i) {
            Robot storage r = robots[ids[i]];
            if (!r.enrolled) revert NotEnrolled(ids[i]);
            if (r.quarantined) continue;
            r.quarantined = true;
            r.sinceEpoch = e;
            r.reasonHash = reasonHash;
            ++n;
            emit Quarantined(ids[i], e, reasonHash, msg.sender);
        }
    }

    // -------------------------------------------------------- PQ-gated widen

    /// @notice Release robots. Anyone may relay; authorised only by the owner's ML-DSA-87 signature over
    ///         `releaseMessage(ids, deadline)`. Fails closed if the precompile is dead or the key untrusted.
    function release(bytes32[] calldata ids, uint64 deadline, bytes calldata pqSig) external {
        if (ids.length == 0) revert Empty();
        _consumeOwnerSig(releaseMessage(ids, deadline), deadline, pqSig);
        uint64 e = ++epoch;
        for (uint256 i; i < ids.length; ++i) {
            Robot storage r = robots[ids[i]];
            if (!r.quarantined) continue;
            r.quarantined = false;
            r.sinceEpoch = e;
            r.reasonHash = bytes32(0);
            emit Released(ids[i], e, ownerNonce - 1);
        }
    }

    /// @notice Rotate the sentinel key (e.g. after it is stolen). PQ-gated.
    function setSentinel(address next, uint64 deadline, bytes calldata pqSig) external {
        _consumeOwnerSig(rotateMessage(next, deadline), deadline, pqSig);
        ++epoch;
        emit SentinelRotated(sentinel, next, ownerNonce - 1);
        sentinel = next;
    }

    /// @notice Change the sentinel cap. PQ-gated (raising it widens the sentinel's authority).
    function setCap(uint32 maxPerWindow, uint32 windowBlocks_, uint64 deadline, bytes calldata pqSig) external {
        if (maxPerWindow == 0 || windowBlocks_ == 0) revert BadCap();
        _consumeOwnerSig(capMessage(maxPerWindow, windowBlocks_, deadline), deadline, pqSig);
        ++epoch;
        maxQuarantinePerWindow = maxPerWindow;
        windowBlocks = windowBlocks_;
        emit CapChanged(maxPerWindow, windowBlocks_, ownerNonce - 1);
    }

    function _consumeOwnerSig(bytes memory message, uint64 deadline, bytes calldata pqSig) private {
        if (block.timestamp > deadline) revert Expired();
        if (!QorePQC.verifyFor(owner, pqSig, message)) revert BadPqSignature();
        ++ownerNonce;
    }

    // ------------------------------------------------- messages the owner signs
    // Raw bytes, verified as-is by the pqcVerify precompile. Bound to chain, contract, nonce, deadline.

    function releaseMessage(bytes32[] calldata ids, uint64 deadline) public view returns (bytes memory) {
        return abi.encodePacked(RELEASE_DOMAIN, block.chainid, address(this), ownerNonce, deadline, keccak256(abi.encodePacked(ids)));
    }

    function rotateMessage(address next, uint64 deadline) public view returns (bytes memory) {
        return abi.encodePacked(ROTATE_DOMAIN, block.chainid, address(this), ownerNonce, deadline, next);
    }

    function capMessage(uint32 maxPerWindow, uint32 windowBlocks_, uint64 deadline) public view returns (bytes memory) {
        return abi.encodePacked(CAP_DOMAIN, block.chainid, address(this), ownerNonce, deadline, maxPerWindow, windowBlocks_);
    }

    // ------------------------------------------------------------------ views

    function isQuarantined(bytes32 id) external view returns (bool) {
        return robots[id].quarantined;
    }

    /// @notice Bulk read for gateway caches.
    function fleetState(bytes32[] calldata ids) external view returns (uint64 currentEpoch, bool[] memory enrolled, bool[] memory quarantined) {
        enrolled = new bool[](ids.length);
        quarantined = new bool[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            Robot storage r = robots[ids[i]];
            enrolled[i] = r.enrolled;
            quarantined[i] = r.quarantined;
        }
        currentEpoch = epoch;
    }

    /// @notice Sentinel budget left in the current window (the UI's "authority budget").
    function quarantineBudget() external view returns (uint32 remaining, uint64 windowEndsAtBlock) {
        bool rolled = block.number >= uint256(windowStart) + windowBlocks;
        remaining = rolled ? maxQuarantinePerWindow : (usedInWindow >= maxQuarantinePerWindow ? 0 : maxQuarantinePerWindow - usedInWindow);
        windowEndsAtBlock = (rolled ? uint64(block.number) : windowStart) + windowBlocks;
    }
}

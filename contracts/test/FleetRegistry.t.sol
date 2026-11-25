// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FleetRegistry} from "../src/FleetRegistry.sol";
import {QorePQC} from "../src/lib/QorePQC.sol";

/// Precompiles are mocked with exact-calldata vm.mockCall: any change to the signed message, key or
/// signature misses the mock and hits the (code-less) precompile address, which returns empty data,
/// so these tests also exercise the fail-closed path. Real ML-DSA-87 sizes are used throughout.
contract FleetRegistryTest is Test {
    FleetRegistry reg;
    address owner = makeAddr("owner");
    address sentinel = makeAddr("sentinel");
    address thief = makeAddr("thief");
    address relayer = makeAddr("relayer");
    bytes pk = _filled(2592, 0x11);
    bytes sig = _filled(4627, 0x22);
    bytes32[] ids;
    uint64 deadline;

    function _filled(uint256 n, bytes1 b) internal pure returns (bytes memory out) {
        out = new bytes(n);
        for (uint256 i; i < n; ++i) out[i] = b;
    }

    function setUp() public {
        reg = new FleetRegistry(owner, sentinel, 5, 100);
        for (uint256 i; i < 8; ++i) ids.push(keccak256(abi.encode("robot", i)));
        vm.prank(owner);
        reg.enroll(ids);
        deadline = uint64(block.timestamp + 600);
        vm.mockCall(QorePQC.PQC_KEY_STATUS, abi.encodeWithSignature("pqcKeyStatus(address)", owner), abi.encode(true, uint8(1), pk, true));
    }

    function _one(uint256 i) internal view returns (bytes32[] memory a) {
        a = new bytes32[](1);
        a[0] = ids[i];
    }

    function _approve(bytes memory message) internal {
        vm.mockCall(QorePQC.PQC_VERIFY, abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pk, sig, message), abi.encode(true));
    }

    function _quarantine(uint256 i) internal {
        vm.prank(sentinel);
        reg.quarantine(_one(i), keccak256("R5"));
    }

    // ------------------------------------------------------------ roles

    function test_onlySentinelQuarantines() public {
        vm.expectRevert(FleetRegistry.NotSentinel.selector);
        vm.prank(thief);
        reg.quarantine(_one(0), 0);
    }

    function test_onlyOwnerEnrolsAndEscalates() public {
        vm.startPrank(thief);
        vm.expectRevert(FleetRegistry.NotOwner.selector);
        reg.enroll(_one(0));
        vm.expectRevert(FleetRegistry.NotOwner.selector);
        reg.ownerQuarantine(_one(0), 0);
        vm.stopPrank();
    }

    function test_unenrolledCannotBeQuarantined() public {
        bytes32[] memory a = new bytes32[](1);
        a[0] = keccak256("ghost");
        vm.expectRevert(abi.encodeWithSelector(FleetRegistry.NotEnrolled.selector, a[0]));
        vm.prank(sentinel);
        reg.quarantine(a, 0);
    }

    // ------------------------------------------------------- (a) restrict-only

    function testFuzz_quarantineNeverUnquarantines(uint8 mask, uint8 mask2) public {
        for (uint256 i; i < 8; ++i) if ((mask >> i) & 1 == 1) reg.isQuarantined(ids[i]) || _q(i);
        bool[8] memory before;
        for (uint256 i; i < 8; ++i) before[i] = reg.isQuarantined(ids[i]);
        vm.roll(block.number + 1000); // fresh cap window
        for (uint256 i; i < 8; ++i) if ((mask2 >> i) & 1 == 1) { vm.prank(owner); reg.ownerQuarantine(_one(i), 0); }
        for (uint256 i; i < 8; ++i) if (before[i]) assertTrue(reg.isQuarantined(ids[i]));
    }

    function _q(uint256 i) internal returns (bool) {
        vm.prank(owner);
        reg.ownerQuarantine(_one(i), 0);
        return true;
    }

    function test_quarantineIsIdempotentAndDoesNotRecount() public {
        _quarantine(0);
        _quarantine(0);
        (uint32 left,) = reg.quarantineBudget();
        assertEq(left, 4);
    }

    // ------------------------------------------------------------- (c) cap

    function test_sentinelCannotExceedCap() public {
        for (uint256 i; i < 5; ++i) _quarantine(i);
        vm.expectRevert(abi.encodeWithSelector(FleetRegistry.CapExceeded.selector, uint32(6), uint32(5)));
        vm.prank(sentinel);
        reg.quarantine(_one(5), 0);
        assertFalse(reg.isQuarantined(ids[5]));
    }

    function test_capBatchIsAtomic() public {
        bytes32[] memory all = ids; // 8 > cap 5
        vm.expectRevert();
        vm.prank(sentinel);
        reg.quarantine(all, 0);
        for (uint256 i; i < 8; ++i) assertFalse(reg.isQuarantined(ids[i]));
    }

    function test_capWindowRolls() public {
        for (uint256 i; i < 5; ++i) _quarantine(i);
        vm.roll(block.number + 100);
        _quarantine(5);
        assertTrue(reg.isQuarantined(ids[5]));
    }

    function test_ownerEscalationIgnoresCap() public {
        for (uint256 i; i < 5; ++i) _quarantine(i);
        vm.prank(owner);
        reg.ownerQuarantine(_one(6), 0);
        assertTrue(reg.isQuarantined(ids[6]));
    }

    // ----------------------------------------------------------- (b) release

    function test_releaseWithOwnerPqSigByAnyRelayer() public {
        _quarantine(0);
        _approve(reg.releaseMessage(_one(0), deadline));
        vm.prank(relayer);
        reg.release(_one(0), deadline, sig);
        assertFalse(reg.isQuarantined(ids[0]));
        assertEq(reg.ownerNonce(), 1);
    }

    function test_releaseFailsWithWrongSignature() public {
        _quarantine(0);
        _approve(reg.releaseMessage(_one(0), deadline));
        bytes memory bad = _filled(4627, 0x23);
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.release(_one(0), deadline, bad);
    }

    function test_stolenClassicalOwnerKeyCannotRelease() public {
        _quarantine(0);
        // owner's classical key signs the tx, but there is no valid ML-DSA signature
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        vm.prank(owner);
        reg.release(_one(0), deadline, sig);
    }

    function test_releaseReplayFails() public {
        _quarantine(0);
        _approve(reg.releaseMessage(_one(0), deadline));
        reg.release(_one(0), deadline, sig);
        _quarantine(0);
        vm.expectRevert(FleetRegistry.BadPqSignature.selector); // nonce moved -> message differs
        reg.release(_one(0), deadline, sig);
    }

    function test_releaseBoundToIds() public {
        _quarantine(0);
        _quarantine(1);
        _approve(reg.releaseMessage(_one(0), deadline));
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.release(_one(1), deadline, sig);
    }

    function test_releaseBoundToChainAndContract() public {
        _quarantine(0);
        bytes memory m = reg.releaseMessage(_one(0), deadline);
        _approve(m);
        // same signature on another chain id
        vm.chainId(9801);
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.release(_one(0), deadline, sig);
        vm.chainId(31337);
        // same signature on another deployment
        FleetRegistry other = new FleetRegistry(owner, sentinel, 5, 100);
        vm.prank(owner);
        other.enroll(_one(0));
        vm.prank(sentinel);
        other.quarantine(_one(0), 0);
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        other.release(_one(0), deadline, sig);
    }

    function test_releaseExpired() public {
        _quarantine(0);
        _approve(reg.releaseMessage(_one(0), deadline));
        vm.warp(deadline + 1);
        vm.expectRevert(FleetRegistry.Expired.selector);
        reg.release(_one(0), deadline, sig);
    }

    function test_releaseSurvivesInterveningQuarantines() public {
        _quarantine(0);
        _approve(reg.releaseMessage(_one(0), deadline));
        _quarantine(1); // epoch moves; release signature must stay valid
        reg.release(_one(0), deadline, sig);
        assertFalse(reg.isQuarantined(ids[0]));
        assertTrue(reg.isQuarantined(ids[1]));
    }

    // ------------------------------------------- (d) dead precompile / key trust

    function test_deadVerifyPrecompileFailsClosed() public {
        _quarantine(0);
        vm.clearMockedCalls();
        vm.mockCall(QorePQC.PQC_KEY_STATUS, abi.encodeWithSignature("pqcKeyStatus(address)", owner), abi.encode(true, uint8(1), pk, true));
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.release(_one(0), deadline, sig);
    }

    function test_deadKeyStatusFailsClosed() public {
        _quarantine(0);
        vm.clearMockedCalls();
        _approve(reg.releaseMessage(_one(0), deadline));
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.release(_one(0), deadline, sig);
    }

    function test_keyWithoutPossessionProofRejected() public {
        _quarantine(0);
        vm.mockCall(QorePQC.PQC_KEY_STATUS, abi.encodeWithSignature("pqcKeyStatus(address)", owner), abi.encode(true, uint8(1), pk, false));
        _approve(reg.releaseMessage(_one(0), deadline));
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.release(_one(0), deadline, sig);
    }

    // ------------------------------------------------- rotation / cap change

    function test_rotateSentinelIsPqGated() public {
        address fresh = makeAddr("fresh");
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        vm.prank(sentinel);
        reg.setSentinel(thief, deadline, sig);
        _approve(reg.rotateMessage(fresh, deadline));
        reg.setSentinel(fresh, deadline, sig);
        assertEq(reg.sentinel(), fresh);
        vm.expectRevert(FleetRegistry.NotSentinel.selector);
        vm.prank(sentinel);
        reg.quarantine(_one(0), 0);
    }

    function test_setCapIsPqGated() public {
        vm.expectRevert(FleetRegistry.BadPqSignature.selector);
        reg.setCap(1000, 1, deadline, sig);
        _approve(reg.capMessage(2, 50, deadline));
        reg.setCap(2, 50, deadline, sig);
        assertEq(reg.maxQuarantinePerWindow(), 2);
    }

    function test_budgetNeverUnderflowsAfterCapLowered() public {
        for (uint256 i; i < 4; ++i) _quarantine(i);
        _approve(reg.capMessage(2, 100, deadline));
        reg.setCap(2, 100, deadline, sig);
        (uint32 left,) = reg.quarantineBudget();
        assertEq(left, 0);
    }

    // ------------------------------------------------------ (e) epoch monotone

    function test_epochStrictlyIncreasesOnEveryChange() public {
        uint64 e0 = reg.epoch();
        _quarantine(0);
        uint64 e1 = reg.epoch();
        assertGt(e1, e0);
        _approve(reg.releaseMessage(_one(0), deadline));
        reg.release(_one(0), deadline, sig);
        uint64 e2 = reg.epoch();
        assertGt(e2, e1);
        vm.prank(owner);
        reg.enroll(_one(0));
        assertGt(reg.epoch(), e2);
    }

    function test_fleetStateView() public {
        _quarantine(2);
        (uint64 e, bool[] memory en, bool[] memory q) = reg.fleetState(ids);
        assertEq(e, reg.epoch());
        assertTrue(en[0] && q[2] && !q[1]);
    }

    function test_gas_releaseRealSizes() public {
        _quarantine(0);
        _approve(reg.releaseMessage(_one(0), deadline));
        uint256 g = gasleft();
        reg.release(_one(0), deadline, sig);
        emit log_named_uint("release gas (mocked precompile, real calldata sizes)", g - gasleft());
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {QorePQC} from "../src/lib/QorePQC.sol";

contract Harness {
    function verify(bytes memory pk, bytes memory sig, bytes memory m) external view returns (bool) {
        return QorePQC.verify(pk, sig, m);
    }

    function keyLen(address a) external view returns (uint256) {
        return QorePQC.trustedPubkey(a).length;
    }

    function verifyFor(address a, bytes memory sig, bytes memory m) external view returns (bool) {
        return QorePQC.verifyFor(a, sig, m);
    }
}

contract QorePQCTest is Test {
    Harness h;
    bytes pk = new bytes(2592);
    bytes sig = new bytes(4627);
    bytes m = "FLEET_RELEASE_V1 test";
    address owner = address(0xA11CE);

    function setUp() public {
        h = new Harness();
    }

    function _mockVerify(bytes memory ret) internal {
        vm.mockCall(QorePQC.PQC_VERIFY, abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pk, sig, m), ret);
    }

    function _mockKey(bool reg, uint8 alg, bytes memory key, bool pop) internal {
        vm.mockCall(QorePQC.PQC_KEY_STATUS, abi.encodeWithSignature("pqcKeyStatus(address)", owner), abi.encode(reg, alg, key, pop));
    }

    // ---- dead precompile (no code, empty return) fails closed ----
    function test_deadPrecompile_verifyFalse() public view {
        assertFalse(h.verify(pk, sig, m));
    }

    function test_deadPrecompile_noTrustedKey() public view {
        assertEq(h.keyLen(owner), 0);
        assertFalse(h.verifyFor(owner, sig, m));
    }

    // ---- verify ----
    function test_verify_trueOnlyOnExactTrueWord() public {
        _mockVerify(abi.encode(true));
        assertTrue(h.verify(pk, sig, m));
    }

    function test_verify_falseWord() public {
        _mockVerify(abi.encode(false));
        assertFalse(h.verify(pk, sig, m));
    }

    function test_verify_wrongReturnLength() public {
        _mockVerify(abi.encodePacked(uint8(1)));
        assertFalse(h.verify(pk, sig, m));
        _mockVerify(abi.encode(true, true));
        assertFalse(h.verify(pk, sig, m));
    }

    function test_verify_nonBooleanWord() public {
        _mockVerify(abi.encode(uint256(2)));
        assertFalse(h.verify(pk, sig, m));
    }

    function test_verify_wrongSizes() public {
        _mockVerify(abi.encode(true));
        assertFalse(h.verify(new bytes(2591), sig, m));
        assertFalse(h.verify(pk, new bytes(4628), m));
        assertFalse(h.verify(pk, sig, ""));
        assertFalse(h.verify(pk, sig, new bytes(1025)));
    }

    function test_verify_precompileReverts() public {
        vm.mockCallRevert(QorePQC.PQC_VERIFY, abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pk, sig, m), "boom");
        assertFalse(h.verify(pk, sig, m));
    }

    // ---- key status ----
    function test_key_trustedOnlyWithPossession() public {
        _mockKey(true, 1, pk, true);
        assertEq(h.keyLen(owner), 2592);
        _mockKey(true, 1, pk, false);
        assertEq(h.keyLen(owner), 0);
        _mockKey(false, 1, pk, true);
        assertEq(h.keyLen(owner), 0);
        _mockKey(true, 2, pk, true);
        assertEq(h.keyLen(owner), 0);
        _mockKey(true, 1, new bytes(1312), true);
        assertEq(h.keyLen(owner), 0);
    }

    function test_verifyFor_endToEndWithMocks() public {
        _mockKey(true, 1, pk, true);
        _mockVerify(abi.encode(true));
        assertTrue(h.verifyFor(owner, sig, m));
        _mockKey(true, 1, pk, false); // possession not proven -> refuse even with a valid sig
        assertFalse(h.verifyFor(owner, sig, m));
    }
}

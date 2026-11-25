// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Spike 0 only. Simulated via eth_call as a contract CREATION (no state override):
///         the constructor calls pqcVerify from contract context and returns the raw answer.
contract CtorProbe {
    constructor(bytes memory pubkey, bytes memory sig, bytes memory message) {
        (bool ok, bytes memory ret) = address(0x0000000000000000000000000000000000000a01).staticcall(
            abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pubkey, sig, message)
        );
        bytes memory out = abi.encode(ok, ret);
        assembly { return(add(out, 32), mload(out)) }
    }
}

// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {QorePQC} from "../lib/QorePQC.sol";

/// @notice Throwaway contract for Spike 0. Proves: deploy works, a scoped window admits calls
///         to it, and pqcVerify / pqcKeyStatus work from Solidity (also inside a scoped window).
contract Spike0 {
    uint256 public pings;
    uint256 public verifiedCount;
    event Pinged(address indexed from, uint256 n);
    event Checked(address indexed signer, bytes32 msgHash, bool valid);

    function ping() external {
        emit Pinged(msg.sender, ++pings);
    }

    /// @notice View: verify an arbitrary (pubkey, sig, message) triple.
    function check(bytes calldata pubkey, bytes calldata sig, bytes calldata message) external view returns (bool) {
        return QorePQC.verify(pubkey, sig, message);
    }

    /// @notice Debug: raw precompile answer as seen from inside a contract.
    function rawVerify(bytes calldata pubkey, bytes calldata sig, bytes calldata message)
        external
        view
        returns (bool ok, bytes memory ret, uint256 gasLeftBefore)
    {
        gasLeftBefore = gasleft();
        (ok, ret) = QorePQC.PQC_VERIFY.staticcall(abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pubkey, sig, message));
    }

    /// @notice View: the trusted registered key of `account` (empty if not trusted).
    function trustedKeyLen(address account) external view returns (uint256) {
        return QorePQC.trustedPubkey(account).length;
    }

    /// @notice State-changing: verify `sig` over `message` with `signer`'s registered key, record the outcome.
    ///         Called as a real tx inside a scoped window (allowed_targets = [this]).
    function checkAndRecord(address signer, bytes calldata sig, bytes calldata message) external returns (bool valid) {
        valid = QorePQC.verifyFor(signer, sig, message);
        if (valid) verifiedCount++;
        emit Checked(signer, keccak256(message), valid);
    }
}

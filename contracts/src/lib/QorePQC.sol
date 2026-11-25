// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title QorePQC: fail-closed wrappers around QoreChain's post-quantum precompiles.
/// @notice An inactive precompile returns empty data (0x) WITHOUT reverting, so every
///         call here is a low-level staticcall whose return is length-checked before decoding.
///         Anything unexpected is treated as "not valid" / "not trusted".
library QorePQC {
    address internal constant PQC_VERIFY = 0x0000000000000000000000000000000000000a01;
    address internal constant PQC_KEY_STATUS = 0x0000000000000000000000000000000000000a02;

    uint8 internal constant ALG_ML_DSA_87 = 1;
    uint256 internal constant ML_DSA_87_PUBKEY_LEN = 2592;
    uint256 internal constant ML_DSA_87_SIG_LEN = 4627;

    /// @dev Precompile input is capped at 16,384 bytes on QoreChain; pubkey + sig alone are 7,219.
    uint256 internal constant MAX_MESSAGE_LEN = 1024;

    /// @notice True only if the precompile answers with exactly one ABI word equal to 1.
    function verify(bytes memory pubkey, bytes memory sig, bytes memory message) internal view returns (bool) {
        if (pubkey.length != ML_DSA_87_PUBKEY_LEN || sig.length != ML_DSA_87_SIG_LEN) return false;
        if (message.length == 0 || message.length > MAX_MESSAGE_LEN) return false;
        (bool ok, bytes memory ret) =
            PQC_VERIFY.staticcall(abi.encodeWithSignature("pqcVerify(bytes,bytes,bytes)", pubkey, sig, message));
        if (!ok || ret.length != 32) return false;
        return abi.decode(ret, (uint256)) == 1;
    }

    /// @notice The account's registered ML-DSA-87 public key, or empty bytes if it is not
    ///         registered, has no proven possession, is another algorithm, or the precompile is dead.
    function trustedPubkey(address account) internal view returns (bytes memory) {
        (bool ok, bytes memory ret) =
            PQC_KEY_STATUS.staticcall(abi.encodeWithSignature("pqcKeyStatus(address)", account));
        // head: 4 words (registered, algorithmId, offset, possessionProven) + length word + key
        if (!ok || ret.length < 160 + ML_DSA_87_PUBKEY_LEN) return "";
        (bool registered, uint8 algorithmId, bytes memory pubkey, bool possessionProven) =
            abi.decode(ret, (bool, uint8, bytes, bool));
        if (!registered || !possessionProven || algorithmId != ALG_ML_DSA_87) return "";
        if (pubkey.length != ML_DSA_87_PUBKEY_LEN) return "";
        return pubkey;
    }

    /// @notice Verify `sig` over `message` against `account`'s trusted registered key.
    function verifyFor(address account, bytes memory sig, bytes memory message) internal view returns (bool) {
        bytes memory pk = trustedPubkey(account);
        if (pk.length == 0) return false;
        return verify(pk, sig, message);
    }
}

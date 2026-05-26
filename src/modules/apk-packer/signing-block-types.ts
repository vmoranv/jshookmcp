/**
 * Type declarations for the APK Signing Block parser. Kept separate from
 * `types.ts` (which models the lib-packer signature DB) because the two
 * problem domains share no field surface.
 *
 * All interfaces are **descriptive**: the parser MUST NOT modify the APK,
 * regenerate signatures, or attempt verification.
 */

/**
 * Digest / signature algorithm IDs from AOSP v2/v3 specs. The unknown
 * sentinel is emitted when an algorithm id appears that is not yet
 * cataloged (we still keep the raw numeric id so users can look it up).
 *
 * Reference table (selected — see `parseSignatureAlgorithmId`):
 *   0x0101 RSA_PSS_SHA256
 *   0x0102 RSA_PSS_SHA512
 *   0x0103 RSA_PKCS1_V1_5_SHA256
 *   0x0104 RSA_PKCS1_V1_5_SHA512
 *   0x0201 ECDSA_SHA256
 *   0x0202 ECDSA_SHA512
 *   0x0301 DSA_SHA256
 *   0x0421 VERITY_RSA_PKCS1_V1_5_SHA256
 *   0x0423 VERITY_ECDSA_SHA256
 *   0x0425 VERITY_DSA_SHA256
 */
export type SigAlgorithm =
  | 'RSA_PSS_SHA256'
  | 'RSA_PSS_SHA512'
  | 'RSA_PKCS1_V1_5_SHA256'
  | 'RSA_PKCS1_V1_5_SHA512'
  | 'ECDSA_SHA256'
  | 'ECDSA_SHA512'
  | 'DSA_SHA256'
  | 'VERITY_RSA_PKCS1_V1_5_SHA256'
  | 'VERITY_ECDSA_SHA256'
  | 'VERITY_DSA_SHA256'
  | 'UNKNOWN';

/** Descriptor for an X.509 certificate found inside a signer block. */
export interface CertificateInfo {
  /** Lowercase hex SHA-256 fingerprint over the DER bytes. */
  readonly sha256Fingerprint: string;
  /** Length of the DER blob in bytes. */
  readonly derLength: number;
  /** Hex preview of the first 32 bytes of the DER (never the full cert). */
  readonly derPreview: string;
}

/** A v2 (or v3) signer descriptor — digests, signatures, certs, attributes. */
export interface V2Signer {
  readonly digests: ReadonlyArray<{
    readonly algorithm: SigAlgorithm;
    readonly algorithmId: number;
  }>;
  readonly signatures: ReadonlyArray<{
    readonly algorithm: SigAlgorithm;
    readonly algorithmId: number;
  }>;
  readonly certificates: ReadonlyArray<CertificateInfo>;
  readonly additionalAttributes: ReadonlyArray<{
    /** `0x` prefixed lowercase hex of the 32-bit attribute id. */
    readonly id: string;
    readonly size: number;
  }>;
}

/** v3 / v3.1 signer adds SDK-version range to the v2 layout. */
export interface V3Signer extends V2Signer {
  readonly minSdkVersion: number;
  readonly maxSdkVersion: number;
}

/** One level of a v3 key-rotation lineage (oldest → newest). */
export interface ProofOfRotationLevel {
  readonly certificate: CertificateInfo;
  /** AOSP v3 permission flags (see `SigningCertificateLineage#Flags`). */
  readonly flags: number;
  /** Algorithm of the signature attesting the next signer is trusted. */
  readonly signedDataSigAlgorithm: SigAlgorithm;
}

export interface ProofOfRotation {
  readonly levels: ReadonlyArray<ProofOfRotationLevel>;
}

/** v4 block (root hash of the fs-verity Merkle tree). */
export interface V4Block {
  /** Lowercase hex digest of the root hash. */
  readonly rootHash: string;
  /** Size of the Merkle tree in bytes. */
  readonly treeSize: number;
  /** Algorithm declared in the block. */
  readonly algorithm: SigAlgorithm;
}

/** Anomaly kinds we surface as advisory signals (not blocking errors). */
export type AnomalyKind =
  | 'extra-block'
  | 'magic-offset'
  | 'dex-prefix-anomaly'
  | 'extra-block-anomaly'
  | 'duplicate-scheme'
  | 'eocd-not-found';

/** A single anomaly. Free-form `evidence` string for analyst review. */
export interface Anomaly {
  readonly kind: AnomalyKind;
  readonly evidence: string;
}

/** Top-level structured report returned by the parser. */
export interface SigningBlockReport {
  readonly apkPath: string;
  readonly fileSize: number;
  readonly signingBlock: {
    readonly found: boolean;
    readonly magic?: string;
    readonly size?: number;
    readonly offset?: number;
  };
  readonly schemes: {
    readonly v2?: { readonly signers: ReadonlyArray<V2Signer> };
    readonly v3?: {
      readonly signers: ReadonlyArray<V3Signer>;
      readonly keyRotation?: ProofOfRotation;
    };
    readonly v3_1?: { readonly signers: ReadonlyArray<V3Signer> };
    readonly v4?: V4Block;
  };
  readonly unknownBlocks: ReadonlyArray<{ readonly id: string; readonly size: number }>;
  readonly warnings: ReadonlyArray<string>;
  readonly anomalies: ReadonlyArray<Anomaly>;
}

// ── ID constants ──

/** Magic literal at the tail of the Signing Block (16 bytes). */
export const APK_SIG_BLOCK_MAGIC = 'APK Sig Block 42';

/** End of central directory record signature. */
export const EOCD_SIGNATURE = 0x06054b50;

/** Known ID-value block IDs (AOSP + ecosystem). */
export const BLOCK_ID_V2 = 0x7109871a;
export const BLOCK_ID_V3 = 0xf05368c0;
export const BLOCK_ID_V3_1 = 0x1b93ad61;
export const BLOCK_ID_V4 = 0x42726577;
export const BLOCK_ID_SOURCE_STAMP = 0x504b4453;
export const BLOCK_ID_VERITY_PADDING = 0x42726577 ^ 0; // distinct alias slot reserved
export const BLOCK_ID_PROOF_OF_ROTATION_ATTR = 0x3ba06f8c;

/** Non-standard block ID observed in some legacy tooling (not in any official spec). */
export const BLOCK_ID_UNKNOWN_RESIDUE = 0x42424242;

/** First four bytes of a Dalvik EXecutable header ("dex\n"). */
export const DEX_MAGIC = 0x6465780a;

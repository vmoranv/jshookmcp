# Binary Secrets

Domain: `binary-secrets`

Scan binaries for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only informational output.

## Profiles

- full

## Typical scenarios

- Locate candidate key offsets
- Detect high-entropy regions
- Extract Base64/hex encoded keys

## Common combinations

- binary-secrets + apk-packer
- binary-secrets + binary-instrument

## Full tool list (1)

| Tool | Description |
| --- | --- |
| `binary_key_extract` | Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only — no decryption. |

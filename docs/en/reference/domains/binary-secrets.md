# Binary Secrets

Domain: `binary-secrets`

Statically scan a binary for high-entropy windows, Base64/Hex candidates, and hard-coded key shapes; emit offsets + context as audit candidates.

## Profiles

- full

## Typical scenarios

- Hard-coded key candidate discovery
- High-entropy region audit
- Base64/Hex credential leads

## Common combinations

- binary-secrets + dart-inspector
- binary-secrets + apk-packer

## Full tool list (1)

| Tool | Description |
| --- | --- |
| `binary_key_extract` | Scan a binary for hardcoded key candidates (raw high-entropy, Base64, hex). Read-only — no decryption. |

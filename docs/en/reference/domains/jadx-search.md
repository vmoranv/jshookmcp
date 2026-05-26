# Jadx Search

Domain: `jadx-search`

Read-only keyword / regex search over an existing jadx decompile directory. Prefers ripgrep, falls back to Node when unavailable. Never triggers decompilation.

## Profiles

- full

## Typical scenarios

- Decompiled source full-text search
- Call-site discovery
- Java pattern matching

## Common combinations

- jadx-search + apk-packer
- jadx-search + binary-instrument

## Full tool list (1)

| Tool | Description |
| --- | --- |
| `jadx_search_code` | Read-only ripgrep-backed search over an existing jadx decompile directory. ReDoS-guarded; Node fallback. |

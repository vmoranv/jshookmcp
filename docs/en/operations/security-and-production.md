# Security and Production

## Plugin security defaults

Current behavior:

- in `production`, plugin signature verification defaults to enabled
- strict loading requires `MCP_PLUGIN_ALLOWED_DIGESTS`
- the digest allowlist remains the critical **pre-import** trust boundary

## Recommended production configuration

```bash
MCP_PLUGIN_SIGNATURE_REQUIRED=true
MCP_PLUGIN_STRICT_LOAD=true
MCP_PLUGIN_ALLOWED_DIGESTS=<sha256-hex-list>
MCP_PLUGIN_SIGNATURE_SECRET=<shared-secret>
```

## Platform notes

- Windows is still the primary platform for memory write / injection tooling.
- On Linux/macOS, prefer browser hooks, network capture, workflows, and bridge-based analysis where native memory operations are unavailable.

## External bridge guidance

Before relying on these bridges, verify them first:

- `ghidra-bridge`
- `ida-bridge`
- `burp-mcp-sse`

Use either:

- `pnpm run doctor`
- `doctor_environment`

## Camoufox guidance

If Camoufox is missing or its binaries are unavailable, the project now returns a clearer prerequisite error. In that case run:

```bash
pnpm run install:full
```

or:

```bash
pnpm exec camoufox-js fetch
```

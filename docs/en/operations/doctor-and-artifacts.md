# Doctor and Artifact Cleanup

## Environment doctor

### CLI

```bash
pnpm run doctor
```

### MCP maintenance tool

- `doctor_environment`

It checks:

- optional packages like `camoufox-js` and `playwright-core`
- external toolchain commands like wabt, binaryen, and jadx
- local bridge endpoints such as Ghidra, IDA, and Burp
- active transport, profile, extension roots, and retention config
- platform limitations

## Artifact cleanup

### MCP maintenance tool

- `cleanup_artifacts`

Supports:

- `retentionDays`
- `maxTotalBytes`
- `dryRun`

### Environment variables

- `MCP_ARTIFACT_RETENTION_DAYS`
- `MCP_ARTIFACT_MAX_TOTAL_MB`
- `MCP_ARTIFACT_CLEANUP_ON_START`
- `MCP_ARTIFACT_CLEANUP_INTERVAL_MINUTES`

### Managed directories

- `artifacts/`
- `screenshots/`
- `debugger-sessions/`

## Recommended strategy

- On developer machines, start with `dryRun`.
- On long-running instances, enable startup cleanup and interval-based cleanup.
- In short-lived CI environments, keep retention windows very small.

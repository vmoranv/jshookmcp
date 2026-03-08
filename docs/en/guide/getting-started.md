# Getting Started

## Goal

Get from zero to a first successful run quickly:

- install dependencies
- build the project
- run the server
- execute one minimal capture flow
- understand when to use built-in tools, workflows, or plugins

## Requirements

- Node.js `>=20`
- `pnpm`

## Install and build

```bash
pnpm install
pnpm run build
```

If you need Camoufox:

```bash
pnpm run install:full
```

## Run the environment doctor

```bash
pnpm run doctor
```

It checks optional packages, external toolchain commands, bridge health, and retention/security-related config.

## Start the server

```bash
pnpm start
```

## First minimal success path

Start with a composite built-in tool instead of manually chaining many page/network calls:

1. `web_api_capture_session`
2. inspect `artifacts/har/` and `artifacts/reports/`
3. use `network_extract_auth` to inspect auth signals

## When to move to workflows

Move to workflows when you keep repeating:

- enable network capture
- navigate
- click/type/wait
- collect requests
- extract auth

That repetition is the signal to codify the flow.

## When to move to plugins

Move to plugins when you need:

- a new tool name
- an external bridge or integration
- explicit `toolExecution` permission control
- a reusable high-level tool built on top of built-in tools

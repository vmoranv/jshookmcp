# Getting Started

## Goal

Get to a first successful run quickly:

- use the shortest path to run `jshook`
- execute one minimal capture flow
- understand when to use built-in tools, workflows, or plugins

## First, separate two paths

### Path A: you only want to use the main server

This is the default recommended path. **You do not need to clone the repository or build from source first.**

### Path B: you want to develop source code or extensions

You only need to clone repositories and run `pnpm install / build` when:

- you are debugging `jshookmcp` from source
- you are developing your own plugin
- you are developing your own workflow

## Recommended installation path

### Run the main server with npx

```bash
npx @jshookmcp/jshook
```

This is the recommended path for regular users.

## Optional paths

### Global install

```bash
npm install -g @jshookmcp/jshook
```

### Run from source (developer path)

```bash
pnpm install
pnpm run build
pnpm run doctor
pnpm start
```

### Run from source with Camoufox

```bash
pnpm run install:full
pnpm run build
pnpm start
```

## Requirements

### Regular use of the main server

- Node.js `>=20`
- `npm` / `npx`

### Source development

- Node.js `>=20`
- `pnpm`

For detailed `.env` and runtime settings, see [`.env` and Configuration](/en/guide/configuration).

## Environment doctor

For a local development environment, it is still useful to run:

```bash
pnpm run doctor
```

It checks:

- optional package installation
- external toolchain commands such as wabt / binaryen / jadx
- local bridge health for Ghidra / IDA / Burp
- retention and security-related config

## First minimal success path

Start with a composite built-in tool instead of manually chaining many page/network calls:

1. `web_api_capture_session`
2. inspect `artifacts/har/` and `artifacts/reports/`
3. use `network_extract_auth` to inspect auth signals

## When to move to workflows

Move to workflows when you keep repeating:

- enable network capture
- navigate
- click / type
- collect requests
- extract auth

That repetition is the signal to codify the flow.

## When to move to plugins

Move to plugins when you need:

- a new tool name
- an external bridge or integration
- explicit `toolExecution` permission control
- a reusable high-level tool built on top of built-in tools

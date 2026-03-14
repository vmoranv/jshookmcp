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
npx -y @jshookmcp/jshook
```

This is the recommended path for regular users.

First, be explicit about what this is:

- `jshook` is a **stdio MCP server**, not a GUI application.
- When you run it directly in a terminal, seeing no window is normal.
- The process stays attached to the terminal and waits for an MCP client to complete the stdin/stdout handshake.

So “there is no UI” is not, by itself, a failure.

## Common Startup Troubleshooting

### 1. Missing `-y` parameter in npx

If your MCP client launches the server through `npx`, add `-y` explicitly (see the recommended command above). Without it, first-install confirmation can block the client, and many MCP clients cannot answer that prompt. The result usually looks like:

- handshake timeout
- `initialize response` failure
- MCP client startup failure

## MCP client configuration example

### Codex / Claude Code

Use a `stdio` MCP entry like this:

```json
{
  "mcpServers": {
    "jshook": {
      "command": "npx",
      "args": ["-y", "@jshookmcp/jshook"]
    }
  }
}
```

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

- Node.js `>=22`
- `npm` / `npx`

### Source development

- Node.js `>=22`
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

## When to choose Workflows

Move to workflows when you keep repeating:

- enable network capture
- navigate
- click / type
- collect requests
- extract auth

This repetition indicates that it is time to codify the sequence into a Workflow.

## When to choose Plugins

Move to plugins when you need:

- a new tool name
- an external bridge or integration
- explicit `toolExecution` permission control
- a reusable high-level tool built on top of built-in tools

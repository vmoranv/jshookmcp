# Contributing

Thanks for contributing to `jshookmcp`.

## Start here

- Docs home: `/en/`
- Getting started: `/en/guide/getting-started`
- Tool selection: `/en/guide/tool-selection`
- Extension development: `/en/extensions/`
- Operations: `/en/operations/doctor-and-artifacts`

## For regular users

If you only want to use the main server, prefer:

```bash
npx @jshookmcp/jshook
```

You only need to clone repositories and build locally when:

- you are debugging `jshookmcp` from source
- you are developing your own plugin
- you are developing your own workflow

## Before you start developing

- read `README.md` / `README.zh.md`
- start from `docs/index.md`, `docs/guide/getting-started.md`, and `docs/guide/tool-selection.md` for the current information architecture
- if you are adding extension capabilities, start from:
  - `https://github.com/vmoranv/jshook_plugin_template`
  - `https://github.com/vmoranv/jshook_workflow_template`
- if you want your plugin or workflow to be considered for the extension registry, open an issue at:
  - `https://github.com/vmoranv/jshookmcpextension/issues`

## Documentation hygiene rules

- Prefer official **VitePress** capabilities first: locales, sidebar, local search, and the default theme.
- Prefer the official **Prettier CLI** for docs formatting instead of adding extra formatting plugins for marginal gains.
- Only introduce third-party VitePress plugins when official capabilities are clearly insufficient, and explain in the PR:
  - why official capabilities are not enough
  - the plugin maintenance and compatibility risk
  - the rollback path

## Local verification

Run at least:

```bash
pnpm run check:docs-format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run docs:build
pnpm run audit:tools
```

If you are working on dependency or bridge issues, also consider:

```bash
pnpm run doctor
pnpm run format:docs
```

## Extension development guidance

- **If you are only codifying a repeated tool chain**: start with a workflow
- **If you need a new tool surface or an external bridge**: move to a plugin
- **Use least privilege**: only declare the `toolExecution.allowTools` entries you actually need
- **Git hygiene**: do not commit `artifacts/`, `screenshots/`, `debugger-sessions/`, temporary traffic captures, or local secrets

## Testing guidance

- add tests under `tests/server/domains/maintenance/*.test.ts` when you add maintenance tools
- update `tests/server/ExtensionManager.test.ts` when you change extension loading or security logic
- update `tests/server/domains/hooks/*.test.ts` when you change hook presets
- update `tests/server/domains/workflow/handlers.test.ts` when you change composite workflow handlers

## Support the project

If the docs or tools are useful to you, you can support project maintenance:

### WeChat Pay

<img src="/support/wechat.png" alt="WeChat Pay QR code" width="280">

### Alipay

<img src="/support/alipay.png" alt="Alipay QR code" width="280">

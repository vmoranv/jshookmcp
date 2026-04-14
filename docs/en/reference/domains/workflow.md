# Workflow

Domain: `workflow`

Composite workflow and script-library domain; the main built-in orchestration layer.

## Profiles

- workflow
- full

## Typical scenarios

- Capture APIs end-to-end
- Register and verify accounts
- Probe endpoints and inspect bundles

## Common combinations

- workflow + browser + network

## Representative tools

- `register_account_flow` — Automated account registration flow with email verification.
- `page_script_register` — Register a named reusable JavaScript snippet in the Script Library.
- `page_script_run` — Execute a named script from the Script Library in the current page context.
- `api_probe_batch` — Probe multiple API endpoints in a single browser-context fetch burst.
- `js_bundle_search` — Fetch a remote JavaScript bundle and search it with multiple named regex patterns in a single call.
- `batch_register` — Batch account registration with concurrency control, retry policies, and idempotency.
- `list_extension_workflows` — List runtime-loaded extension workflows discovered from plugins/ or workflows/ directories, including metadata needed before execution.
- `run_extension_workflow` — Execute a runtime-loaded extension workflow contract by workflowId. Supports config overrides, per-node input overrides, and an optional timeout override.

## Full tool list (8)

| Tool | Description |
| --- | --- |
| `register_account_flow` | Automated account registration flow with email verification. |
| `page_script_register` | Register a named reusable JavaScript snippet in the Script Library. |
| `page_script_run` | Execute a named script from the Script Library in the current page context. |
| `api_probe_batch` | Probe multiple API endpoints in a single browser-context fetch burst. |
| `js_bundle_search` | Fetch a remote JavaScript bundle and search it with multiple named regex patterns in a single call. |
| `batch_register` | Batch account registration with concurrency control, retry policies, and idempotency. |
| `list_extension_workflows` | List runtime-loaded extension workflows discovered from plugins/ or workflows/ directories, including metadata needed before execution. |
| `run_extension_workflow` | Execute a runtime-loaded extension workflow contract by workflowId. Supports config overrides, per-node input overrides, and an optional timeout override. |

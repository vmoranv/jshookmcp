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

## Full tool list (9)

<details>
<summary><b>API Capture & Probing</b> (3 tools)</summary>

| Tool                      | Description                                                                                                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web_api_capture_session` | Full-chain web API capture workflow: navigate → inject interceptors → perform actions → collect requests → extract auth → optionally export HAR + Markdown report. |
| `api_probe_batch`         | Probe multiple API endpoints in a single browser-context fetch burst.                                                                                              |
| `js_bundle_search`        | Fetch a remote JavaScript bundle and search it with multiple named regex patterns in a single call.                                                                |

</details>

<details>
<summary><b>Account Registration</b> (2 tools)</summary>

| Tool                    | Description                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `register_account_flow` | Automated account registration flow with email verification.                          |
| `batch_register`        | Batch account registration with concurrency control, retry policies, and idempotency. |

</details>

<details>
<summary><b>Script Library</b> (2 tools)</summary>

| Tool                   | Description                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `page_script_register` | Register a named reusable JavaScript snippet in the Script Library.         |
| `page_script_run`      | Execute a named script from the Script Library in the current page context. |

</details>

<details>
<summary><b>Extension Workflows</b> (2 tools)</summary>

| Tool                       | Description                                                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_extension_workflows` | List runtime-loaded extension workflows discovered from plugins/ or workflows/ directories, including metadata needed before execution.                    |
| `run_extension_workflow`   | Execute a runtime-loaded extension workflow contract by workflowId. Supports config overrides, per-node input overrides, and an optional timeout override. |

</details>

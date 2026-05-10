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

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `page_script_register` | Register a named reusable JS snippet in the Script Library. Execute with page_script_run. |
| `page_script_run` | Execute a named script from the Script Library with optional runtime params (__params__). |
| `api_probe_batch` | Batch-probe API endpoints in browser context with auto token injection and HTML skip. |
| `js_bundle_search` | Fetch a remote JS bundle and search it with named regex patterns, with caching and noise filtering. |
| `list_extension_workflows` | List runtime-loaded extension workflows from plugins/ or workflows/ directories. |
| `run_extension_workflow` | Execute an extension workflow by workflowId with optional config and timeout overrides. |

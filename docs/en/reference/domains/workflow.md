# Workflow

Domain: `workflow`

Composite workflow, script-library, and macro-orchestration domain; the main built-in orchestration layer.

## Profiles

- workflow
- full

## Typical scenarios

- Capture APIs end-to-end
- Register and verify accounts
- Probe endpoints and inspect bundles
- Chain multi-step macro workflows

## Common combinations

- workflow + browser + network

## Full tool list (12)

| Tool | Description |
| --- | --- |
| `page_script_register` | Register a named reusable JS snippet in the Script Library. Execute with page_script_run. |
| `page_script_run` | Execute a named script from the Script Library with optional runtime params (__params__). |
| `api_probe_batch` | Batch-probe API endpoints in browser context with auto token injection and HTML skip. |
| `js_bundle_search` | Fetch a remote JS bundle and search it with named regex patterns, with caching and noise filtering. |
| `list_extension_workflows` | List runtime-loaded extension workflows from plugins/ or workflows/ directories. |
| `run_extension_workflow` | Execute an extension workflow by workflowId with optional config and timeout overrides. |
| `reverse_session` | Create, inspect, list, preview, or run an end-to-end reverse-engineering workflow session with artifact root, cross-domain tool calls, and evidence refs. |
| `workflow_run_inspect` | Inspect the global workflow run store: list recent run_extension_workflow / run_macro runs, get a run entry by runId, or fetch the last successful run summary (runId, status, durationMs, stepResultKeys) for a workflow or macro id. |
| `workflow_conditional_step` | Evaluate a condition against the stepResults argument and execute one of two tool branches. Supports built-in predicates: always_true, always_false, any_step_failed, success_rate_gte_N (N=0-100), variable_equals_KEY_VALUE, variable_contains_KEY_VALUE, variable_matches_KEY_REGEX. When stepResults is omitted, an empty set is used, so value-based predicates (variable_*, success_rate_gte_N, any_step_failed) will not match. |
| `workflow_retry_policy` | Configure a global retry policy with exponential backoff for workflow steps. The stored policy is applied by run_extension_workflow / run_macro when individual nodes lack an explicit retry config. Returns the normalised policy. |
| `run_macro` | Execute a registered macro with sequence, parallel, branch, fallback, and retry orchestration. |
| `list_macros` | List all available macros. |

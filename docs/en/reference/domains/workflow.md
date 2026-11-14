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

## Full tool list (13)

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
| `workflow_conditional_step` | Evaluate a condition against the stepResults argument and execute one of two tool branches. Supports built-in predicates: always_true, always_false, any_step_failed, success_rate_gte_N (N=0-100), variable_equals_KEY_VALUE, variable_contains_KEY_VALUE, variable_matches_KEY_REGEX, plus history-driven predicates history_failure_rate_gte_N / history_failure_rate_lte_N, last_run_failed[:workflowId], recent_steps_failing_L[:workflowId], history_fallback_rate_gte_N / history_fallback_rate_lte_N. History predicates read the workflow run store (the last 10 runs of the workflow named by the :workflowId suffix, or the current workflow when none is given); they evaluate false when no history exists. When stepResults is omitted, an empty set is used, so value-based predicates (variable_*, success_rate_gte_N, any_step_failed) will not match. |
| `workflow_retry_policy` | Configure a global retry policy with exponential backoff for workflow steps. The stored policy is applied by run_extension_workflow / run_macro when individual nodes lack an explicit retry config. Returns the normalised policy. |
| `workflow_suggest` | Suggest the next extension workflow to run from the chainsWith / prerequisites chain metadata declared by loaded workflows — typical entry points are starting a new reverse-engineering session for a target, or following up after a first probe of the target's endpoints. Pass the workflow ids already executed in this session; the server stays stateless. Candidates chained from an executed workflow rank first (the reason names the chain), workflows with all prerequisites satisfied rank before those with missing ones, already-executed workflows are never suggested, and executed ids that match no loaded workflow are returned in unmatched. Workflows without chain metadata are never suggested, so an empty catalog of metadata yields empty suggestions. |
| `run_macro` | Execute a registered macro with sequence, parallel, branch, fallback, and retry orchestration. |
| `list_macros` | List all available macros. |

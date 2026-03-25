# Evidence

Domain: `evidence`

Evidence-graph domain that models provenance between URLs, scripts, functions, hooks, and captured artifacts.

## Profiles

- workflow
- full

## Typical scenarios

- Query nodes by URL, function, or script ID
- Traverse forward or backward provenance chains
- Export JSON or Markdown evidence reports

## Common combinations

- instrumentation + evidence
- network + hooks + evidence

## Representative tools

- `evidence_query_url` — Query the reverse evidence graph for all nodes associated with a URL. Returns the connected subgraph including request, initiator-stack, script, function, and captured-data nodes.
- `evidence_query_function` — Query the reverse evidence graph for all nodes associated with a function name. Returns the connected subgraph including function, breakpoint-hook, and captured-data nodes.
- `evidence_query_script` — Query the reverse evidence graph for all nodes associated with a script ID. Returns the connected subgraph including script, function, and downstream nodes.
- `evidence_export_json` — Export the entire reverse evidence graph as a JSON snapshot. Includes all nodes, edges, and metadata.
- `evidence_export_markdown` — Export the reverse evidence graph as a human-readable Markdown report, grouped by node type with edge connections.
- `evidence_chain` — Get the full provenance chain from a specific node ID, traversing edges in the specified direction (forward or backward).

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `evidence_query_url` | Query the reverse evidence graph for all nodes associated with a URL. Returns the connected subgraph including request, initiator-stack, script, function, and captured-data nodes. |
| `evidence_query_function` | Query the reverse evidence graph for all nodes associated with a function name. Returns the connected subgraph including function, breakpoint-hook, and captured-data nodes. |
| `evidence_query_script` | Query the reverse evidence graph for all nodes associated with a script ID. Returns the connected subgraph including script, function, and downstream nodes. |
| `evidence_export_json` | Export the entire reverse evidence graph as a JSON snapshot. Includes all nodes, edges, and metadata. |
| `evidence_export_markdown` | Export the reverse evidence graph as a human-readable Markdown report, grouped by node type with edge connections. |
| `evidence_chain` | Get the full provenance chain from a specific node ID, traversing edges in the specified direction (forward or backward). |

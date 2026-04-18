# Evidence

Domain: `evidence`

Evidence-graph domain that models provenance between URLs, scripts, functions, hooks, and captured artifacts.

## Profiles

- full

## Typical scenarios

- Query nodes by URL, function, or script ID
- Traverse forward or backward provenance chains
- Export JSON or Markdown evidence reports

## Common combinations

- instrumentation + evidence
- network + hooks + evidence

## Representative tools

- `evidence_query_url` — Query reverse evidence graph for all nodes associated with a URL
- `evidence_query_function` — Query reverse evidence graph for all nodes associated with a function name
- `evidence_query_script` — Query reverse evidence graph for all nodes associated with a script ID
- `evidence_export_json` — Export entire reverse evidence graph as JSON snapshot
- `evidence_export_markdown` — Export reverse evidence graph as Markdown report grouped by node type
- `evidence_chain` — Get full provenance chain from a node ID in specified direction

## Full tool list (6)

| Tool | Description |
| --- | --- |
| `evidence_query_url` | Query reverse evidence graph for all nodes associated with a URL |
| `evidence_query_function` | Query reverse evidence graph for all nodes associated with a function name |
| `evidence_query_script` | Query reverse evidence graph for all nodes associated with a script ID |
| `evidence_export_json` | Export entire reverse evidence graph as JSON snapshot |
| `evidence_export_markdown` | Export reverse evidence graph as Markdown report grouped by node type |
| `evidence_chain` | Get full provenance chain from a node ID in specified direction |

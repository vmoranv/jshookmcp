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

- `evidence_query` — Query reverse evidence graph by URL, function name, or script ID to find associated nodes.
- `evidence_export` — Export the reverse evidence graph as JSON snapshot or Markdown report.
- `evidence_chain` — Get full provenance chain from a node ID in specified direction

## Full tool list (3)

| Tool | Description |
| --- | --- |
| `evidence_query` | Query reverse evidence graph by URL, function name, or script ID to find associated nodes. |
| `evidence_export` | Export the reverse evidence graph as JSON snapshot or Markdown report. |
| `evidence_chain` | Get full provenance chain from a node ID in specified direction |

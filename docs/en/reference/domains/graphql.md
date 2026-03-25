# GraphQL

Domain: `graphql`

GraphQL discovery, extraction, replay, and introspection tooling.

## Profiles

- workflow
- full

## Typical scenarios

- Run schema introspection
- Extract queries and mutations from traces
- Replay GraphQL requests

## Common combinations

- network + graphql

## Representative tools

- `call_graph_analyze` — Analyze runtime function call graph from in-page traces (__aiHooks / tracer records). Returns nodes, edges, and stats.
- `script_replace_persist` — Persistently replace matching script responses via request interception, and register metadata with evaluateOnNewDocument.
- `graphql_introspect` — Run GraphQL introspection query against a target endpoint and return schema payload.
- `graphql_extract_queries` — Extract GraphQL queries/mutations from captured in-page network traces (fetch/xhr/aiHook records).
- `graphql_replay` — Replay a GraphQL operation with optional variables and headers via in-page fetch.

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `call_graph_analyze` | Analyze runtime function call graph from in-page traces (__aiHooks / tracer records). Returns nodes, edges, and stats. |
| `script_replace_persist` | Persistently replace matching script responses via request interception, and register metadata with evaluateOnNewDocument. |
| `graphql_introspect` | Run GraphQL introspection query against a target endpoint and return schema payload. |
| `graphql_extract_queries` | Extract GraphQL queries/mutations from captured in-page network traces (fetch/xhr/aiHook records). |
| `graphql_replay` | Replay a GraphQL operation with optional variables and headers via in-page fetch. |

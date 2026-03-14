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

## Full tool list (5)

<details>
<summary><b>GraphQL & Call Graph</b> (5 tools)</summary>

| Tool                      | Description                                                                                                                |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `call_graph_analyze`      | Analyze runtime function call graph from in-page traces (\_\_aiHooks / tracer records). Returns nodes, edges, and stats.   |
| `script_replace_persist`  | Persistently replace matching script responses via request interception, and register metadata with evaluateOnNewDocument. |
| `graphql_introspect`      | Run GraphQL introspection query against a target endpoint and return schema payload.                                       |
| `graphql_extract_queries` | Extract GraphQL queries/mutations from captured in-page network traces (fetch/xhr/aiHook records).                         |
| `graphql_replay`          | Replay a GraphQL operation with optional variables and headers via in-page fetch.                                          |

</details>

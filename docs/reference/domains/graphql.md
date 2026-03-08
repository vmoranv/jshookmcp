# GraphQL

域名：`graphql`

GraphQL 发现、提取、重放与 introspection 能力。

## Profile

- workflow
- full

## 典型场景

- Schema 枚举
- 网络中提取 query/mutation
- GraphQL 重放

## 常见组合

- network + graphql

## 代表工具

- `call_graph_analyze` — Analyze runtime function call graph from in-page traces (\_\_aiHooks / tracer records). Returns nodes, edges, and stats.
- `script_replace_persist` — Persistently replace matching script responses via request interception, and register metadata with evaluateOnNewDocument.
- `graphql_introspect` — Run GraphQL introspection query against a target endpoint and return schema payload.
- `graphql_extract_queries` — Extract GraphQL queries/mutations from captured in-page network traces (fetch/xhr/aiHook records).
- `graphql_replay` — Replay a GraphQL operation with optional variables and headers via in-page fetch.

## 工具清单（5）

| 工具                      | 说明                                                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `call_graph_analyze`      | Analyze runtime function call graph from in-page traces (\_\_aiHooks / tracer records). Returns nodes, edges, and stats.   |
| `script_replace_persist`  | Persistently replace matching script responses via request interception, and register metadata with evaluateOnNewDocument. |
| `graphql_introspect`      | Run GraphQL introspection query against a target endpoint and return schema payload.                                       |
| `graphql_extract_queries` | Extract GraphQL queries/mutations from captured in-page network traces (fetch/xhr/aiHook records).                         |
| `graphql_replay`          | Replay a GraphQL operation with optional variables and headers via in-page fetch.                                          |

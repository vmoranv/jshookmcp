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

## Full tool list (7)

| Tool | Description |
| --- | --- |
| `call_graph_analyze` | Analyze runtime function call graph from in-page traces. |
| `script_replace_persist` | Persistently replace matching script responses. |
| `graphql_introspect` | Run GraphQL introspection and optional Apollo Federation _service.sdl probing. |
| `graphql_extract_queries` | Extract GraphQL queries/mutations from captured network traces. |
| `graphql_replay` | Replay a GraphQL operation with optional variables, batch array, or Apollo persisted-query (APQ) extensions. |
| `graphql_subscribe` | Open a GraphQL subscription WebSocket, perform the graphql-transport-ws (or legacy graphql-ws) handshake, send a subscribe frame, and collect frames for collectMs. Runs in-page so the browser-session auth (cookies + connectionPayload) is preserved. Pairs with graphql_replay for targets that expose queries/mutations only via the authed WebSocket session. |
| `graphql_enum_schema` | Enumerate GraphQL fields from server suggestion errors with introspection fallback. |

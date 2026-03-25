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

- `call_graph_analyze` — 分析页面运行时函数调用图并返回节点、边与统计信息。
- `script_replace_persist` — 持久替换匹配脚本的响应内容，并在新文档中注册元数据。
- `graphql_introspect` — 对目标端点执行 GraphQL introspection 并返回模式数据。
- `graphql_extract_queries` — 从页面内捕获的网络轨迹中提取 GraphQL 查询与变更。
- `graphql_replay` — 通过页面内 fetch 重放 GraphQL 操作，支持变量与请求头覆盖。

## 工具清单（5）

| 工具 | 说明 |
| --- | --- |
| `call_graph_analyze` | 分析页面运行时函数调用图并返回节点、边与统计信息。 |
| `script_replace_persist` | 持久替换匹配脚本的响应内容，并在新文档中注册元数据。 |
| `graphql_introspect` | 对目标端点执行 GraphQL introspection 并返回模式数据。 |
| `graphql_extract_queries` | 从页面内捕获的网络轨迹中提取 GraphQL 查询与变更。 |
| `graphql_replay` | 通过页面内 fetch 重放 GraphQL 操作，支持变量与请求头覆盖。 |

# Reference Overview

当前内置域共 **18** 个，域工具总数 **283**。

## 推荐阅读路径

1. 先看 `browser / network / workflow`，建立日常使用路径。
2. 再看 `debugger / hooks / streaming`，理解运行时分析面。
3. 最后看 `core / sourcemap / transform / wasm / process / platform`，覆盖更深入的逆向面。

## 域矩阵

| 域             | 标题         | 工具数 | 适用 profile           | 典型场景                                                                               |
| -------------- | ------------ | -----: | ---------------------- | -------------------------------------------------------------------------------------- |
| `antidebug`    | AntiDebug    |      6 | full                   | 反反调试域，集中提供检测与绕过浏览器端反调试脚本的工具。                               |
| `browser`      | Browser      |     60 | workflow, full         | 浏览器控制与 DOM 交互主域，也是大多数工作流的入口。                                    |
| `coordination` | Coordination |      4 | workflow, full         | 用于会话洞察记录与 MCP Task Handoff 的协调域，衔接大语言模型的规划与执行。             |
| `core`         | Core         |     14 | workflow, full         | 核心静态/半静态分析域，覆盖脚本采集、反混淆、语义理解、webpack/source map 与加密识别。 |
| `debugger`     | Debugger     |     37 | workflow, full         | 基于 CDP 的断点、单步、调用栈、watch 与调试会话管理域。                                |
| `encoding`     | Encoding     |      5 | workflow, full         | 二进制格式检测、编码转换、熵分析与 protobuf 原始解码。                                 |
| `graphql`      | GraphQL      |      5 | workflow, full         | GraphQL 发现、提取、重放与 introspection 能力。                                        |
| `hooks`        | Hooks        |      8 | full                   | AI Hook 生成、注入、数据导出，以及内置/自定义 preset 管理。                            |
| `maintenance`  | Maintenance  |     12 | search, workflow, full | 运维与维护域，覆盖缓存、token 预算、环境诊断、产物清理与扩展管理。                     |
| `memory`       | Memory       |     41 | workflow, full         | 面向原生内存扫描、指针链分析、结构体推断与断点观测的内存分析域。                       |
| `network`      | Network      |     26 | workflow, full         | 请求捕获、响应体读取、HAR 导出、请求重放与性能追踪。                                   |
| `platform`     | Platform     |      5 | full                   | 宿主平台与包格式分析域，覆盖 miniapp、asar、Electron。                                 |
| `process`      | Process      |     26 | full                   | 进程、模块、内存诊断与受控注入域，适合宿主级分析、故障排查与 Windows 进程实验场景。    |
| `sourcemap`    | SourceMap    |      5 | full                   | SourceMap 发现、抓取、解析与源码树重建。                                               |
| `streaming`    | Streaming    |      6 | workflow, full         | WebSocket 与 SSE 监控域。                                                              |
| `transform`    | Transform    |      6 | full                   | AST/字符串变换与加密实现抽取、测试、对比域。                                           |
| `wasm`         | WASM         |      8 | full                   | WebAssembly dump、反汇编、反编译、优化与离线执行域。                                   |
| `workflow`     | Workflow     |      9 | workflow, full         | 复合工作流与脚本库域，是 built-in 高层编排入口。                                       |

## 重点高层入口

- `web_api_capture_session`：一键抓请求、提取 auth、导出 HAR/报告
- `register_account_flow`：注册 + 邮箱验证流程
- `api_probe_batch`：批量探测 OpenAPI / Swagger / API 端点
- `js_bundle_search`：远程抓取 bundle 并做多模式匹配
- `doctor_environment`：环境依赖与 bridge 健康检查
- `cleanup_artifacts`：按 retention / size 规则清理产物

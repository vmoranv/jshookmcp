# Platform

域名：`platform`

宿主平台与包格式分析域，覆盖 miniapp、asar、Electron。

## Profile

- full

## 典型场景

- 小程序包分析
- Electron 结构检查

## 常见组合

- platform + process
- platform + core

## 代表工具

- `miniapp_pkg_scan` — 扫描本地小程序缓存目录并列出所有包文件。
- `miniapp_pkg_unpack` — 解包小程序包文件，优先使用外部工具，失败时自动降级为 Node.js 解析。
- `miniapp_pkg_analyze` — 分析解包后的小程序结构，提取页面、分包、组件和体积等信息。
- `asar_extract` — 提取 Electron 的 app.asar 内容，支持仅列出文件模式。
- `electron_inspect_app` — 分析 Electron 应用结构，包括 package.json、入口、preload 和依赖信息。

## 工具清单（5）

| 工具 | 说明 |
| --- | --- |
| `miniapp_pkg_scan` | 扫描本地小程序缓存目录并列出所有包文件。 |
| `miniapp_pkg_unpack` | 解包小程序包文件，优先使用外部工具，失败时自动降级为 Node.js 解析。 |
| `miniapp_pkg_analyze` | 分析解包后的小程序结构，提取页面、分包、组件和体积等信息。 |
| `asar_extract` | 提取 Electron 的 app.asar 内容，支持仅列出文件模式。 |
| `electron_inspect_app` | 分析 Electron 应用结构，包括 package.json、入口、preload 和依赖信息。 |

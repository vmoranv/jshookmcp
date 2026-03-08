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

- `miniapp_pkg_scan` — 扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。
- `miniapp_pkg_unpack` — 解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。
- `miniapp_pkg_analyze` — 分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。
- `asar_extract` — 提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。
- `electron_inspect_app` — 分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。

## 工具清单（5）

| 工具                   | 说明                                                                                                     |
| ---------------------- | -------------------------------------------------------------------------------------------------------- |
| `miniapp_pkg_scan`     | 扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。                               |
| `miniapp_pkg_unpack`   | 解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。                          |
| `miniapp_pkg_analyze`  | 分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。                      |
| `asar_extract`         | 提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。                     |
| `electron_inspect_app` | 分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。 |

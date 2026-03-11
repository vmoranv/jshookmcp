# Platform

Domain: `platform`

Platform and package analysis domain covering miniapps, ASAR archives, and Electron apps.

## Profiles

- full

## Typical scenarios

- Inspect miniapp packages
- Analyze Electron application structure

## Common combinations

- platform + process
- platform + core

## Representative tools

- `miniapp_pkg_scan` — 扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。
- `miniapp_pkg_unpack` — 解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。
- `miniapp_pkg_analyze` — 分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。
- `asar_extract` — 提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。
- `electron_inspect_app` — 分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。

## Full tool list (5)

| Tool | Description |
| --- | --- |
| `miniapp_pkg_scan` | 扫描本地小程序缓存目录，列出所有 小程序包文件。默认扫描常见 Windows 路径。 |
| `miniapp_pkg_unpack` | 解包 小程序包文件。优先调用外部 外部解包工具，失败时自动降级为纯 Node.js 解析。 |
| `miniapp_pkg_analyze` | 分析解包后的小程序结构，提取 pages/subPackages/components/jsFiles/totalSize/appId。 |
| `asar_extract` | 提取 Electron app.asar（纯 Node.js 实现，不依赖 @electron/asar）。支持仅列文件模式。 |
| `electron_inspect_app` | 分析 Electron 应用结构（.exe 或 app 目录）：package.json、main、preload、dependencies、devToolsEnabled。 |

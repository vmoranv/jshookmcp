---
layout: home

hero:
  name: JSHookMCP
  text: JavaScript 逆向与自动化文档站
  tagline: 面向浏览器自动化、网络采集、运行时 Hook、扩展开发与工作流编排的 MCP 文档。
  image:
    src: /favicon.png
    alt: JSHookMCP
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/getting-started
    - theme: alt
      text: 扩展开发
      link: /extensions/

features:
  - title: 快速进入状态
    icon: 🚀
    details: 从安装、启动、抓第一批请求，到选择 built-in tools、workflow、plugin 的最短路径。
  - title: 扩展优先文档
    icon: 🧩
    details: 覆盖插件模板仓、工作流模板仓、并行调用与 subagent 侧车分析实践。
  - title: 运维与生产说明
    icon: 🛡️
    details: 集中说明 doctor、产物 retention、安全默认值与跨平台限制。
---

## ⚡ 极速启动

无需繁琐配置，只需一行指令即可在当前目录初始化 JSHookMCP 并启动 MCP 核心进程：

```bash
npx @jshookmcp/jshook init my-workspace
cd my-workspace
npm run mcp
```

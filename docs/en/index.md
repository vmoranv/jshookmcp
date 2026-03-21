---
layout: home

hero:
  name: JSHookMCP
  text: Documentation for reverse workflows and automation
  tagline: MCP documentation for browser automation, network capture, runtime hooks, extension development, and workflow orchestration.
  image:
    src: /favicon.png
    alt: JSHookMCP
  actions:
    - theme: brand
      text: Getting Started
      link: /en/guide/getting-started
    - theme: alt
      text: Extension Docs
      link: /en/extensions/

features:
  - title: Fast onboarding
    icon: 🚀
    details: Start from install, launch, first capture flow, and the shortest path into built-in tools, workflows, and plugins.
  - title: Extension-first docs
    icon: 🧩
    details: Covers plugin and workflow template repositories, parallel invocation, and sidecar subagent patterns.
  - title: Operations and production
    icon: 🛡️
    details: Explains doctor, artifact retention, security defaults, and cross-platform caveats.
---

## ⚡ Quick Start

Initialize JSHookMCP and start the core MCP process in seconds without cumbersome setups:

```bash
npx @jshookmcp/jshook init my-workspace
cd my-workspace
npm run mcp
```

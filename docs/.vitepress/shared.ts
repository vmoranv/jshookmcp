import { defineConfig } from 'vitepress';

const base = process.env.VITEPRESS_BASE || '/';

export const shared = defineConfig({
  title: 'JSHookMCP',
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#0b0f19' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:locale', content: 'zh_CN' }],
    [
      'meta',
      {
        property: 'og:title',
        content: 'JSHookMCP | 检索优先跨域逆向工程与运行时分析工作区 (735 工具, 36 能力域)',
      },
    ],
    ['meta', { property: 'og:site_name', content: 'JSHookMCP' }],
    [
      'meta',
      {
        property: 'og:description',
        content:
          '面向 AI Agent（Claude Code、Cursor、Claude Desktop）的检索优先跨域逆向工程 MCP server：735 个工具、36 个能力域，全链路因果证据图（网络到本地 JNI/Syscall）、Unicorn JNI 无头仿真与 3K Token 检索梯队。',
      },
    ],
    ['meta', { property: 'og:image', content: 'https://vmoranv.github.io/jshookmcp/favicon.png' }],
    ['meta', { property: 'og:url', content: 'https://vmoranv.github.io/jshookmcp/' }],
    [
      'script',
      { type: 'application/ld+json' },
      JSON.stringify({
        '@context': 'https://schema.org',
        '@graph': [
          {
            '@type': 'WebSite',
            '@id': 'https://vmoranv.github.io/jshookmcp/#website',
            url: 'https://vmoranv.github.io/jshookmcp/',
            name: 'JSHookMCP',
            description:
              '面向 AI Agent 的检索优先跨域逆向工程与运行时分析工作区（735 工具，36 能力域）。',
            inLanguage: ['zh-CN', 'en'],
            publisher: { '@id': 'https://vmoranv.github.io/jshookmcp/#org' },
            dateModified: '2026-10-18',
            potentialAction: {
              '@type': 'SearchAction',
              target: 'https://vmoranv.github.io/jshookmcp/?q={search_term_string}',
              'query-input': 'required name=search_term_string',
            },
          },
          {
            '@type': 'Organization',
            '@id': 'https://vmoranv.github.io/jshookmcp/#org',
            name: 'vmoranv',
            url: 'https://vmoranv.github.io/jshookmcp/',
            logo: 'https://vmoranv.github.io/jshookmcp/logo.svg',
            sameAs: [
              'https://github.com/vmoranv/jshookmcp',
              'https://github.com/vmoranv',
              'https://glama.ai/mcp/servers/vmoranv/jshookmcp',
            ],
            address: {
              '@type': 'PostalAddress',
              addressCountry: 'CN',
            },
            areaServed: {
              '@type': 'Place',
              name: 'Worldwide',
            },
            geo: {
              '@type': 'GeoCoordinates',
              latitude: 39.9,
              longitude: 116.4,
            },
            contactPoint: {
              '@type': 'ContactPoint',
              contactType: 'technical support',
              url: 'https://github.com/vmoranv/jshookmcp/issues',
            },
          },
          {
            '@type': 'WebApplication',
            '@id': 'https://vmoranv.github.io/jshookmcp/#app',
            name: 'JSHookMCP',
            url: 'https://vmoranv.github.io/jshookmcp/',
            description:
              'Search-First Agentic Cross-Domain Reverse Engineering Workspace for AI agents (npm: @jshookmcp/jshook, AGPL-3.0). 735 tools across 36 domains unifying network, DOM, V8/WASM, native memory, Unicorn JNI emulation, and kernel syscalls with a 3K-token profile ladder.',
            applicationCategory: 'DeveloperApplication, ReverseEngineeringTool',
            operatingSystem: 'Windows, macOS, Linux',
            softwareVersion: '0.4.2',
            featureList: [
              'Search-First 3K-Token Profile Ladder (BM25 + ONNX micro-embeddings + RRF)',
              'Cross-Domain Causal Evidence Graph (Network <-> DOM <-> V8/WASM <-> Native Memory <-> Unicorn JNI <-> Syscalls)',
              'Headless Android Native JNI Emulation without devices (nemu / Unicorn)',
              'Flutter & Dart AOT Snapshot Runtime Introspection (dart-inspector)',
              'Chromium Mojo IPC Sniffing & Mocking (mojo-ipc)',
              'Low-level In-Memory Forensics (AOB scanning, pointer maps, vtables, code caves)',
              'Dynamic Binary Instrumentation (Frida, Ghidra, IDA, JADX bridges)',
              'Full-stack Network Interception (HTTP/2, gRPC, Protobuf, TLS NSS keylog)',
              'Stealth Browser Automation & Fingerprint Evasion (Chromium/Camoufox CDP)',
            ],
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
            },
            author: {
              '@type': 'Person',
              '@id': 'https://vmoranv.github.io/jshookmcp/#author',
              name: 'vmoranv',
              url: 'https://github.com/vmoranv',
              jobTitle: 'Maintainer',
            },
          },
          {
            '@type': 'TechArticle',
            '@id': 'https://vmoranv.github.io/jshookmcp/#article',
            headline: 'JSHookMCP：面向 AI Agent 的检索优先跨域逆向工程与运行时分析工作区',
            description:
              'JSHookMCP 是一个专为 AI Agent 设计的开源 MCP server，提供 735 个工具与 36 个能力域。通过独创的 3K Token 检索梯队与跨域因果证据图，实现从网络数据包、DOM、V8/WASM 到原生内存、Unicorn JNI 仿真与内核系统调用的闭环动态分析。',
            url: 'https://vmoranv.github.io/jshookmcp/',
            image: 'https://vmoranv.github.io/jshookmcp/logo.svg',
            author: {
              '@type': 'Person',
              name: 'vmoranv',
              url: 'https://github.com/vmoranv',
              jobTitle: 'Maintainer',
            },
            publisher: { '@id': 'https://vmoranv.github.io/jshookmcp/#org' },
            datePublished: '2025-01-01',
            dateModified: '2026-10-18',
            keywords:
              'MCP, Model Context Protocol, Reverse Engineering, AI Agent, Claude Code, Cursor, Unicorn JNI, Frida, Cross-Domain Evidence Graph, Flutter Dart, V8 Turbofan, WASM, Mojo IPC, AOB Scan, Dynamic Analysis',
          },
          {
            '@type': 'FAQPage',
            '@id': 'https://vmoranv.github.io/jshookmcp/#faq',
            mainEntity: [
              {
                '@type': 'Question',
                name: '支持哪些 MCP 客户端？',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: '任何标准 MCP 客户端（Claude Desktop、Cursor、Claude Code、Windsurf、Antigravity 等），通过 stdio 或 Streamable HTTP 接入。只需一行 npx -y @jshookmcp/jshook 即可使用。',
                },
              },
              {
                '@type': 'Question',
                name: 'JSHookMCP 的核心技术差异点是什么？',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'JSHookMCP 具备六大核心技术优势：(1) 检索优先 3K-Token 梯队架构（解决 735 个工具挤爆上下文问题）；(2) 跨域全链路因果证据图（从网络数据包穿透至原生 JNI 与 Syscall）；(3) 无设备 Unicorn Android JNI 无头仿真；(4) Flutter/Dart AOT 快照运行时内省；(5) Chromium Mojo IPC 嗅探与 Mock；(6) Cheat Engine 级别的底层内存扫描与取证。',
                },
              },
              {
                '@type': 'Question',
                name: '36 个能力域是什么？',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: '涵盖 cross-domain、native-emulator、dart-inspector、mojo-ipc、memory、v8-inspector、wasm、binary-instrument、browser、network、tls-inspector、syscall-hook 等 36 个按职责划分的工具域，共 735 个工具。',
                },
              },
              {
                '@type': 'Question',
                name: '跨平台底层支持如何实现？',
                acceptedAnswer: {
                  '@type': 'Answer',
                  text: 'Windows（Win32 API/VEH/PE 取证）、macOS（Mach trap 端口与反汇编）、Linux（POSIX syscall/eBPF），全部基于高效的跨平台 FFI 架构无缝支持。',
                },
              },
            ],
          },
        ],
      }),
    ],
    [
      'link',
      {
        rel: 'alternate',
        type: 'application/rss+xml',
        title: 'JSHookMCP Feed',
        href: `${base}feed.rss`,
      },
    ],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600&family=Outfit:wght@400;500;600;700&display=swap',
      },
    ],
  ],
  themeConfig: {
    logo: `${base}logo.svg`,
    search: {
      provider: 'local',
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/vmoranv/jshookmcp' }],
    footer: {
      message: 'Released under AGPL-3.0-only',
      copyright: 'Copyright © vmoranv and contributors',
    },
  },
});

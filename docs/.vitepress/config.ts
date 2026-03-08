import { defineConfig } from 'vitepress';

const sharedThemeConfig = {
  logo: '/logo.svg',
  search: {
    provider: 'local',
  },
  socialLinks: [{ icon: 'github', link: 'https://github.com/vmoranv/jshookmcp' }],
};

const zhNav = [
  { text: '首页', link: '/' },
  { text: '指南', link: '/guide/getting-started' },
  { text: 'Reference', link: '/reference/' },
  { text: '扩展', link: '/extensions/' },
  { text: '运维', link: '/operations/doctor-and-artifacts' },
  { text: '贡献', link: '/contributing' },
];

const enNav = [
  { text: 'Home', link: '/en/' },
  { text: 'Guide', link: '/en/guide/getting-started' },
  { text: 'Reference', link: '/en/reference/' },
  { text: 'Extensions', link: '/en/extensions/' },
  { text: 'Operations', link: '/en/operations/doctor-and-artifacts' },
  { text: 'Contributing', link: '/en/contributing' },
];

const zhSidebar = {
  '/guide/': [
    {
      text: '指南',
      items: [
        { text: '快速开始', link: '/guide/getting-started' },
        { text: '工具选择', link: '/guide/tool-selection' },
      ],
    },
  ],
  '/extensions/': [
    {
      text: '扩展开发',
      items: [
        { text: '总览', link: '/extensions/' },
        { text: '模板仓与路径', link: '/extensions/templates' },
        { text: 'Plugin 开发流程', link: '/extensions/plugin-development' },
        { text: 'Workflow 开发流程', link: '/extensions/workflow-development' },
        { text: '扩展 API 与运行时边界', link: '/extensions/api' },
      ],
    },
  ],
  '/reference/': [
    {
      text: 'Reference',
      items: [
        { text: 'Overview', link: '/reference/' },
        { text: 'Core', link: '/reference/domains/core' },
        { text: 'Browser', link: '/reference/domains/browser' },
        { text: 'Network', link: '/reference/domains/network' },
        { text: 'Workflow', link: '/reference/domains/workflow' },
        { text: 'Debugger', link: '/reference/domains/debugger' },
        { text: 'Hooks', link: '/reference/domains/hooks' },
        { text: 'Streaming', link: '/reference/domains/streaming' },
        { text: 'WASM', link: '/reference/domains/wasm' },
        { text: 'Transform', link: '/reference/domains/transform' },
        { text: 'SourceMap', link: '/reference/domains/sourcemap' },
        { text: 'Process', link: '/reference/domains/process' },
        { text: 'Platform', link: '/reference/domains/platform' },
        { text: 'AntiDebug', link: '/reference/domains/antidebug' },
        { text: 'Encoding', link: '/reference/domains/encoding' },
        { text: 'GraphQL', link: '/reference/domains/graphql' },
        { text: 'Maintenance', link: '/reference/domains/maintenance' },
      ],
    },
  ],
  '/operations/': [
    {
      text: '运维与安全',
      items: [
        { text: '环境诊断与产物清理', link: '/operations/doctor-and-artifacts' },
        { text: '安全与生产建议', link: '/operations/security-and-production' },
      ],
    },
  ],
};

const enSidebar = {
  '/en/guide/': [
    {
      text: 'Guide',
      items: [
        { text: 'Getting Started', link: '/en/guide/getting-started' },
        { text: 'Tool Selection', link: '/en/guide/tool-selection' },
      ],
    },
  ],
  '/en/extensions/': [
    {
      text: 'Extensions',
      items: [
        { text: 'Overview', link: '/en/extensions/' },
        { text: 'Templates and Paths', link: '/en/extensions/templates' },
        { text: 'Plugin Development Flow', link: '/en/extensions/plugin-development' },
        { text: 'Workflow Development Flow', link: '/en/extensions/workflow-development' },
        { text: 'Extension API and Runtime Boundaries', link: '/en/extensions/api' },
      ],
    },
  ],
  '/en/reference/': [
    {
      text: 'Reference',
      items: [
        { text: 'Overview', link: '/en/reference/' },
        { text: 'Core', link: '/en/reference/domains/core' },
        { text: 'Browser', link: '/en/reference/domains/browser' },
        { text: 'Network', link: '/en/reference/domains/network' },
        { text: 'Workflow', link: '/en/reference/domains/workflow' },
        { text: 'Debugger', link: '/en/reference/domains/debugger' },
        { text: 'Hooks', link: '/en/reference/domains/hooks' },
        { text: 'Streaming', link: '/en/reference/domains/streaming' },
        { text: 'WASM', link: '/en/reference/domains/wasm' },
        { text: 'Transform', link: '/en/reference/domains/transform' },
        { text: 'SourceMap', link: '/en/reference/domains/sourcemap' },
        { text: 'Process', link: '/en/reference/domains/process' },
        { text: 'Platform', link: '/en/reference/domains/platform' },
        { text: 'AntiDebug', link: '/en/reference/domains/antidebug' },
        { text: 'Encoding', link: '/en/reference/domains/encoding' },
        { text: 'GraphQL', link: '/en/reference/domains/graphql' },
        { text: 'Maintenance', link: '/en/reference/domains/maintenance' },
      ],
    },
  ],
  '/en/operations/': [
    {
      text: 'Operations',
      items: [
        { text: 'Doctor and Artifact Cleanup', link: '/en/operations/doctor-and-artifacts' },
        { text: 'Security and Production', link: '/en/operations/security-and-production' },
      ],
    },
  ],
};

export default defineConfig({
  lang: 'zh-CN',
  title: 'JSHookMCP',
  description: '面向 JavaScript 逆向、浏览器自动化、网络采集与扩展开发的 MCP 文档站。',
  base: process.env.VITEPRESS_BASE || '/',
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    ...sharedThemeConfig,
    footer: {
      message: 'Released under AGPL-3.0-only',
      copyright: 'Copyright © vmoranv and contributors',
    },
  },
  locales: {
    root: {
      label: '简体中文',
      lang: 'zh-CN',
      title: 'JSHookMCP',
      description: '面向 JavaScript 逆向、浏览器自动化、网络采集与扩展开发的 MCP 文档站。',
      themeConfig: {
        nav: zhNav,
        sidebar: zhSidebar,
        outlineTitle: '本页目录',
        docFooter: {
          prev: '上一页',
          next: '下一页',
        },
        returnToTopLabel: '返回顶部',
        sidebarMenuLabel: '菜单',
        darkModeSwitchLabel: '主题',
      },
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      title: 'JSHookMCP',
      description:
        'Documentation site for JavaScript reverse engineering, browser automation, network capture, and extension development.',
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
        outlineTitle: 'On this page',
        docFooter: {
          prev: 'Previous page',
          next: 'Next page',
        },
        returnToTopLabel: 'Back to top',
        sidebarMenuLabel: 'Menu',
        darkModeSwitchLabel: 'Theme',
      },
    },
  },
});

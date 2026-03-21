import { defineConfig } from 'vitepress';

const sharedThemeConfig = {
  logo: '/logo.svg',
  search: {
    provider: 'local' as const,
  },
  socialLinks: [{ icon: 'github', link: 'https://github.com/vmoranv/jshookmcp' }],
};

const zhNav = [
  { text: '首页', link: '/' },
  { text: '指南', link: '/guide/getting-started' },
  { text: '参考', link: '/reference/' },
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
        { text: '.env 与配置', link: '/guide/configuration' },
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
      text: '参考',
      items: [
        { text: '总览', link: '/reference/' },
        { text: '核心', link: '/reference/domains/core' },
        { text: '浏览器', link: '/reference/domains/browser' },
        { text: '协调', link: '/reference/domains/coordination' },
        { text: '网络', link: '/reference/domains/network' },
        { text: '工作流', link: '/reference/domains/workflow' },
        { text: '调试器', link: '/reference/domains/debugger' },
        { text: '钩子', link: '/reference/domains/hooks' },
        { text: '流式', link: '/reference/domains/streaming' },
        { text: 'WASM', link: '/reference/domains/wasm' },
        { text: '变换', link: '/reference/domains/transform' },
        { text: '源映射', link: '/reference/domains/sourcemap' },
        { text: '进程', link: '/reference/domains/process' },
        { text: '平台', link: '/reference/domains/platform' },
        { text: '反反调试', link: '/reference/domains/antidebug' },
        { text: '编码', link: '/reference/domains/encoding' },
        { text: '图查询', link: '/reference/domains/graphql' },
        { text: '维护', link: '/reference/domains/maintenance' },
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
  '/contributing': [
    {
      text: '生态与贡献',
      items: [{ text: '贡献指南', link: '/contributing' }],
    },
  ],
};

const enSidebar = {
  '/en/guide/': [
    {
      text: 'Guide',
      items: [
        { text: 'Getting Started', link: '/en/guide/getting-started' },
        { text: '.env and Configuration', link: '/en/guide/configuration' },
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
        { text: 'Coordination', link: '/en/reference/domains/coordination' },
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
  '/en/contributing': [
    {
      text: 'Ecosystem & Contribution',
      items: [{ text: 'Contributing Guide', link: '/en/contributing' }],
    },
  ],
};

const base = process.env.VITEPRESS_BASE || '/';

export default defineConfig({
  lang: 'zh-CN',
  title: 'JSHookMCP',
  description: '面向 JavaScript 逆向、浏览器自动化、网络采集与扩展开发的 MCP 文档站。',
  base,
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/png', href: `${base}favicon.png` }],
    ['meta', { name: 'theme-color', content: '#0b0f19' }],
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
        editLink: {
          pattern: 'https://github.com/vmoranv/jshookmcp/edit/master/docs/:path',
          text: '发现文档有问题？在 GitHub 上编辑此页',
        },
        lastUpdatedText: '最后更新于',
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
        editLink: {
          pattern: 'https://github.com/vmoranv/jshookmcp/edit/master/docs/:path',
          text: 'Edit this page on GitHub',
        },
        lastUpdatedText: 'Last updated',
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

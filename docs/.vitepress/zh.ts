import { defineConfig } from 'vitepress';

export const zh = defineConfig({
  lang: 'zh-CN',
  description: '面向 JavaScript 逆向、浏览器自动化、网络采集与扩展开发的 MCP 文档站。',
  themeConfig: {
    nav: [
      { text: '首页', link: '/' },
      { text: '指南', link: '/guide/getting-started' },
      { text: '参考', link: '/reference/' },
      { text: '扩展', link: '/extensions/' },
      { text: '运维', link: '/operations/doctor-and-artifacts' },
      { text: '贡献', link: '/contributing' },
    ],
    sidebar: {
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
            { text: '宏', link: '/reference/domains/macro' },
            { text: '沙盒', link: '/reference/domains/sandbox' },
            { text: '钩子', link: '/reference/domains/hooks' },
            { text: '流式', link: '/reference/domains/streaming' },
            { text: '调用栈/追踪', link: '/reference/domains/trace' },
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
    },
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
});

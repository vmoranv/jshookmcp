import type { DefaultTheme, LocaleSpecificConfig } from 'vitepress';
import { referenceSidebarItems } from './sidebar-reference-zh';

export const zh = {
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
      { text: '关于', link: '/about' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '指南',
          items: [
            { text: '快速开始', link: '/guide/getting-started' },
            { text: '最佳实践', link: '/guide/best-practices' },
            { text: '.env 与配置', link: '/guide/configuration' },
            { text: '遥测', link: '/guide/telemetry' },
            { text: '工具选择', link: '/guide/tool-selection' },
            { text: 'Troubleshooting', link: '/guide/troubleshooting' },
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
          items: referenceSidebarItems,
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
    outline: { label: '本页目录' },
    editLink: {
      pattern: 'https://github.com/vmoranv/jshookmcp/edit/master/docs/:path',
      text: '发现文档有问题？在 GitHub 上编辑此页',
    },
    lastUpdated: { text: '最后更新于' },
    docFooter: {
      prev: '上一页',
      next: '下一页',
    },
    returnToTopLabel: '返回顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
  },
} satisfies LocaleSpecificConfig<DefaultTheme.Config>;

import { defineConfig } from 'vitepress';

export const en = defineConfig({
  lang: 'en-US',
  description:
    'Documentation site for JavaScript reverse engineering, browser automation, network capture, and extension development.',
  themeConfig: {
    nav: [
      { text: 'Home', link: '/en/' },
      { text: 'Guide', link: '/en/guide/getting-started' },
      { text: 'Reference', link: '/en/reference/' },
      { text: 'Extensions', link: '/en/extensions/' },
      { text: 'Operations', link: '/en/operations/doctor-and-artifacts' },
      { text: 'Contributing', link: '/en/contributing' },
    ],
    sidebar: {
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
            { text: 'Macro', link: '/en/reference/domains/macro' },
            { text: 'Sandbox', link: '/en/reference/domains/sandbox' },
            { text: 'Hooks', link: '/en/reference/domains/hooks' },
            { text: 'Streaming', link: '/en/reference/domains/streaming' },
            { text: 'Trace', link: '/en/reference/domains/trace' },
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
    },
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
});

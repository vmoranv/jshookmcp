import { defineConfig } from 'vitepress';
import { referenceSidebarItems } from './sidebar-reference-en.mjs';

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
      { text: 'About', link: '/en/about' },
    ],
    sidebar: {
      '/en/guide/': [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/en/guide/getting-started' },
            { text: 'Best Practices', link: '/en/guide/best-practices' },
            { text: '.env and Configuration', link: '/en/guide/configuration' },
            { text: 'Telemetry', link: '/en/guide/telemetry' },
            { text: 'Tool Selection', link: '/en/guide/tool-selection' },
            { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
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
          items: referenceSidebarItems,
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

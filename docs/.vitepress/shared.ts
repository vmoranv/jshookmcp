import { defineConfig } from 'vitepress';

export const base = process.env.VITEPRESS_BASE || '/';

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
    ['meta', { property: 'og:title', content: 'JSHookMCP | JavaScript 逆向与自动化' }],
    ['meta', { property: 'og:site_name', content: 'JSHookMCP' }],
    ['meta', { property: 'og:image', content: 'https://vmoranv.github.io/jshookmcp/favicon.png' }],
    ['meta', { property: 'og:url', content: 'https://vmoranv.github.io/jshookmcp/' }],
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
    logo: '/logo.svg',
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

import type { MissionWorkflow } from '../types';

export const bundleUnpackMission: MissionWorkflow = {
  id: 'bundle-unpack',
  name: 'Bundle 展开 / Bundle Unpack',
  description:
    'Detect, extract, and deobfuscate Webpack/Vite/Rollup bundles to recover readable source code.',
  triggerPatterns: [
    /bundle\s*(unpack|extract|展开|解包|deobfuscat)/i,
    /(webpack|vite|rollup)\s*(extract|reverse|逆向|source)/i,
    /(展开|解包|还原).*(bundle|打包)/i,
  ],
  requiredDomains: ['workflow', 'sourcemap'],
  priority: 85,
  steps: [
    {
      id: 'detect',
      toolName: 'js_bundle_search',
      description:
        'Search the bundle for bundler signatures, module wrappers, and candidate entry points',
      prerequisites: [],
      evidenceNodeType: 'script',
    },
    {
      id: 'extract',
      toolName: 'sourcemap_discover',
      description:
        'Discover whether a source map or reconstruction hint is available for the bundle',
      prerequisites: ['detect'],
      evidenceNodeType: 'script',
    },
    {
      id: 'parse',
      toolName: 'sourcemap_fetch_and_parse',
      description: 'Fetch and parse the source map metadata when present',
      prerequisites: ['extract'],
      parallel: true,
      evidenceNodeType: 'script',
    },
    {
      id: 'map',
      toolName: 'sourcemap_reconstruct_tree',
      description: 'Reconstruct the source tree from the parsed source map payload',
      prerequisites: ['parse'],
      evidenceNodeType: 'replay-artifact',
    },
  ],
};

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    plugin: 'src/plugin.ts',
    workflow: 'src/workflow.ts',
    'bridges/index': 'src/bridges/index.ts',
  },
  format: ['esm'],
  target: 'node20.19.0',
  clean: true,
  dts: true,
});

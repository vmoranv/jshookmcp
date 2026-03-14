/**
 * Generates dist/index.js as a re-export shim so that users who configure
 * their MCP path as "dist/index.js" (instead of "dist/src/index.js") still
 * get a working entry point.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const target = join(process.cwd(), 'dist', 'index.js');

writeFileSync(
  target,
  `#!/usr/bin/env node\nexport * from './src/index.js';\n`,
  'utf8'
);

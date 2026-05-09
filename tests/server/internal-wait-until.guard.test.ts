import { describe, expect, it } from 'vitest';
import { glob } from 'tinyglobby';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';

const ALLOWED_NETWORKIDLE_LEGACY_FILES = new Set([
  'src/modules/browser/navigation-wait-until.ts',
  'src/modules/collector/playwright-cdp-fallback.ts',
  'src/server/domains/browser/page-navigation-wait-until.ts',
]);

describe('internal waitUntil guard', () => {
  it('does not allow legacy Puppeteer networkidle enums outside the compatibility layer', async () => {
    const files = await glob(['src/**/*.ts'], {
      cwd: process.cwd(),
      absolute: true,
    });

    const offenders: string[] = [];

    for (const file of files) {
      const relPath = relative(process.cwd(), file).replace(/\\/g, '/');
      if (ALLOWED_NETWORKIDLE_LEGACY_FILES.has(relPath)) continue;

      const content = await readFile(file, 'utf8');
      if (content.includes('networkidle0') || content.includes('networkidle2')) {
        offenders.push(relPath);
      }
    }

    expect(offenders).toEqual([]);
  });
});

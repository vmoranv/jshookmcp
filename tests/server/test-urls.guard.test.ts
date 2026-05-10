import { describe, expect, it } from 'vitest';
import { glob } from 'tinyglobby';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import ts from 'typescript';

const ALLOWED_LITERAL_PATTERNS = [
  'tests/shared/test-urls.ts',
  'tests/server/test-urls.guard.test.ts',
];

function isPlaceholderHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (normalized === 'site' || normalized === 'test') return true;
  if (normalized.endsWith('.example.com')) return true;

  const suffix = normalized.split('.').pop();
  return suffix === 'example' || suffix === 'test' || suffix === 'local' || suffix === 'invalid';
}

function isDisallowedLiteralUrl(value: string): boolean {
  if (value.startsWith('https://vmoranv.github.io/jshookmcp/')) {
    return true;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== 'http:' &&
    url.protocol !== 'https:' &&
    url.protocol !== 'ws:' &&
    url.protocol !== 'wss:' &&
    url.protocol !== 'ftp:'
  ) {
    return false;
  }

  return isPlaceholderHost(url.host);
}

function isDisallowedTemplateUrl(headText: string): boolean {
  const match = headText.match(/^(https?|wss?|ftp):\/\/([^/]+)(?:\/.*)?$/i);
  if (!match || !match[2]) return false;

  if (headText.startsWith('https://vmoranv.github.io/jshookmcp/')) {
    return true;
  }

  return isPlaceholderHost(match[2]);
}

function isAllowed(relPath: string): boolean {
  return ALLOWED_LITERAL_PATTERNS.includes(relPath.replace(/\\/g, '/'));
}

describe('test URL guard', () => {
  it(
    'does not allow scattered placeholder/test site URLs outside shared entrypoints',
    { timeout: 60_000 },
    async () => {
      const files = await glob(['tests/**/*.ts'], {
        cwd: process.cwd(),
        absolute: true,
      });

      const offenders: string[] = [];

      for (const file of files) {
        const relPath = relative(process.cwd(), file).replace(/\\/g, '/');
        if (isAllowed(relPath)) continue;

        const content = await readFile(file, 'utf8');
        const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
        let foundOffender = false;

        const visit = (node: ts.Node) => {
          if (foundOffender) return;

          if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
            if (isDisallowedLiteralUrl(node.text)) {
              foundOffender = true;
              return;
            }
          }

          if (ts.isTemplateExpression(node)) {
            const headText =
              node.head.text + node.templateSpans.map((span) => '${}' + span.literal.text).join('');
            if (isDisallowedTemplateUrl(headText)) {
              foundOffender = true;
              return;
            }
          }

          ts.forEachChild(node, visit);
        };

        visit(sourceFile);

        if (foundOffender) {
          offenders.push(relPath);
        }
      }

      expect(offenders).toEqual([]);
    },
  );
});

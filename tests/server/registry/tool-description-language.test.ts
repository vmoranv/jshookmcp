/**
 * Guards the model-facing tool surface against mixed-language descriptions.
 *
 * Tool names, descriptions, and parameter descriptions are sent to every MCP
 * client and embedded in the search index. Chinese belongs in the localized
 * documentation under docs/ (zh default) and in bilingual workflowRule routing
 * patterns, not in the catalog payload itself.
 */
import { describe, expect, it } from 'vitest';

import { GENERATED_TOOL_CATALOG } from '@server/registry/generated-tool-catalog';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

function collectCjkDescriptions(value: unknown, path: string, out: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectCjkDescriptions(entry, `${path}[${index}]`, out));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (key === 'description' && typeof child === 'string' && CJK.test(child)) {
      out.push(`${childPath}: ${child}`);
      continue;
    }
    collectCjkDescriptions(child, childPath, out);
  }
}

describe('generated tool descriptions', () => {
  it('keeps the model-facing catalog English-only', () => {
    const violations: string[] = [];
    for (const entry of GENERATED_TOOL_CATALOG) {
      collectCjkDescriptions(entry.tool, entry.tool.name, violations);
    }
    expect(violations).toEqual([]);
  });
});

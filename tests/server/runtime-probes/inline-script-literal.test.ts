import { describe, expect, it } from 'vitest';

async function loadInlineScriptHelpers() {
  return await import('../../../scripts/runtime-probes/helpers/inline-script.mjs');
}

describe('runtime probe inline script serialization', () => {
  it('escapes characters that can break inline script parsing', async () => {
    const { escapeInlineScriptLiteral } = await loadInlineScriptHelpers();

    expect(escapeInlineScriptLiteral('</script><>/')).toBe(
      '\\u003C\\u002Fscript\\u003E\\u003C\\u003E\\u002F',
    );
  });

  it('preserves JSON values while removing unsafe inline-script characters', async () => {
    const { serializeForInlineScript } = await loadInlineScriptHelpers();
    const input = {
      marker: '</script>',
      separators: `line${String.fromCharCode(0x2028)}paragraph${String.fromCharCode(0x2029)}`,
    };

    const serialized = serializeForInlineScript(input);
    const roundTripped = Function(`return (${serialized});`)() as typeof input;

    expect(serialized).not.toContain('</script>');
    expect(serialized.includes(String.fromCharCode(0x2028))).toBe(false);
    expect(serialized.includes(String.fromCharCode(0x2029))).toBe(false);
    expect(serialized).toContain('\\u003C\\u002Fscript\\u003E');
    expect(serialized).toContain('\\u2028');
    expect(serialized).toContain('\\u2029');
    expect(roundTripped).toEqual(input);
  });

  it('serializes strings to code-point arrays that round-trip safely', async () => {
    const { serializeToCodePointArrayLiteral } = await loadInlineScriptHelpers();
    const input = '</script>emoji:😀separator:\u2028tail';

    const serialized = serializeToCodePointArrayLiteral(input);
    const roundTripped = Function(
      `return String.fromCodePoint(...${serialized});`,
    )() as typeof input;

    expect(serialized).toMatch(/^\[(\d+,)*\d+\]$/);
    expect(serialized).not.toContain('</script>');
    expect(serialized.includes(String.fromCharCode(0x2028))).toBe(false);
    expect(roundTripped).toBe(input);
  });
});

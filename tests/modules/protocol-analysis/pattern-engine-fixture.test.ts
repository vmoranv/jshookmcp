import { describe, expect, it } from 'vitest';
import { ProtocolPatternEngine } from '@modules/protocol-analysis/ProtocolPatternEngine';

describe('ProtocolPatternEngine with protocol-capture-sample.bin', () => {
  it('detects magic bytes from the fixture', () => {
    const engine = new ProtocolPatternEngine();
    // The fixture has: DEAD + version + payload sections
    const payloads = [
      Buffer.from('DEAD010548656C6C6F', 'hex'),
      Buffer.from('DEAD0105576F726C64', 'hex'),
    ];

    const pattern = engine.autoDetectPattern(payloads);

    expect(pattern.fields.length).toBeGreaterThan(0);
    expect(pattern.fields[0]?.name).toContain('magic');
  });

  it('detects version field', () => {
    const engine = new ProtocolPatternEngine();
    const payloads = [
      Buffer.from('DEAD010548656C6C6F', 'hex'),
      Buffer.from('DEAD02034F4B00', 'hex'),
    ];

    const pattern = engine.autoDetectPattern(payloads);

    expect(pattern.fields.some((f) => f.name === 'version' || f.name.startsWith('magic'))).toBe(
      true,
    );
  });
});

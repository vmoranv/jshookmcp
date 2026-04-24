import { describe, it, expect, vi } from 'vitest';

const loggerState = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@utils/logger', () => ({
  logger: loggerState,
}));

import {
  SourcemapGenerator,
  createSourcemapForTransformation,
} from '@modules/deobfuscator/SourcemapGenerator';

describe('SourcemapGenerator', () => {
  describe('addSource / addMapping / generate', () => {
    it('creates a valid sourcemap v3 JSON', () => {
      const gen = new SourcemapGenerator({ source: 'input.js' });
      gen.addMapping(1, 0, 0, 1, 0);
      gen.addMapping(1, 5, 0, 1, 5);
      const map = gen.generate('var x = 1;');
      const parsed = JSON.parse(map);
      expect(parsed.version).toBe(3);
      expect(parsed.sources).toContain('input.js');
      expect(parsed.mappings).toBeTruthy();
    });

    it('generateInline appends base64 data URL comment', () => {
      const gen = new SourcemapGenerator({ source: 'input.js' });
      gen.addMapping(1, 0, 0, 1, 0);
      const inline = gen.generateInline('var x = 1;');
      expect(inline).toContain('//# sourceMappingURL=data:application/json;base64,');
    });

    it('setSourceRoot and setFile appear in output', () => {
      const gen = new SourcemapGenerator();
      gen.setSourceRoot('/src');
      gen.setFile('out.js');
      gen.addMapping(1, 0, 0, 1, 0);
      const map = JSON.parse(gen.generate('var x = 1;'));
      expect(map.sourceRoot).toBe('/src');
      expect(map.file).toBe('out.js');
    });

    it('addSource returns source index and deduplicates', () => {
      const gen = new SourcemapGenerator();
      const idx1 = gen.addSource('a.js', 'content a');
      const idx2 = gen.addSource('b.js', 'content b');
      const idx3 = gen.addSource('a.js', 'new content');
      expect(idx1).toBe(0);
      expect(idx2).toBe(1);
      expect(idx3).toBe(0);
    });

    it('addName returns index and deduplicates', () => {
      const gen = new SourcemapGenerator();
      const n1 = gen.addName('foo');
      const n2 = gen.addName('bar');
      const n3 = gen.addName('foo');
      expect(n1).toBe(0);
      expect(n2).toBe(1);
      expect(n3).toBe(0);
    });
  });

  describe('createSourcemapForTransformation', () => {
    it('returns code and sourcemap fields', () => {
      const result = createSourcemapForTransformation('var x = 1;', 'var x = 1;');
      expect(result.code).toBe('var x = 1;');
      expect(result.sourcemap).toBeTruthy();
      expect(() => JSON.parse(result.sourcemap)).not.toThrow();
    });

    it('produces valid v3 sourcemap', () => {
      const original = 'function foo() { return 42; }';
      const transformed = 'function foo() { return 42; }';
      const { sourcemap } = createSourcemapForTransformation(original, transformed);
      const map = JSON.parse(sourcemap);
      expect(map.version).toBe(3);
      expect(Array.isArray(map.sources)).toBe(true);
      expect(typeof map.mappings).toBe('string');
    });

    it('maps unchanged lines column-by-column', () => {
      const original = 'var x = 1;';
      const transformed = 'var x = 1;';
      const { sourcemap } = createSourcemapForTransformation(original, transformed);
      const map = JSON.parse(sourcemap);
      const line1Mappings = map.mappings.split(';')[0];
      expect(line1Mappings).toBeTruthy();
    });

    it('skips mapping for meaningfully changed lines', () => {
      const original = 'var x = 1;';
      const transformed = 'var y = 2;';
      const { sourcemap } = createSourcemapForTransformation(original, transformed);
      const map = JSON.parse(sourcemap);
      expect(map.mappings).toBe('');
    });

    it('maps partial unchanged portions of changed lines', () => {
      const original = 'var abc = 1;';
      const transformed = 'var xyz = 2;';
      const { sourcemap } = createSourcemapForTransformation(original, transformed);
      const map = JSON.parse(sourcemap);
      expect(map.mappings).toBe('');
    });

    it('handles multiline code', () => {
      const original = 'var a = 1;\nvar b = 2;\nvar c = 3;';
      const transformed = 'var a = 1;\nvar b = 2;\nvar c = 3;';
      const { sourcemap } = createSourcemapForTransformation(original, transformed);
      const map = JSON.parse(sourcemap);
      expect(map.sources).toContain('original.js');
      expect(map.mappings).toBeTruthy();
    });

    it('does not throw for empty code', () => {
      expect(() => createSourcemapForTransformation('', '')).not.toThrow();
    });

    it('uses custom source name in sourcemap', () => {
      const result = createSourcemapForTransformation('var x = 1;', 'var x = 1;', {
        source: 'myfile.js',
      });
      const map = JSON.parse(result.sourcemap);
      expect(map.sources).toContain('myfile.js');
    });
  });
});

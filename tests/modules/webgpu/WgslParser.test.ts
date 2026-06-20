import { describe, it, expect } from 'vitest';
import { extractShaderMetadata, extractShaderAst } from '@modules/webgpu/WgslParser';

describe('WgslParser — extractShaderMetadata', () => {
  describe('entry points', () => {
    it('should detect vertex entry points', () => {
      const meta = extractShaderMetadata(
        '@vertex fn main() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }',
      );
      expect(meta.entryPoints).toContainEqual({ name: 'main', stage: 'vertex' });
    });

    it('should detect fragment entry points', () => {
      const meta = extractShaderMetadata(
        '@fragment fn frag() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }',
      );
      expect(meta.entryPoints).toContainEqual({ name: 'frag', stage: 'fragment' });
    });

    it('should detect compute entry points with workgroup_size', () => {
      const meta = extractShaderMetadata('@compute @workgroup_size(64) fn cs() { }');
      expect(meta.entryPoints).toContainEqual({ name: 'cs', stage: 'compute' });
    });

    it('should detect multiple entry points of different stages', () => {
      const shader = `
        @vertex fn vert() -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }
        @fragment fn frag() -> @location(0) vec4<f32> { return vec4<f32>(1.0); }
      `;
      const meta = extractShaderMetadata(shader);
      expect(meta.entryPoints).toHaveLength(2);
      const stages = meta.entryPoints.map((e) => e.stage);
      expect(stages).toContain('vertex');
      expect(stages).toContain('fragment');
    });
  });

  describe('structs (brace-matching)', () => {
    it('should parse a flat struct', () => {
      const shader = `struct Params { color: vec4<f32>, intensity: f32 }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.structs).toHaveLength(1);
      expect(meta.structs?.[0]?.name).toBe('Params');
      expect(meta.structs?.[0]?.fields).toHaveLength(2);
    });

    it('should parse a struct with semicolons between fields', () => {
      const shader = `struct S { a: f32; b: u32; }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.structs?.[0]?.fields).toHaveLength(2);
      expect(meta.structs?.[0]?.fields?.[0]?.name).toBe('a');
      expect(meta.structs?.[0]?.fields?.[1]?.name).toBe('b');
    });

    it('should capture @location on struct fields', () => {
      const shader = `struct VertexInput { @location(0) position: vec3<f32>, @location(1) uv: vec2<f32> }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.attributes).toContainEqual({ name: 'position', location: 0 });
      expect(meta.attributes).toContainEqual({ name: 'uv', location: 1 });
    });

    it('should handle array type with comma inside angle brackets', () => {
      // array<vec4<f32>, 16> contains a comma that must not split the field.
      const shader = `struct S { data: array<vec4<f32>, 16> }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.structs?.[0]?.fields).toHaveLength(1);
      expect(meta.structs?.[0]?.fields?.[0]?.name).toBe('data');
      expect(meta.structs?.[0]?.fields?.[0]?.type).toContain('array');
      expect(meta.structs?.[0]?.fields?.[0]?.type).toContain('16');
    });

    it('should not truncate on braces inside line comments', () => {
      const shader = `struct S { a: f32 // { not a real brace\n }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.structs?.[0]?.fields?.[0]?.name).toBe('a');
    });

    it('should not truncate on braces inside block comments', () => {
      const shader = `struct S { /* } */ a: f32 }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.structs?.[0]?.fields).toHaveLength(1);
      expect(meta.structs?.[0]?.fields?.[0]?.name).toBe('a');
    });

    it('should warn on deeply nested structs exceeding the limit', () => {
      // Build a struct body with nesting beyond MAX_STRUCT_DEPTH (15).
      let body = 'a: f32';
      for (let i = 0; i < 20; i++) {
        body = `{ ${body} }`;
      }
      const shader = `struct Deep ${body}`;
      const meta = extractShaderMetadata(shader);
      expect(meta.parseWarnings?.some((w) => w.includes('nesting exceeded'))).toBe(true);
    });

    it('should warn on unparseable field', () => {
      const shader = `struct S { !!malformed }`;
      const meta = extractShaderMetadata(shader);
      expect(meta.parseWarnings?.some((w) => w.includes('could not parse field'))).toBe(true);
    });
  });

  describe('bindings', () => {
    it('should extract uniform bindings with group and binding', () => {
      const shader = `@group(0) @binding(0) var<uniform> params: Params;`;
      const meta = extractShaderMetadata(shader);
      expect(meta.uniforms).toContainEqual({ name: 'params', binding: 0, group: 0 });
    });

    it('should extract multiple bindings and populate bindingsByType', () => {
      const shader = `
        @group(0) @binding(0) var<uniform> params: Params;
        @group(0) @binding(1) var mySampler: sampler;
        @group(0) @binding(2) var myTexture: texture_2d<f32>;
      `;
      const meta = extractShaderMetadata(shader);
      expect(meta.uniforms).toHaveLength(3);
      expect(meta.bindingsByType).toBeDefined();
      expect(meta.bindingsByType?.['sampler']).toBe(1);
      expect(meta.bindingsByType?.['texture_2d']).toBe(1);
    });

    it('should handle binding without explicit address space', () => {
      const shader = `@group(1) @binding(3) var tex: texture_2d<f32>;`;
      const meta = extractShaderMetadata(shader);
      expect(meta.uniforms).toContainEqual({ name: 'tex', binding: 3, group: 1 });
    });
  });

  describe('attributes', () => {
    it('should deduplicate attributes by location and name', () => {
      const shader = `
        struct VertexInput { @location(0) position: vec3<f32> }
        @vertex fn main(@location(0) position: vec3<f32>) -> @builtin(position) vec4<f32> { return vec4<f32>(0.0); }
      `;
      const meta = extractShaderMetadata(shader);
      const positionAttrs = meta.attributes?.filter((a) => a.name === 'position') ?? [];
      expect(positionAttrs).toHaveLength(1);
    });
  });

  describe('metadata shape', () => {
    it('should always return a parseWarnings array', () => {
      const meta = extractShaderMetadata('@vertex fn main() {}');
      expect(Array.isArray(meta.parseWarnings)).toBe(true);
    });

    it('should tag metadata with format wgsl', () => {
      const meta = extractShaderMetadata('@vertex fn main() {}');
      expect(meta.format).toBe('wgsl');
    });
  });
});

describe('WgslParser — extractShaderAst', () => {
  it('should collect all function names including non-entry-point functions', () => {
    const shader = `
      fn helper() -> f32 { return 1.0; }
      @vertex fn main() -> @builtin(position) vec4<f32> { return vec4<f32>(helper()); }
    `;
    const ast = extractShaderAst(shader);
    expect(ast.functions).toContain('helper');
    expect(ast.functions).toContain('main');
    expect(ast.type).toBe('Module');
  });

  it('should share metadata with extractShaderMetadata', () => {
    const shader = `struct S { a: f32 } @group(0) @binding(0) var<uniform> s: S; @vertex fn main() {}`;
    const ast = extractShaderAst(shader);
    expect(ast.structs).toHaveLength(1);
    expect(ast.uniforms).toHaveLength(1);
    expect(ast.parseWarnings).toEqual([]);
  });
});

/**
 * WebGPU domain benchmark — offline-pure static shader analysis only.
 *
 * These two tools are the WebGPU handlers that never touch a live GPU or a
 * browser page: `webgpu_shader_disassemble` parses WGSL into a lightweight AST
 * (or reflects a SPIR-V binary) and `webgpu_shader_compile` with format:'spirv'
 * performs pure static SPIR-V reflection. The other 8 WebGPU tools are bound to
 * a pageController / GPU device and cannot be measured offline, so they are
 * omitted (no skip/placeholder cases).
 *
 * Ground truth:
 *  - SPIR-V 1.0 binary layout (Khronos SPIR-V spec §2.3 "Physical Layout of a
 *    SPIR-V Module" and §2.4 "Instructions"): a module is a 5-word header
 *    (magic 0x07230203, version, generator, bound, schema) followed by
 *    instructions whose first word is (wordCount << 16) | opcode. The fixture
 *    below is hand-assembled from that layout with a known entry point, one
 *    @group/@binding uniform, one struct, and one interface location.
 *  - WGSL grammar: `@vertex fn`, `struct`, and `@location` constructs that the
 *    project's WgslParser extracts deterministically without a GPU.
 */
import { WebGPUHandlers } from '@server/domains/webgpu/handlers';
import { expectSuccess, type BenchSuite } from '../harness';

// Stub deps: the offline SPIR-V/WGSL paths never dereference the page
// controller, so no browser or GPU device is required.
const handlers = new WebGPUHandlers(
  { eventBus: { emit: () => {} } } as never,
  { pageController: { getActivePage: async () => null } } as never,
);

// ── SPIR-V fixture assembly (pure, deterministic) ────────────────────────────

const SPIRV_MAGIC = 0x07230203;
const OP_ENTRY_POINT = 15;
const OP_NAME = 19;
const OP_MEMBER_NAME = 20;
const OP_TYPE_VOID = 17;
const OP_TYPE_FLOAT = 22;
const OP_TYPE_VECTOR = 23;
const OP_TYPE_STRUCT = 30;
const OP_TYPE_POINTER = 32;
const OP_VARIABLE = 59;
const OP_DECORATE = 71;
const OP_MEMBER_DECORATE = 72;
const OP_FUNCTION = 54;
const OP_FUNCTION_END = 56;

const EM_VERTEX = 0;
const STORAGE_UNIFORM = 2;
const STORAGE_OUTPUT = 3;
const DECORATION_LOCATION = 28;
const DECORATION_BINDING = 31;
const DECORATION_DESCRIPTOR_SET = 32;
const DECORATION_BLOCK = 1;

/** Encode a UTF-8 string literal as null-terminated, word-padded 32-bit words. */
function encodeString(s: string): number[] {
  const bytes = [...new TextEncoder().encode(s), 0];
  while (bytes.length % 4 !== 0) bytes.push(0);
  const words: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    words.push(
      (bytes[i] ?? 0) |
        ((bytes[i + 1] ?? 0) << 8) |
        ((bytes[i + 2] ?? 0) << 16) |
        ((bytes[i + 3] ?? 0) << 24),
    );
  }
  return words;
}

/** SPIR-V instruction: first word encodes (wordCount << 16) | opcode. */
function inst(opcode: number, operands: number[]): number[] {
  return [((1 + operands.length) << 16) | opcode, ...operands];
}

/** Words → little-endian hex string (the handler's accepted hex input form). */
function wordsToHex(words: number[]): string {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((w, i) => view.setUint32(i * 4, w >>> 0, true));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * A minimal but structurally complete SPIR-V 1.0 module reflected as:
 *   - entry point: vertex "vs_main"
 *   - uniform buffer "Globals" @group(0) @binding(2) of struct "Params"
 *     with field "tint" : f32
 *   - interface output "out_pos" @location(3)
 * Known ground truth derived from the opcodes/operands below.
 */
function spirvFixtureHex(): string {
  const header = [SPIRV_MAGIC, 0x00010000, 0, 8, 0];
  const bodyWords = [
    // %1 = OpTypeVoid, %2 = OpTypeFloat 32, %3 = OpTypeVector %2 4
    inst(OP_TYPE_VOID, [1]),
    inst(OP_TYPE_FLOAT, [2, 32]),
    inst(OP_TYPE_VECTOR, [3, 2, 4]),
    // %4 = OpTypeStruct %2 ; %5 = OpTypePointer Uniform %4
    inst(OP_TYPE_STRUCT, [4, 2]),
    inst(OP_TYPE_POINTER, [5, STORAGE_UNIFORM, 4]),
    // %6 = OpTypePointer Output %3
    inst(OP_TYPE_POINTER, [6, STORAGE_OUTPUT, 3]),
    // %7 = OpVariable %5 Uniform  → uniform buffer (binding below)
    inst(OP_VARIABLE, [5, 7, STORAGE_UNIFORM]),
    // %8 = OpVariable %6 Output   → interface location (decorated below)
    inst(OP_VARIABLE, [6, 8, STORAGE_OUTPUT]),
    // Names
    inst(OP_NAME, [9, ...encodeString('vs_main')]),
    inst(OP_NAME, [4, ...encodeString('Params')]),
    inst(OP_NAME, [7, ...encodeString('Globals')]),
    inst(OP_NAME, [8, ...encodeString('out_pos')]),
    inst(OP_MEMBER_NAME, [4, 0, ...encodeString('tint')]),
    // Decorations: Params is a Block; Globals is @group(0) @binding(2)
    inst(OP_DECORATE, [4, DECORATION_BLOCK]),
    inst(OP_DECORATE, [7, DECORATION_DESCRIPTOR_SET, 0]),
    inst(OP_DECORATE, [7, DECORATION_BINDING, 2]),
    // out_pos is @location(3)
    inst(OP_DECORATE, [8, DECORATION_LOCATION, 3]),
    // struct member 0 offset decoration (ignored by reflection but valid SPIR-V)
    inst(OP_MEMBER_DECORATE, [4, 0, 0, 0]),
    // entry point: Vertex, function id %9, name "vs_main", interface %8
    inst(OP_ENTRY_POINT, [EM_VERTEX, 9, ...encodeString('vs_main'), 8]),
    // a trivial function body so the module has executable instructions
    inst(OP_FUNCTION, [1, 9, 0, 1]),
    inst(OP_FUNCTION_END, []),
  ];
  return wordsToHex([...header, ...bodyWords.flat()]);
}

const SPIRV_HEX = spirvFixtureHex();

// WGSL source with a deterministic structure the lightweight parser extracts:
//   one @vertex entry point "vs_main", one struct "VertexOutput" with two
//   fields, one @location(0) parameter, and textureSample calls for cost stats.
const WGSL_SHADER = `
struct VertexOutput {
  @builtin(position) position : vec4<f32>,
  @location(0) color : vec4<f32>,
};

@group(0) @binding(0) var<uniform> params : vec4<f32>;

@vertex
fn vs_main(@location(0) pos : vec3<f32>) -> VertexOutput {
  var out : VertexOutput;
  out.position = vec4<f32>(pos, 1.0);
  out.color = params;
  return out;
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  let a = textureSample(tex, samp, vec2<f32>(0.0));
  let b = textureSampleLevel(tex, samp, vec2<f32>(0.0), 0.0);
  return a + b;
}
`;

function asArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
}

/** Read a field from either a direct result or an offloaded DDM summary. */
function from(v: Record<string, unknown>, key: string): unknown {
  const summary = v.summary as Record<string, unknown> | undefined;
  return v[key] ?? summary?.[key];
}

export const webgpuSuite: BenchSuite = {
  name: 'webgpu',
  domain: 'webgpu',
  description:
    'Offline-pure WebGPU static shader analysis: WGSL AST/disassembly + SPIR-V binary reflection (no GPU, no browser)',
  cases: [
    {
      name: 'webgpu_shader_disassemble/wgsl-ast-structural',
      tool: 'webgpu_shader_disassemble',
      origin: 'homemade',
      reference:
        'WGSL grammar fixture: AST must report type "Module", functions [vs_main, fs_main], struct "VertexOutput" with 2 fields, uniform "params" @group(0)@binding(0), and @location(0) attribute',
      run: () => handlers.webgpu_shader_disassemble({ shaderCode: WGSL_SHADER, format: 'wgsl' }),
      validate: (v) => {
        const b = expectSuccess(v);
        const ast = from(b, 'ast') as Record<string, unknown> | undefined;
        if (!ast || typeof ast !== 'object') return `no ast: ${JSON.stringify(b).slice(0, 220)}`;
        if (ast.type !== 'Module') return `ast.type = ${String(ast.type)}`;
        const functions = asArray(ast.functions).map(String);
        if (!functions.includes('vs_main') || !functions.includes('fs_main')) {
          return `functions missing entry points: ${JSON.stringify(functions)}`;
        }
        const structs = asArray(ast.structs);
        const vo = structs.find((s) => s.name === 'VertexOutput');
        if (!vo) return `struct VertexOutput missing: ${JSON.stringify(structs)}`;
        if (asArray(vo.fields).length !== 2) return `VertexOutput fields != 2`;
        const uniforms = asArray(ast.uniforms);
        const params = uniforms.find((u) => u.name === 'params');
        if (!params || params.binding !== 0 || params.group !== 0) {
          return `uniform params binding/group wrong: ${JSON.stringify(uniforms)}`;
        }
        const attrs = asArray(ast.attributes);
        if (!attrs.some((a) => a.location === 0)) {
          return `@location(0) attribute missing: ${JSON.stringify(attrs)}`;
        }
        const cost = from(b, 'costEstimate') as Record<string, unknown> | undefined;
        if (!cost || cost.basis !== 'wgsl-estimate') return `costEstimate.basis != wgsl-estimate`;
        if (cost.textureSamples !== 2) return `textureSamples ${String(cost.textureSamples)} != 2`;
        return true;
      },
    },
    {
      name: 'webgpu_shader_disassemble/spirv-reflection-disassembly',
      tool: 'webgpu_shader_disassemble',
      origin: 'external-vector',
      reference:
        'Khronos SPIR-V spec §2.3/§2.4: hand-assembled module (OpEntryPoint vertex "vs_main", OpVariable uniform @group(0)@binding(2), OpTypeStruct "Params" with f32 field "tint", output @location(3)) must be reflected into AST + text disassembly',
      run: () => handlers.webgpu_shader_disassemble({ shaderCode: SPIRV_HEX, format: 'spirv' }),
      validate: (v) => {
        const b = expectSuccess(v);
        const ast = from(b, 'ast') as Record<string, unknown> | undefined;
        if (!ast || ast.type !== 'Module')
          return `no spirv ast: ${JSON.stringify(b).slice(0, 220)}`;
        if (!asArray(ast.functions).map(String).includes('vs_main'))
          return `entry point vs_main missing`;
        const uniforms = asArray(ast.uniforms);
        const globals = uniforms.find((u) => u.name === 'Globals');
        if (!globals || globals.group !== 0 || globals.binding !== 2) {
          return `Globals @group(0)@binding(2) wrong: ${JSON.stringify(uniforms)}`;
        }
        const structs = asArray(ast.structs);
        const params = structs.find((s) => s.name === 'Params');
        if (!params) return `struct Params missing: ${JSON.stringify(structs)}`;
        const tint = asArray(params.fields).find((f) => f.name === 'tint');
        if (!tint || tint.type !== 'f32') {
          return `Params.tint : f32 wrong: ${JSON.stringify(params.fields)}`;
        }
        if (!asArray(ast.attributes).some((a) => a.name === 'out_pos' && a.location === 3)) {
          return `@location(3) out_pos attribute missing`;
        }
        const text = String(from(b, 'disassembly') ?? '');
        if (!text.includes('vertex: vs_main') || !text.includes('@group(0) @binding(2)')) {
          return `disassembly missing reflected lines: ${text.slice(0, 220)}`;
        }
        const cost = from(b, 'costEstimate') as Record<string, unknown> | undefined;
        if (!cost || cost.basis !== 'spirv-opcode') return `costEstimate.basis != spirv-opcode`;
        const hist = cost.byOpcode as Record<string, number> | undefined;
        if (!hist || hist.OpEntryPoint !== 1 || hist.OpVariable !== 2) {
          return `opcode histogram wrong: ${JSON.stringify(hist)}`;
        }
        return true;
      },
    },
    {
      name: 'webgpu_shader_compile/spirv-static-reflection',
      tool: 'webgpu_shader_compile',
      origin: 'external-vector',
      reference:
        'SPIR-V spec reflection (browsers cannot compile SPIR-V): same hand-assembled module must yield reflected=true, compiled=false, entry point vertex "vs_main", uniform Globals @group(0)@binding(2), struct Params.tint:f32, and a spirv-opcode cost histogram',
      run: () => handlers.webgpu_shader_compile({ shaderCode: SPIRV_HEX, format: 'spirv' }),
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.reflected !== true || b.compiled !== false) {
          return `reflected/compiled flags wrong: reflected=${String(b.reflected)} compiled=${String(b.compiled)}`;
        }
        const metadata = b.metadata as Record<string, unknown> | undefined;
        if (!metadata || metadata.format !== 'spirv') {
          return `metadata.format != spirv: ${JSON.stringify(metadata).slice(0, 200)}`;
        }
        const eps = asArray(metadata.entryPoints);
        if (!eps.some((e) => e.name === 'vs_main' && e.stage === 'vertex')) {
          return `vertex entry point vs_main missing: ${JSON.stringify(eps)}`;
        }
        const uniforms = asArray(metadata.uniforms);
        if (!uniforms.some((u) => u.name === 'Globals' && u.group === 0 && u.binding === 2)) {
          return `Globals binding wrong: ${JSON.stringify(uniforms)}`;
        }
        const structs = asArray(metadata.structs);
        const params = structs.find((s) => s.name === 'Params');
        if (!params || !asArray(params.fields).some((f) => f.name === 'tint' && f.type === 'f32')) {
          return `Params.tint:f32 missing: ${JSON.stringify(structs)}`;
        }
        if (!asArray(metadata.attributes).some((a) => a.name === 'out_pos' && a.location === 3)) {
          return `out_pos @location(3) missing`;
        }
        const cost = b.costEstimate as Record<string, unknown> | undefined;
        if (!cost || cost.basis !== 'spirv-opcode') return `costEstimate.basis != spirv-opcode`;
        const hist = cost.byOpcode as Record<string, number> | undefined;
        if (!hist || hist.OpEntryPoint !== 1) return `OpEntryPoint histogram wrong`;
        const info = b.spirvInfo as Record<string, unknown> | undefined;
        if (!info || info.versionMajor !== 1 || info.bound !== 8) {
          return `spirvInfo version/bound wrong: ${JSON.stringify(info)}`;
        }
        return true;
      },
    },
    {
      name: 'webgpu_shader_compile/spirv-header-only-minimal',
      tool: 'webgpu_shader_compile',
      origin: 'homemade',
      reference:
        'SPIR-V §2.3 header (5 words, bound=3, generator=7): reflection of a bare valid header must succeed with zero entry points/bindings/structs and an empty instruction histogram — proves the static path parses structure, not just named fixtures',
      run: () => {
        const headerHex = wordsToHex([SPIRV_MAGIC, 0x00010300, 7, 3, 0]);
        return handlers.webgpu_shader_compile({ shaderCode: headerHex, format: 'spirv' });
      },
      validate: (v) => {
        const b = expectSuccess(v);
        if (b.reflected !== true || b.compiled !== false) return `reflection flags wrong`;
        const metadata = b.metadata as Record<string, unknown> | undefined;
        if (!metadata) return `metadata missing`;
        if (asArray(metadata.entryPoints).length !== 0 || asArray(metadata.uniforms).length !== 0) {
          return `header-only module should reflect no entry points or bindings`;
        }
        const cost = b.costEstimate as Record<string, unknown> | undefined;
        if (!cost || cost.totalInstructions !== 0) {
          return `header-only instruction count != 0: ${JSON.stringify(cost)}`;
        }
        const info = b.spirvInfo as Record<string, unknown> | undefined;
        if (
          !info ||
          info.versionMajor !== 1 ||
          info.versionMinor !== 3 ||
          info.generator !== 7 ||
          info.bound !== 3
        ) {
          return `spirvInfo fields wrong: ${JSON.stringify(info)}`;
        }
        return true;
      },
    },
  ],
};

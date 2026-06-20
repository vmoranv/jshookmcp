/**
 * WgslParser — Enhanced lightweight WGSL metadata extractor.
 *
 * **Motivation**: The original parser used flat `[^}]*` regexes for struct
 * bodies, which silently truncated at the first `}` and could not handle
 * nested types (WGSL permits up to 15 levels of composite nesting per the
 * spec §2.4). This module replaces those regexes with a brace-matching
 * scanner that correctly handles nested `{ }`, plus broader coverage of
 * bindings, attributes, and aliases.
 *
 * **Design**:
 *  - Brace-matching struct parser (depth counter) instead of `[^}]*`.
 *  - Fail-soft: when a construct cannot be fully parsed, a `parseWarning` is
 *    recorded rather than silently dropping data. Consumers surface warnings.
 *  - Zero external dependencies (no `@webgpu/wgsl-parser`), keeping the
 *    bundle small. Trade-off: still not a full grammar parser; exotic edge
 *    cases produce warnings instead of structured AST nodes.
 *  - Shared between `shader_compile` and `shader_disassemble` so both report
 *    identical metadata for the same shader.
 *
 * **Spec reference**: https://www.w3.org/TR/WGSL/ — "Maximum nesting depth of
 * a composite type: 15"; the grammar is LALR(1). This scanner is intentionally
 * narrower but correct for the constructs it targets.
 */

import type { ShaderMetadata } from '@server/domains/webgpu/types';

/** Maximum struct nesting depth before we warn (spec allows 15). */
const MAX_STRUCT_DEPTH = 15;

/**
 * Extract structured metadata from WGSL source.
 *
 * Parses entry points, structs (with nested-brace support), uniform/binding
 * declarations, and vertex attributes (both in function params and struct
 * fields). Non-fatal issues are reported via `parseWarnings`.
 *
 * @param code - WGSL source code
 * @returns Shader metadata with optional `parseWarnings`
 */
export function extractShaderMetadata(code: string): ShaderMetadata {
  const entryPoints: ShaderMetadata['entryPoints'] = [];
  const uniforms: NonNullable<ShaderMetadata['uniforms']> = [];
  const attributes: NonNullable<ShaderMetadata['attributes']> = [];
  const structs: NonNullable<ShaderMetadata['structs']> = [];
  const bindingsByType: NonNullable<ShaderMetadata['bindingsByType']> = {};
  const parseWarnings: string[] = [];
  // Shared dedup set so struct-field and function-param attributes don't double-count.
  const seenAttrs = new Set<string>();

  // Entry points: @vertex/@fragment/@compute followed by `fn name`.
  // Use global regex to capture multiple entry points of the same stage.
  const vertexMatches = code.matchAll(/@vertex\s+fn\s+(\w+)/g);
  for (const m of vertexMatches) {
    const name = m[1];
    if (name) entryPoints.push({ name, stage: 'vertex' });
  }
  const fragmentMatches = code.matchAll(/@fragment\s+fn\s+(\w+)/g);
  for (const m of fragmentMatches) {
    const name = m[1];
    if (name) entryPoints.push({ name, stage: 'fragment' });
  }
  const computeMatches = code.matchAll(/@compute\s+(?:@workgroup_size\s*\([^)]*\)\s*)?fn\s+(\w+)/g);
  for (const m of computeMatches) {
    const name = m[1];
    if (name) entryPoints.push({ name, stage: 'compute' });
  }

  // Structs: brace-matching scanner. Handles nested `{ }` (e.g. a struct
  // field whose type annotation contains `{...}` is rare in WGSL, but the
  // scanner is robust against it and against nested struct definitions in
  // comments). Falls back to a warning if depth exceeds the spec limit.
  for (const structMatch of code.matchAll(/struct\s+(\w+)\s*\{/g)) {
    const name = structMatch[1];
    const bodyStart =
      structMatch.index !== undefined ? structMatch.index + structMatch[0].length : -1;
    if (!name || bodyStart < 0) continue;

    const bodyResult = extractBraceBody(code, bodyStart);
    if (bodyResult.depthExceeded) {
      parseWarnings.push(
        `struct "${name}" nesting exceeded ${MAX_STRUCT_DEPTH} levels; fields may be incomplete`,
      );
    }
    const fields = parseStructFields(bodyResult.body, name, attributes, parseWarnings, seenAttrs);
    structs.push({ name, fields });
  }

  // Uniforms / bindings: `@group(g) @binding(b) [var<...>] name : type`
  // Allow attributes and `var<address_space>` to appear in any order/optionality.
  // Type capture is broadened to include `[]`, `<>`, `()`, and whitespace.
  const bindingRegex =
    /@group\s*\(\s*(\d+)\s*\)\s*@binding\s*\(\s*(\d+)\s*\)[\s\S]*?\bvar(?:<[^>]*>)?\s+(\w+)\s*:\s*([^\n;]+)/g;
  for (const match of code.matchAll(bindingRegex)) {
    const groupStr = match[1];
    const bindingStr = match[2];
    const name = match[3];
    const type = match[4];
    if (
      groupStr === undefined ||
      bindingStr === undefined ||
      name === undefined ||
      type === undefined
    ) {
      continue;
    }
    const group = Number(groupStr);
    const binding = Number(bindingStr);
    const trimmedType = type.trim();

    uniforms.push({ name, binding, group });

    const baseType = trimmedType.split('<')[0]?.split('(')[0]?.trim() ?? 'unknown';
    bindingsByType[baseType] = (bindingsByType[baseType] ?? 0) + 1;
  }

  // Vertex attributes in function params: `@location(l) name : type`.
  // Struct-field locations were captured above; dedupe by (location,name).
  const attributeRegex = /@location\s*\(\s*(\d+)\s*\)\s*(\w+)\s*:/g;
  for (const match of code.matchAll(attributeRegex)) {
    const locationStr = match[1];
    const name = match[2];
    if (locationStr === undefined || name === undefined) continue;
    const location = Number(locationStr);
    const key = `${location}:${name}`;
    if (seenAttrs.has(key)) continue;
    seenAttrs.add(key);
    attributes.push({ location, name });
  }

  return {
    entryPoints,
    uniforms,
    attributes,
    structs,
    bindingsByType,
    parseWarnings,
    format: 'wgsl',
  };
}

/**
 * Extract the contents of a `{ ... }` block starting just after an opening
 * brace at `startIdx`. Uses a depth counter to handle nesting.
 *
 * @returns The body text and whether the nesting depth was exceeded.
 */
function extractBraceBody(
  code: string,
  startIdx: number,
): { body: string; depthExceeded: boolean } {
  let depth = 1;
  let depthExceeded = false;
  let i = startIdx;
  let inString: '"' | "'" | null = null;

  while (i < code.length && depth > 0) {
    const ch = code[i];

    // Skip string literals so braces inside strings don't affect depth.
    if (inString !== null) {
      if (ch === '\\') {
        i += 2; // skip escaped char
        continue;
      }
      if (ch === inString) {
        inString = null;
      }
      i++;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      i++;
      continue;
    }

    // Skip line comments.
    if (ch === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    // Skip block comments.
    if (ch === '/' && code[i + 1] === '*') {
      i += 2;
      while (i < code.length && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    if (ch === '{') {
      depth++;
      if (depth > MAX_STRUCT_DEPTH) {
        depthExceeded = true;
      }
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return { body: code.slice(startIdx, i), depthExceeded };
      }
    }
    i++;
  }

  // Unterminated brace — return what we have.
  return { body: code.slice(startIdx, i), depthExceeded: depthExceeded || depth > 0 };
}

/**
 * Parse struct fields from a body string. Also collects `@location(n)` member
 * decorations into the `attributes` array (so struct-field vertex attributes
 * are captured, not just function-param attributes). `seenAttrs` is shared
 * with the caller so struct-field and function-param locations dedupe.
 */
function parseStructFields(
  body: string,
  structName: string,
  attributes: NonNullable<ShaderMetadata['attributes']>,
  parseWarnings: string[],
  seenAttrs: Set<string>,
): Array<{ name: string; type: string }> {
  const fields: Array<{ name: string; type: string }> = [];

  // Fields are separated by commas or semicolons (WGSL allows both). Split
  // top-level separators (not inside `<...>` or `()`).
  const fieldChunks = splitTopLevelSeparators(body);

  for (const chunk of fieldChunks) {
    // Strip comments and leading whitespace before matching.
    const cleaned = stripComments(chunk).trim();
    if (cleaned === '') continue;

    // Field: [@(decorations)] name : type
    // Strip leading decorations to find `name : type`.
    const fieldMatch = cleaned.match(/^(?:@\w+(?:\([^)]*\))?\s)*(\w+)\s*:\s*(.+)$/);
    if (!fieldMatch) {
      parseWarnings.push(
        `struct "${structName}": could not parse field "${cleaned.substring(0, 40)}"`,
      );
      continue;
    }
    const fieldName = fieldMatch[1];
    const fieldType = fieldMatch[2]?.trim();
    if (!fieldName || !fieldType) continue;
    fields.push({ name: fieldName, type: fieldType });

    // Capture @location on struct fields (deduped via seenAttrs).
    const locMatch = cleaned.match(/@location\s*\(\s*(\d+)\s*\)/);
    if (locMatch?.[1]) {
      const location = Number(locMatch[1]);
      const key = `${location}:${fieldName}`;
      if (!seenAttrs.has(key)) {
        seenAttrs.add(key);
        attributes.push({ location, name: fieldName });
      }
    }
  }

  return fields;
}

/**
 * Strip line comments (`//`) and block comments from a code fragment.
 */
function stripComments(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (s[i] === '/' && s[i + 1] === '*') {
      i += 2;
      while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += s[i];
    i++;
  }
  return out;
}

/**
 * Split a string on commas or semicolons that are not nested inside `<>`,
 * `()`, `[]`, or `{}`. Struct fields may be comma- or semicolon-separated;
 * types may contain commas inside angle brackets (e.g. `array<vec4<f32>, 16>`).
 */
function splitTopLevelSeparators(s: string): string[] {
  const chunks: string[] = [];
  let depth = 0;
  let current = '';
  let inString: '"' | "'" | null = null;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];

    if (inString !== null) {
      current += ch;
      if (ch === '\\') {
        current += s[i + 1] ?? '';
        i++;
        continue;
      }
      if (ch === inString) inString = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = ch;
      current += ch;
      continue;
    }

    if (ch === '<' || ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === '>' || ch === ')' || ch === ']' || ch === '}') depth = Math.max(0, depth - 1);

    if ((ch === ',' || ch === ';') && depth === 0) {
      chunks.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim() !== '') chunks.push(current);
  return chunks;
}

/**
 * Extract a lightweight AST from WGSL source (for disassembly output).
 *
 * Reuses `extractShaderMetadata` for consistency, then projects into the
 * disassembly-oriented shape. Functions are captured separately via a simple
 * `fn name` regex.
 */
export interface ShaderAst {
  type: 'Module';
  functions: string[];
  structs: ShaderMetadata['structs'];
  uniforms: ShaderMetadata['uniforms'];
  attributes: ShaderMetadata['attributes'];
  parseWarnings?: string[];
}

export function extractShaderAst(code: string): ShaderAst {
  const metadata = extractShaderMetadata(code);

  const functions: string[] = [];
  for (const match of code.matchAll(/\bfn\s+(\w+)/g)) {
    const name = match[1];
    if (name) functions.push(name);
  }

  return {
    type: 'Module',
    functions,
    structs: metadata.structs,
    uniforms: metadata.uniforms,
    attributes: metadata.attributes,
    parseWarnings: metadata.parseWarnings,
  };
}

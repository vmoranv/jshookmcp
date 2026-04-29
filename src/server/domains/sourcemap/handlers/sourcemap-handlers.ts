/**
 * Main sourcemap sub-handler — discover, fetch/parse, reconstruct tree.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveArtifactPath } from '@utils/artifacts';
import { SOURCEMAP_V4_RAW_FIELD_MAX_LEN, SOURCEMAP_V4_RETRY_DELAY_MS } from '@src/constants';
import type {
  CdpSessionLike,
  DiscoverItem,
  JsonRecord,
  MutableDiscoverItem,
  TextToolResponse,
  SourcemapSharedState,
} from './shared';
import {
  asRecord,
  asString,
  parseBooleanArg,
  requiredStringArg,
  optionalStringArg,
  safeDetach,
  trySend,
  delay,
  json,
  fail,
  decodeVlqSegment,
  decodeVlqSegmentUnsigned,
} from './shared';
import {
  parseSourceMap,
  parseSourceMapStats,
  resolveSourceMapUrl,
  extractSourceMappingUrlFromScript,
  combineSourceRoot,
  normalizeSourcePath,
  safeTarget,
  fetchSourceMapText,
} from './sourcemap-parsing';

function countScopeNodes(nodes: Array<OriginalScopeNode | null>): number {
  let count = 0;
  for (const node of nodes) {
    if (!node) continue;
    count += 1 + countScopeNodes(node.children);
  }
  return count;
}

export class SourcemapHandlers {
  private state: SourcemapSharedState;

  constructor(state: SourcemapSharedState) {
    this.state = state;
  }

  async handleSourcemapDiscover(args: Record<string, unknown>): Promise<TextToolResponse> {
    const includeInline = parseBooleanArg(args.includeInline, true);
    const page = await this.state.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    const scripts = new Map<string, MutableDiscoverItem>();

    const onScriptParsed = (payload: unknown): void => {
      const record = asRecord(payload);
      const scriptId = asString(record.scriptId);
      if (!scriptId) return;
      const scriptUrl = asString(record.url) ?? '';
      const sourceMapUrlRaw = asString(record.sourceMapURL) ?? '';
      const existing = scripts.get(scriptId);
      const sourceMapUrlResolved = sourceMapUrlRaw
        ? resolveSourceMapUrl(sourceMapUrlRaw, scriptUrl)
        : (existing?.sourceMapUrl ?? '');
      scripts.set(scriptId, {
        scriptId,
        scriptUrl: scriptUrl || existing?.scriptUrl || '',
        sourceMapUrl: sourceMapUrlResolved,
        isInline: sourceMapUrlResolved.startsWith('data:'),
      });
    };

    try {
      session.on?.('Debugger.scriptParsed', onScriptParsed);
      await session.send('Debugger.enable');
      await delay(SOURCEMAP_V4_RETRY_DELAY_MS);

      for (const item of scripts.values()) {
        if (item.sourceMapUrl) continue;
        if (!item.scriptId || !item.scriptUrl) continue;
        try {
          const sourceResponse = asRecord(
            await session.send('Debugger.getScriptSource', { scriptId: item.scriptId }),
          );
          const scriptSource = asString(sourceResponse.scriptSource);
          if (!scriptSource) continue;
          const extracted = extractSourceMappingUrlFromScript(scriptSource);
          if (!extracted) continue;
          const resolvedSourceMap = resolveSourceMapUrl(extracted, item.scriptUrl);
          item.sourceMapUrl = resolvedSourceMap;
          item.isInline = resolvedSourceMap.startsWith('data:');
        } catch {
          continue;
        }
      }

      const result: DiscoverItem[] = Array.from(scripts.values())
        .filter((item) => item.sourceMapUrl.length > 0)
        .filter((item) => includeInline || !item.isInline)
        .toSorted((left, right) => {
          const leftKey = `${left.scriptUrl}|${left.scriptId}`;
          const rightKey = `${right.scriptUrl}|${right.scriptId}`;
          return leftKey.localeCompare(rightKey);
        })
        .map((item) => ({
          scriptUrl: item.scriptUrl,
          sourceMapUrl: item.sourceMapUrl,
          isInline: item.isInline,
          scriptId: item.scriptId,
        }));

      return json(result);
    } catch (error) {
      return fail('sourcemap_discover', error);
    } finally {
      session.off?.('Debugger.scriptParsed', onScriptParsed);
      await trySend(session, 'Debugger.disable');
      await safeDetach(session);
    }
  }

  async handleSourcemapFetchAndParse(args: Record<string, unknown>): Promise<TextToolResponse> {
    try {
      const sourceMapUrl = requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
      const scriptUrl = optionalStringArg(args.scriptUrl);
      const parsed = await parseSourceMap(sourceMapUrl, scriptUrl, this.state.collector);

      const responsePayload: JsonRecord = {
        sources: parsed.map.sources,
        mappingsCount: parsed.mappingsCount,
        segmentCount: parsed.segmentCount,
      };
      if (Array.isArray(parsed.map.sourcesContent)) {
        responsePayload.sourcesContent = parsed.map.sourcesContent as Array<string | null>;
      }
      return json(responsePayload);
    } catch (error) {
      return fail('sourcemap_fetch_and_parse', error);
    }
  }

  async handleSourcemapReconstructTree(args: Record<string, unknown>): Promise<TextToolResponse> {
    try {
      const sourceMapUrl = requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
      const outputDir = optionalStringArg(args.outputDir);
      const parsed = await parseSourceMapStats(sourceMapUrl, undefined, this.state.collector);

      const artifactTarget = safeTarget(parsed.resolvedUrl);
      const artifactPath = await resolveArtifactPath({
        category: 'reports',
        toolName: 'sourcemap-tree',
        target: artifactTarget,
        ext: 'tmp',
        ...(outputDir ? { customDir: outputDir } : {}),
      });

      const outputRoot = artifactPath.absolutePath.replace(/\.tmp$/i, '');
      const outputRootDisplay = artifactPath.displayPath.replace(/\.tmp$/i, '');
      await mkdir(outputRoot, { recursive: true });

      const writtenFiles: string[] = [];
      let skippedFiles = 0;

      for (let index = 0; index < parsed.map.sources.length; index += 1) {
        const rawSourcePath = parsed.map.sources[index] ?? '';
        const sourcePath = combineSourceRoot(parsed.map.sourceRoot, rawSourcePath);
        const relativePath = normalizeSourcePath(sourcePath, index);
        const absolutePath = resolve(outputRoot, relativePath);

        const sourceContent =
          parsed.map.sourcesContent && index < parsed.map.sourcesContent.length
            ? parsed.map.sourcesContent[index]
            : null;

        const fileContent =
          typeof sourceContent === 'string'
            ? sourceContent
            : `/* source content missing in source map: ${sourcePath} */\n`;

        try {
          await mkdir(dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, fileContent, 'utf-8');
          writtenFiles.push(relativePath);
        } catch {
          skippedFiles += 1;
        }
      }

      return json({
        outputDir: outputRootDisplay,
        totalSources: parsed.map.sources.length,
        writtenFiles: writtenFiles.length,
        skippedFiles,
        files: writtenFiles,
      });
    } catch (error) {
      return fail('sourcemap_reconstruct_tree', error);
    }
  }

  async handleSourcemapParseV4(args: Record<string, unknown>) {
    const sourceMapUrl = requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
    const extractScopes = parseBooleanArg(args.extractScopes, true);
    const extractDebugIds = parseBooleanArg(args.extractDebugIds, true);

    try {
      const raw = await fetchSourceMapText(sourceMapUrl, this.state.collector);
      const parsed = JSON.parse(raw);

      const names: string[] = Array.isArray(parsed.names)
        ? parsed.names.filter((x: unknown): x is string => typeof x === 'string')
        : [];
      const sources: string[] = Array.isArray(parsed.sources)
        ? parsed.sources.filter((x: unknown): x is string => typeof x === 'string')
        : [];

      const v3Baseline: Record<string, unknown> = {
        version: parsed.version,
        sources: sources.length,
        names: names.length,
        mappings: typeof parsed.mappings === 'string' ? parsed.mappings.length : 0,
        hasFile: typeof parsed.file === 'string',
        hasSourceRoot: typeof parsed.sourceRoot === 'string',
      };

      const result: Record<string, unknown> = {
        success: true,
        sourceMapUrl,
        version: parsed.version,
        v3Baseline,
      };

      // Debug ID validation (UUID canonical format)
      if (extractDebugIds && typeof parsed.debugId === 'string') {
        const debugIdValid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            parsed.debugId,
          );
        result.debugId = parsed.debugId;
        result.debugIdValid = debugIdValid;
      }

      // ECMA-426 scopes decoding: standard 'scopes' field or 'x_scopes' fallback
      const scopesField =
        typeof parsed.scopes === 'string'
          ? parsed.scopes
          : typeof parsed.x_scopes === 'string'
            ? parsed.x_scopes
            : undefined;

      if (extractScopes && scopesField) {
        try {
          const decoded = decodeScopesField(scopesField, names, sources);
          result.isV4 = true;
          result.scopes = decoded;
          result.scopeCount = countScopeNodes(decoded.originalScopes);
          result.generatedRangeCount = decoded.generatedRanges.length;
        } catch (scopeError) {
          result.success = false;
          result.scopeDecodeError =
            scopeError instanceof Error ? scopeError.message : String(scopeError);
          result.rawScopesField =
            scopesField.substring(0, SOURCEMAP_V4_RAW_FIELD_MAX_LEN) +
            (scopesField.length > SOURCEMAP_V4_RAW_FIELD_MAX_LEN ? '...' : '');
          result.isV4 = true;
        }
      }

      // Vendor extensions
      const extensions: Record<string, unknown> = {};
      if (parsed.x_scopeLines) extensions.x_scopeLines = parsed.x_scopeLines;
      if (parsed.x_namesIdx) extensions.x_namesIdx = parsed.x_namesIdx;
      if (parsed.x_computedBases) extensions.x_computedBases = parsed.x_computedBases;
      if (Object.keys(extensions).length > 0) {
        result.extensions = extensions;
      }

      if (!scopesField && !parsed.debugId && Object.keys(extensions).length === 0) {
        result.isV4 = false;
        result.note = 'No v4 fields (scopes/debugId) found. This source map is v3 only.';
      }

      if (args.compareV3 === true) {
        result.comparison = {
          v3Only: ['version', 'sources', 'names', 'mappings', 'file', 'sourceRoot'],
          v4Only: Object.keys(result).filter(
            (k) => !['success', 'sourceMapUrl', 'version', 'v3Baseline', 'comparison'].includes(k),
          ),
        };
      }

      return json(result);
    } catch (error) {
      return fail('sourcemap_parse_v4', error);
    }
  }
}

// ── ECMA-426 Scope Tree Decoding ──

interface OriginalScopeNode {
  index: number;
  sourceIndex: number;
  start: { line: number; column: number };
  end: { line: number; column: number };
  name?: string;
  kind?: string;
  isStackFrame: boolean;
  variables: string[];
  children: OriginalScopeNode[];
}

interface BindingRangeNode {
  from: { line: number; column: number };
  expression?: string;
}

interface GeneratedRangeNode {
  start: { line: number; column: number };
  end: { line: number; column: number };
  isStackFrame: boolean;
  isHidden: boolean;
  definitionIndex?: number;
  callsite?: { sourceIndex: number; line: number; column: number };
  bindings?: Array<string | undefined | BindingRangeNode[]>;
  children: GeneratedRangeNode[];
}

function decodeScopesField(scopesText: string, names: string[], sources: string[]) {
  const items = scopesText.split(',');
  const idx = { value: 0 };
  const originalByStartIndex: OriginalScopeNode[] = [];
  let previousOriginalName = 0;
  let previousOriginalKind = 0;
  let previousOriginalVariable = 0;
  let previousGeneratedLine = 0;
  let previousGeneratedColumn = 0;
  let previousDefinition = 0;

  const readName = (absoluteIndex1Based: number) =>
    absoluteIndex1Based > 0 && absoluteIndex1Based <= names.length
      ? names[absoluteIndex1Based - 1]
      : undefined;

  function safeItem(index: number): string | undefined {
    return index >= 0 && index < items.length ? items[index] : undefined;
  }

  function parseOriginalTree(
    sourceIndex: number,
    previousPos: { line: number; column: number },
  ): OriginalScopeNode {
    const startItem = safeItem(idx.value++);
    if (!startItem?.startsWith('B'))
      throw new Error(`expected original scope start 'B', got "${startItem}"`);
    // ECMA-426: positions use unsigned VLQ; relative name/kind use signed VLQ.
    const rawUnsigned = decodeVlqSegmentUnsigned(startItem.slice(1));
    const rawSigned = decodeVlqSegment(startItem.slice(1));
    let p = 0;
    const flags = rawUnsigned[p++] ?? 0;
    const line = previousPos.line + (rawUnsigned[p++] ?? 0);
    const columnRaw = rawUnsigned[p++] ?? 0;
    const column = line === previousPos.line ? previousPos.column + columnRaw : columnRaw;

    let name: string | undefined;
    if ((flags & 0x1) !== 0) {
      previousOriginalName += rawSigned[p++] ?? 0;
      name = names[previousOriginalName];
    }

    let kind: string | undefined;
    if ((flags & 0x2) !== 0) {
      previousOriginalKind += rawSigned[p++] ?? 0;
      kind = names[previousOriginalKind];
    }

    const node: OriginalScopeNode = {
      index: originalByStartIndex.length,
      sourceIndex,
      start: { line, column },
      end: { line, column },
      name,
      kind,
      isStackFrame: (flags & 0x4) !== 0,
      variables: [],
      children: [],
    };
    originalByStartIndex.push(node);

    let cursorPos = { line, column };
    while (idx.value < items.length) {
      const item = items[idx.value] ?? '';
      if (item.startsWith('D')) {
        idx.value++;
        const vars = decodeVlqSegment(item.slice(1));
        for (const rawVar of vars) {
          previousOriginalVariable += rawVar;
          node.variables.push(
            names[previousOriginalVariable] ?? `<name:${previousOriginalVariable}>`,
          );
        }
        continue;
      }
      if (item.startsWith('B')) {
        const child = parseOriginalTree(sourceIndex, cursorPos);
        cursorPos = { ...child.end };
        node.children.push(child);
        continue;
      }
      break;
    }

    const endItem = safeItem(idx.value++);
    if (!endItem?.startsWith('C'))
      throw new Error(`expected original scope end 'C', got "${endItem}"`);
    const endRaw = decodeVlqSegmentUnsigned(endItem.slice(1));
    const endLine = cursorPos.line + (endRaw[0] ?? 0);
    const endColumnRaw = endRaw[1] ?? 0;
    const endColumn = endLine === cursorPos.line ? cursorPos.column + endColumnRaw : endColumnRaw;
    node.end = { line: endLine, column: endColumn };
    return node;
  }

  function parseGeneratedTree(previousPos: { line: number; column: number }): GeneratedRangeNode {
    const startItem = safeItem(idx.value++);
    if (!startItem?.startsWith('E'))
      throw new Error(`expected generated range start 'E', got "${startItem}"`);
    // ECMA-426: flags/range positions use unsigned VLQ; range definitions use signed VLQ.
    const rawUnsigned = decodeVlqSegmentUnsigned(startItem.slice(1));
    const rawSigned = decodeVlqSegment(startItem.slice(1));
    let p = 0;
    const flags = rawUnsigned[p++] ?? 0;
    const hasLine = (flags & 0x1) !== 0;
    const line = previousPos.line + (hasLine ? (rawUnsigned[p++] ?? 0) : 0);
    const columnRaw = rawUnsigned[p++] ?? 0;
    const column = line === previousPos.line ? previousPos.column + columnRaw : columnRaw;

    let definitionIndex: number | undefined;
    if ((flags & 0x2) !== 0) {
      previousDefinition += rawSigned[p++] ?? 0;
      definitionIndex = previousDefinition;
    }

    const node: GeneratedRangeNode = {
      start: { line, column },
      end: { line, column },
      isStackFrame: (flags & 0x4) !== 0,
      isHidden: (flags & 0x8) !== 0,
      definitionIndex,
      children: [],
    };

    const subrangeState = new Map<number, { line: number; column: number }>();
    let previousVariableIndex = 0;
    let cursorPos = { line, column };

    while (idx.value < items.length) {
      const item = items[idx.value] ?? '';
      if (item.startsWith('G')) {
        idx.value++;
        node.bindings = decodeVlqSegmentUnsigned(item.slice(1)).map((v) => readName(v));
        continue;
      }
      if (item.startsWith('H')) {
        idx.value++;
        const sub = decodeVlqSegmentUnsigned(item.slice(1));
        if (!node.bindings) node.bindings = [];
        let s = 0;
        previousVariableIndex += sub[s++] ?? 0;
        const variableIndex = previousVariableIndex;
        const ranges: BindingRangeNode[] = [];
        let prev = subrangeState.get(variableIndex) ?? {
          line: node.start.line,
          column: node.start.column,
        };
        while (s < sub.length) {
          const expr = readName(sub[s++] ?? 0);
          const lineDelta = sub[s++] ?? 0;
          const nextLine = prev.line + lineDelta;
          const colRaw = sub[s++] ?? 0;
          const nextColumn = nextLine === prev.line ? prev.column + colRaw : colRaw;
          ranges.push({ from: { line: nextLine, column: nextColumn }, expression: expr });
          prev = { line: nextLine, column: nextColumn };
        }
        subrangeState.set(variableIndex, prev);
        while (node.bindings.length <= variableIndex) node.bindings.push(undefined);
        node.bindings[variableIndex] = ranges;
        continue;
      }
      if (item.startsWith('I')) {
        idx.value++;
        const cs = decodeVlqSegmentUnsigned(item.slice(1));
        node.callsite = { sourceIndex: cs[0] ?? 0, line: cs[1] ?? 0, column: cs[2] ?? 0 };
        continue;
      }
      if (item.startsWith('E')) {
        const child = parseGeneratedTree(cursorPos);
        cursorPos = { ...child.end };
        node.children.push(child);
        continue;
      }
      break;
    }

    const endItem = safeItem(idx.value++);
    if (!endItem?.startsWith('F'))
      throw new Error(`expected generated range end 'F', got "${endItem}"`);
    const endRaw = decodeVlqSegmentUnsigned(endItem.slice(1));
    const endHasLine = endRaw.length === 2;
    const endLine = cursorPos.line + (endHasLine ? (endRaw[0] ?? 0) : 0);
    const endColumnRaw = endRaw[endHasLine ? 1 : 0] ?? 0;
    const endColumn = endLine === cursorPos.line ? cursorPos.column + endColumnRaw : endColumnRaw;
    node.end = { line: endLine, column: endColumn };
    previousGeneratedLine = endLine;
    previousGeneratedColumn = endColumn;
    return node;
  }

  const originalScopes: Array<OriginalScopeNode | null> = Array.from(
    { length: sources.length },
    () => null,
  );
  for (
    let sourceIndex = 0;
    sourceIndex < sources.length && idx.value < items.length;
    sourceIndex++
  ) {
    if ((items[idx.value] ?? '') === '') {
      idx.value++;
      continue;
    }
    if (!(items[idx.value] ?? '').startsWith('B')) break;
    originalScopes[sourceIndex] = parseOriginalTree(sourceIndex, { line: 0, column: 0 });
    if ((items[idx.value] ?? '') === '') idx.value++;
  }

  const generatedRanges: GeneratedRangeNode[] = [];
  while (idx.value < items.length) {
    if ((items[idx.value] ?? '') === '') {
      idx.value++;
      continue;
    }
    generatedRanges.push(
      parseGeneratedTree({ line: previousGeneratedLine, column: previousGeneratedColumn }),
    );
  }

  return { originalScopes, generatedRanges };
}

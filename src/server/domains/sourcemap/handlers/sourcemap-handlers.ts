/**
 * Main sourcemap sub-handler — discover, fetch/parse, reconstruct tree.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { resolveArtifactPath } from '@utils/artifacts';
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
} from './shared';
import {
  parseSourceMap,
  parseSourceMapStats,
  resolveSourceMapUrl,
  extractSourceMappingUrlFromScript,
  combineSourceRoot,
  normalizeSourcePath,
  safeTarget,
} from './sourcemap-parsing';

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
      await delay(250);

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
}

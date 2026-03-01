import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type {
  CdpSessionLike,
  DiscoverItem,
  JsonRecord,
  MutableDiscoverItem,
  TextToolResponse,
} from './handlers.impl.sourcemap-parse-base.js';
import { resolveArtifactPath } from '../../../utils/artifacts.js';
import { SourcemapToolHandlersExtension } from './handlers.impl.sourcemap-extension.js';

export class SourcemapToolHandlersMain extends SourcemapToolHandlersExtension {
  async handleSourcemapDiscover(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    const includeInline = this.parseBooleanArg(args.includeInline, true);

    const page = await this.collector.getActivePage();
    const session = (await page.createCDPSession()) as unknown as CdpSessionLike;
    const scripts = new Map<string, MutableDiscoverItem>();

    const onScriptParsed = (payload: unknown): void => {
      const record = this.asRecord(payload);
      const scriptId = this.asString(record.scriptId);
      if (!scriptId) {
        return;
      }

      const scriptUrl = this.asString(record.url) ?? '';
      const sourceMapUrlRaw = this.asString(record.sourceMapURL) ?? '';

      const existing = scripts.get(scriptId);
      const sourceMapUrlResolved = sourceMapUrlRaw
        ? this.resolveSourceMapUrl(sourceMapUrlRaw, scriptUrl)
        : existing?.sourceMapUrl ?? '';

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
      await this.delay(250);

      for (const item of scripts.values()) {
        if (item.sourceMapUrl) {
          continue;
        }

        if (!item.scriptId || !item.scriptUrl) {
          continue;
        }

        try {
          const sourceResponse = this.asRecord(
            await session.send('Debugger.getScriptSource', {
              scriptId: item.scriptId,
            })
          );
          const scriptSource = this.asString(sourceResponse.scriptSource);
          if (!scriptSource) {
            continue;
          }

          const extracted = this.extractSourceMappingUrlFromScript(scriptSource);
          if (!extracted) {
            continue;
          }

          const resolvedSourceMap = this.resolveSourceMapUrl(
            extracted,
            item.scriptUrl
          );
          item.sourceMapUrl = resolvedSourceMap;
          item.isInline = resolvedSourceMap.startsWith('data:');
        } catch {
          continue;
        }
      }

      const result: DiscoverItem[] = Array.from(scripts.values())
        .filter((item) => item.sourceMapUrl.length > 0)
        .filter((item) => includeInline || !item.isInline)
        .sort((left, right) => {
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

      return this.json(result);
    } catch (error) {
      return this.fail('sourcemap_discover', error);
    } finally {
      session.off?.('Debugger.scriptParsed', onScriptParsed);
      await this.trySend(session, 'Debugger.disable');
      await this.safeDetach(session);
    }
  }

  async handleSourcemapFetchAndParse(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    try {
      const sourceMapUrl = this.requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
      const scriptUrl = this.optionalStringArg(args.scriptUrl);

      const parsed = await this.parseSourceMap(sourceMapUrl, scriptUrl);

      const responsePayload: JsonRecord = {
        sources: parsed.map.sources,
        mappingsCount: parsed.mappingsCount,
        segmentCount: parsed.segmentCount,
      };

      const hasSourcesContent = Array.isArray(parsed.map.sourcesContent);
      if (hasSourcesContent) {
        responsePayload.sourcesContent = parsed.map.sourcesContent as Array<string | null>;
      }

      return this.json(responsePayload);
    } catch (error) {
      return this.fail('sourcemap_fetch_and_parse', error);
    }
  }

  async handleSourcemapReconstructTree(
    args: Record<string, unknown>
  ): Promise<TextToolResponse> {
    try {
      const sourceMapUrl = this.requiredStringArg(args.sourceMapUrl, 'sourceMapUrl');
      const outputDir = this.optionalStringArg(args.outputDir);

      const parsed = await this.parseSourceMap(sourceMapUrl, undefined);

      const artifactTarget = this.safeTarget(parsed.resolvedUrl);
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
        const sourcePath = this.combineSourceRoot(parsed.map.sourceRoot, rawSourcePath);
        const relativePath = this.normalizeSourcePath(sourcePath, index);
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

      return this.json({
        outputDir: outputRootDisplay,
        totalSources: parsed.map.sources.length,
        writtenFiles: writtenFiles.length,
        skippedFiles,
        files: writtenFiles,
      });
    } catch (error) {
      return this.fail('sourcemap_reconstruct_tree', error);
    }
  }

}

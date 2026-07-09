/**
 * Sourcemap domain — composition facade.
 *
 * Parsing utilities extracted to ./handlers/shared.ts and ./handlers/sourcemap-parsing.ts.
 * Handler methods delegated to ExtensionHandlers and SourcemapHandlers sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { handleSafe, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { SourcemapSharedState } from './handlers/shared';
import { ExtensionHandlers } from './handlers/extension-handlers';
import { SourcemapHandlers } from './handlers/sourcemap-handlers';

export class SourcemapToolHandlers {
  protected collector: CodeCollector;
  private extension: ExtensionHandlers;
  private sourcemap: SourcemapHandlers;

  constructor(collector: CodeCollector) {
    this.collector = collector;
    const state: SourcemapSharedState = { collector };
    this.extension = new ExtensionHandlers(state);
    this.sourcemap = new SourcemapHandlers(state);
  }

  async handleExtensionListInstalledTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleExtensionListInstalled(args));
  }

  handleExtensionListInstalled(args: Record<string, unknown>) {
    return this.extension.handleExtensionListInstalled(args);
  }

  async handleExtensionExecuteInContextTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleExtensionExecuteInContext(args));
  }

  handleExtensionExecuteInContext(args: Record<string, unknown>) {
    return this.extension.handleExtensionExecuteInContext(args);
  }

  async handleSourcemapDiscoverTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapDiscover(args));
  }

  handleSourcemapDiscover(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapDiscover(args);
  }

  async handleSourcemapFetchAndParseTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapFetchAndParse(args));
  }

  handleSourcemapFetchAndParse(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapFetchAndParse(args);
  }

  async handleSourcemapCoverageTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapCoverage(args));
  }

  handleSourcemapCoverage(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapCoverage(args);
  }

  async handleSourcemapLookupTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapLookup(args));
  }

  handleSourcemapLookup(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapLookup(args);
  }

  async handleSourcemapReconstructTreeTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapReconstructTree(args));
  }

  handleSourcemapReconstructTree(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapReconstructTree(args);
  }

  async handleSourcemapParseV4Tool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapParseV4(args));
  }

  handleSourcemapParseV4(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapParseV4(args);
  }

  async handleSourcemapDiffTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSourcemapDiff(args));
  }

  handleSourcemapDiff(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapDiff(args);
  }
}

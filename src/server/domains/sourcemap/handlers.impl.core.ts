/**
 * Sourcemap domain — composition facade.
 *
 * Parsing utilities extracted to ./handlers/shared.ts and ./handlers/sourcemap-parsing.ts.
 * Handler methods delegated to ExtensionHandlers and SourcemapHandlers sub-handlers.
 */

import type { CodeCollector } from '@server/domains/shared/modules';
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

  handleExtensionListInstalled(args: Record<string, unknown>) {
    return this.extension.handleExtensionListInstalled(args);
  }
  handleExtensionExecuteInContext(args: Record<string, unknown>) {
    return this.extension.handleExtensionExecuteInContext(args);
  }
  handleSourcemapDiscover(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapDiscover(args);
  }
  handleSourcemapFetchAndParse(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapFetchAndParse(args);
  }
  handleSourcemapReconstructTree(args: Record<string, unknown>) {
    return this.sourcemap.handleSourcemapReconstructTree(args);
  }
}

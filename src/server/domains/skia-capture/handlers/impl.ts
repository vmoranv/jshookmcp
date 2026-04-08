/**
 * SkiaCaptureHandlers — facade for skia-capture domain tool handlers.
 *
 * Delegates to handlers/skia-detect.ts for actual implementation.
 */
import { ToolError } from '@errors/ToolError';
import type { PageController } from '@server/domains/shared/modules';
import { detectRenderer, dumpScene, correlateObjects } from './skia-detect';
import type { JSObjectInfo } from '@modules/skia-capture/SkiaObjectCorrelator';

export interface SkiaCaptureDomainDependencies {
  pageController: PageController | null;
  /** Optional: function to get JS objects from v8-inspector heap snapshot */
  getJSObjects?: () => JSObjectInfo[] | Promise<JSObjectInfo[]>;
}

export class SkiaCaptureHandlers {
  private deps: SkiaCaptureDomainDependencies;

  constructor(deps: SkiaCaptureDomainDependencies) {
    this.deps = deps;
  }

  async handleSkiaDetectRenderer(args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.pageController) {
      throw new ToolError(
        'PREREQUISITE',
        'PageController not available — ensure browser is connected',
      );
    }
    return detectRenderer(this.deps.pageController, args);
  }

  async handleSkiaExtractScene(args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.pageController) {
      throw new ToolError(
        'PREREQUISITE',
        'PageController not available — ensure browser is connected',
      );
    }
    return dumpScene(this.deps.pageController, args);
  }

  async handleSkiaCorrelateObjects(args: Record<string, unknown>): Promise<unknown> {
    if (!this.deps.pageController) {
      throw new ToolError(
        'PREREQUISITE',
        'PageController not available — ensure browser is connected',
      );
    }
    return correlateObjects(this.deps.pageController, args, this.deps.getJSObjects);
  }
}

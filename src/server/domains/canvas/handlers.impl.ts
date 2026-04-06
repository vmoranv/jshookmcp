/**
 * Canvas domain tool handlers.
 *
 * Thin facade — delegates to focused handlers under handlers/.
 */
import type { ToolResponse } from '@server/types';
import { argNumber } from '@server/domains/shared/parse-args';
import { asJsonResponse, toolErrorToResponse } from '@server/domains/shared/response';
import type { CanvasDomainDependencies } from '@server/domains/canvas/dependencies';
import { handleFingerprint } from './handlers/fingerprint';
import { handleSceneDump } from './handlers/scene-dump';
import { handlePick } from './handlers/pick';
import { handleTraceClick } from './handlers/trace';

export class CanvasToolHandlers {
  private readonly pageController;
  private readonly debuggerManager;
  private readonly evidenceStore;

  constructor(deps: CanvasDomainDependencies) {
    this.pageController = deps.pageController;
    this.debuggerManager = deps.debuggerManager;
    this.evidenceStore = deps.evidenceStore;
  }

  async handleFingerprint(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleFingerprint(this.pageController, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handleSceneDump(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleSceneDump(this.pageController, args);
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handlePick(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const x = argNumber(args, 'x', 0);
      const y = argNumber(args, 'y', 0);
      const result = await handlePick(this.pageController, { ...args, x, y });
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }

  async handleTraceClick(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const result = await handleTraceClick(
        this.pageController,
        this.debuggerManager,
        this.evidenceStore,
        args,
      );
      return asJsonResponse(result);
    } catch (err) {
      return toolErrorToResponse(err);
    }
  }
}

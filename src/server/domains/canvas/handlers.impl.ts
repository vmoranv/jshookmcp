/**
 * Canvas domain tool handlers.
 *
 * Thin facade — delegates to focused handlers under handlers/.
 */
import type { ToolResponse } from '@server/types';
import { argNumber } from '@server/domains/shared/parse-args';
import { handleSafe } from '@server/domains/shared/ResponseBuilder';
import { asJsonResponse } from '@server/domains/shared/response';
import type { CanvasDomainDependencies } from '@server/domains/canvas/dependencies';
import { handleFingerprint } from './handlers/fingerprint';
import { handleSceneDump } from './handlers/scene-dump';
import { handlePick } from './handlers/pick';
import { handleTraceClick } from './handlers/trace';
import { handleSceneSearch } from './handlers/scene-search';
import { handleDrawHook } from './handlers/draw-hook';

export class CanvasToolHandlers {
  private readonly pageController;
  private readonly debuggerManager;
  private readonly evidenceStore;

  constructor(deps: CanvasDomainDependencies) {
    this.pageController = deps.pageController;
    this.debuggerManager = deps.debuggerManager;
    this.evidenceStore = deps.evidenceStore;
  }

  async handleFingerprintTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleFingerprint(args));
  }

  async handleSceneDumpTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSceneDump(args));
  }

  async handlePickTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handlePick(args));
  }

  async handleTraceClickTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleTraceClick(args));
  }

  async handleSceneSearchTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleSceneSearch(args));
  }

  async handleDrawHookTool(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSafe(async () => await this.handleDrawHook(args));
  }

  async handleFingerprint(args: Record<string, unknown>): Promise<ToolResponse> {
    const result = await handleFingerprint(this.pageController, args);
    return asJsonResponse(result);
  }

  async handleSceneDump(args: Record<string, unknown>): Promise<ToolResponse> {
    const result = await handleSceneDump(this.pageController, args);
    return asJsonResponse(result);
  }

  async handlePick(args: Record<string, unknown>): Promise<ToolResponse> {
    const x = argNumber(args, 'x', 0);
    const y = argNumber(args, 'y', 0);
    const result = await handlePick(this.pageController, { ...args, x, y });
    return asJsonResponse(result);
  }

  async handleTraceClick(args: Record<string, unknown>): Promise<ToolResponse> {
    const result = await handleTraceClick(
      this.pageController,
      this.debuggerManager,
      this.evidenceStore,
      args,
    );
    return asJsonResponse(result);
  }

  async handleSceneSearch(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleSceneSearch(args);
  }

  async handleDrawHook(args: Record<string, unknown>): Promise<ToolResponse> {
    return handleDrawHook(this.pageController, args);
  }
}

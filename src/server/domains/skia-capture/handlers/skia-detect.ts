/**
 * Skia renderer detection and scene dump handlers.
 *
 * Implements SKIA-01 (detectSkiaRenderer) and SKIA-02 (extractSceneTree).
 * Integrates with v8-inspector domain for SKIA-03 (correlateObjects).
 */
import { ToolError } from '@errors/ToolError';
import { argString, argBool } from '@server/domains/shared/parse-args';
import type { PageController } from '@server/domains/shared/modules';
import { detectSkiaRenderer, extractSceneTree } from '@modules/skia-capture/SkiaSceneExtractor';
import { correlateToJS } from '@modules/skia-capture/SkiaObjectCorrelator';
import type { JSObjectInfo } from '@modules/skia-capture/SkiaObjectCorrelator';

/**
 * Handler for skia_detect_renderer (SKIA-01).
 */
export async function detectRenderer(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<unknown> {
  const canvasId = argString(args, 'canvasId');
  const rendererInfo = await detectSkiaRenderer(pageController, canvasId || undefined);

  return {
    rendererInfo,
    canvasId: canvasId || 'auto',
    detectionComplete: true,
  };
}

/**
 * Handler for skia_dump_scene (SKIA-02).
 */
export async function dumpScene(
  pageController: PageController,
  args: Record<string, unknown>,
): Promise<unknown> {
  const canvasId = argString(args, 'canvasId');
  const includeDrawCommands = argBool(args, 'includeDrawCommands', true);

  const sceneTree = await extractSceneTree(
    pageController,
    canvasId || undefined,
    includeDrawCommands,
  );

  return {
    sceneTree,
    canvasId: canvasId || 'auto',
    extractionComplete: true,
  };
}

/**
 * Handler for skia_correlate_objects (SKIA-03).
 *
 * Cross-domain: requires v8-inspector for JS object data.
 */
export async function correlateObjects(
  pageController: PageController,
  args: Record<string, unknown>,
  getJSObjects?: () => JSObjectInfo[] | Promise<JSObjectInfo[]>,
): Promise<unknown> {
  const canvasId = argString(args, 'canvasId');

  // Extract Skia scene
  const sceneTree = await extractSceneTree(pageController, canvasId || undefined, true);

  if (sceneTree.layers.length === 0 && sceneTree.drawCommands.length === 0) {
    throw new ToolError('PREREQUISITE', 'No Skia scene data available for correlation');
  }

  // Get JS objects from v8-inspector if available
  let jsObjects: JSObjectInfo[] = [];
  if (getJSObjects) {
    try {
      jsObjects = await getJSObjects();
    } catch {
      // Graceful degradation — no JS objects available
      jsObjects = [];
    }
  }

  const result = correlateToJS(sceneTree, jsObjects);

  return {
    correlations: result,
    canvasId: canvasId || 'auto',
    correlationComplete: true,
  };
}

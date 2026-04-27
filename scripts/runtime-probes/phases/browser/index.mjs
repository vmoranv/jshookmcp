import { runBrowserCapabilitiesPhase } from './capabilities.mjs';
import { runBrowserCoordinationPhase } from './coordination.mjs';
import { runBrowserCorePhase } from './core.mjs';
import { runBrowserPageInteractionPhase } from './page-interaction.mjs';

export async function runBrowserPhase(ctx) {
  await runBrowserCorePhase(ctx);
  await runBrowserPageInteractionPhase(ctx);
  await runBrowserCapabilitiesPhase(ctx);
  await runBrowserCoordinationPhase(ctx);
}

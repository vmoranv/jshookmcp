import { runProcessLifecyclePhase } from './lifecycle.mjs';
import { runProcessMemoryPhase } from './memory.mjs';

export async function runProcessPhase(ctx) {
  await runProcessLifecyclePhase(ctx);
  await runProcessMemoryPhase(ctx);
}

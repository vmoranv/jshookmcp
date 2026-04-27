import { runCrossDomainBinaryPhase } from './cross-domain-binary.mjs';
import { runSourcemapAttachSyscallPhase } from './sourcemap-attach-syscall.mjs';

export async function runAdvancedRuntimePhase(ctx) {
  await runCrossDomainBinaryPhase(ctx);
  await runSourcemapAttachSyscallPhase(ctx);
}

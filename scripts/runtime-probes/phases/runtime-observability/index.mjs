import { runConsoleInterceptJsdomPhase } from './console-intercept-jsdom.mjs';
import { runGraphqlWasmPhase } from './graphql-wasm.mjs';
import { runNetworkTracePhase } from './network-trace.mjs';
import { runProxyAndTraceSetupPhase } from './proxy-stream-trace.mjs';
import { runV8Phase } from './v8.mjs';

export async function runRuntimeObservabilityPhase(ctx) {
  await runProxyAndTraceSetupPhase(ctx);
  await runGraphqlWasmPhase(ctx);
  await runConsoleInterceptJsdomPhase(ctx);
  await runV8Phase(ctx);
  await runNetworkTracePhase(ctx);
}

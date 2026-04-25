import type { ExternalToolRunner } from '@server/domains/shared/modules';
import { capabilityReport } from '@server/domains/shared/capabilities';
import { toTextResponse } from '@server/domains/platform/handlers/platform-utils';
import { getElectronIPCSniffRuntimeCapability } from '@server/domains/platform/handlers/electron-ipc-sniffer';
import { probeView8Availability } from '@server/domains/platform/handlers/v8-bytecode-handler';

export async function handlePlatformCapabilities(
  runner: ExternalToolRunner,
): Promise<ReturnType<typeof toTextResponse>> {
  const probes = await runner.probeAll();
  const miniappProbe = probes['miniapp.unpacker'];
  const view8Availability = (await probeView8Availability()) ?? {
    available: false,
    reason: 'view8 probe returned no result',
  };
  const ipcCapability = getElectronIPCSniffRuntimeCapability() ?? {
    available: false,
    reason: 'IPC runtime probe returned no result',
  };

  return toTextResponse(
    capabilityReport('platform_capabilities', [
      {
        capability: 'miniapp_unpacker',
        status: miniappProbe?.available ? 'available' : 'unavailable',
        reason: miniappProbe?.reason,
        fix: miniappProbe?.available
          ? undefined
          : 'Install unveilr to enable the fast external unpack path.',
        details: {
          tools: ['miniapp_pkg_unpack'],
          fallback: 'Built-in Node.js parser remains available.',
          ...(miniappProbe?.path ? { path: miniappProbe.path } : {}),
          ...(miniappProbe?.version ? { version: miniappProbe.version } : {}),
        },
      },
      {
        capability: 'view8',
        status: view8Availability.available ? 'available' : 'unavailable',
        reason: view8Availability.reason,
        fix: view8Availability.available
          ? undefined
          : 'Install view8 with pip install view8 to enable full bytecode decompilation.',
        details: {
          tools: ['v8_bytecode_decompile'],
          fallback: 'Built-in constant-pool extraction remains available.',
          ...(view8Availability.interpreter ? { interpreter: view8Availability.interpreter } : {}),
        },
      },
      {
        capability: 'electron_ipc_sniff_runtime',
        status: ipcCapability.available ? 'available' : 'unavailable',
        reason: ipcCapability.reason,
        fix: ipcCapability.fix,
        details: {
          tools: ['electron_ipc_sniff'],
          note: 'A renderer CDP port is still required at call time.',
        },
      },
    ]),
  );
}

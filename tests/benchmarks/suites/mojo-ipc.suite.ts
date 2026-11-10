/**
 * Mojo IPC domain benchmark (offline codec subset).
 *
 * External vectors: none (Mojo wire format has no public RFC; the roundtrip
 * identity and the uint32 little-endian encoding serve as the anchors).
 * Homemade fixtures:
 *  - encode determinism + uint32 LE byte encoding (150 → …96 00 00 00)
 *  - encode → decode roundtrip preserving the field value
 *  - list_interfaces honest contract: empty list without a live target, or an
 *    explicitly-marked seeded/simulated catalog (never silent fabrication)
 *  - capabilities report enumerates the monitoring capability entry
 *
 * Cases call the raw internal handlers (not the *Tool wrappers): the wrappers
 * return content-wrapped ToolResponses, and nested ToolResponses inside a
 * case's run() return are not unwrapped by the harness body() extractor.
 */
import { MojoIPCHandlers } from '@server/domains/mojo-ipc/handlers';
import { type BenchSuite } from '../harness';

const handlers = new MojoIPCHandlers();

export const mojoIpcSuite: BenchSuite = {
  name: 'mojo-ipc',
  domain: 'mojo-ipc',
  description:
    'mojo encode/decode codec roundtrip + offline availability contracts — no live Chromium needed',
  cases: [
    {
      name: 'mojo_encode_message/uint32-le-deterministic',
      tool: 'mojo_encode_message',
      origin: 'homemade',
      reference:
        'encoder contract: uint32 fields are little-endian (150 → …96 00 00 00) and identical inputs encode identically',
      run: async () => {
        const args = {
          interfaceName: 'network.mojom.URLLoaderFactory',
          messageType: 0,
          fields: [{ type: 'uint32', value: 150 }],
        };
        const a = await handlers.handleMojoEncodeMessage(args);
        const b = await handlers.handleMojoEncodeMessage(args);
        return { a, b };
      },
      validate: (v) => {
        const { a, b } = v as {
          a?: { success?: boolean; error?: string; hexPayload?: string };
          b?: { hexPayload?: string };
        };
        if (a?.success === false) return `encode failed: ${a.error}`;
        const hex = a?.hexPayload ?? '';
        if (hex.length === 0) return 'empty hexPayload';
        if (hex.length % 2 !== 0) return `odd-length hex payload (${hex.length})`;
        if (!hex.includes('96000000'))
          return `uint32 LE encoding of 150 (…96000000) missing, got ${hex}`;
        if (hex !== (b?.hexPayload ?? ''))
          return 'encoding is not deterministic across identical calls';
        return true;
      },
    },
    {
      name: 'mojo_decode_message/encode-roundtrip',
      tool: 'mojo_decode_message',
      origin: 'homemade',
      reference: 'decode(encode(msg)) must preserve the encoded field value and interface label',
      run: async () => {
        const enc = (await handlers.handleMojoEncodeMessage({
          interfaceName: 'network.mojom.URLLoaderFactory',
          messageType: 0,
          fields: [{ type: 'uint32', value: 150 }],
        })) as { success?: boolean; error?: string; hexPayload?: string };
        if (enc.success === false) throw new Error(`encode failed: ${enc.error}`);
        return handlers.handleMojoDecodeMessage({
          hexPayload: enc.hexPayload ?? '',
          interfaceName: 'network.mojom.URLLoaderFactory',
          messageType: 0,
        });
      },
      validate: (v) => {
        const b = v as { success?: boolean; error?: string; decoded?: unknown };
        if (b.success === false) return `decode failed: ${b.error}`;
        const s = JSON.stringify(b.decoded ?? {});
        if (!s.includes('150'))
          return `decoded payload lost the uint32 value 150, got ${s.slice(0, 120)}`;
        return true;
      },
    },
    {
      name: 'mojo_list_interfaces/honest-listing-contract',
      tool: 'mojo_list_interfaces',
      origin: 'homemade',
      reference:
        'without a live Chromium target the tool reports an empty list, or a catalog explicitly marked seeded/simulated — never silent fabrication',
      run: () => handlers.handleMojoListInterfaces(),
      validate: (v) => {
        const b = v as {
          interfaces?: unknown[];
          available?: boolean;
          warning?: string;
          interfaceCatalogSource?: string;
          simulation?: boolean;
        };
        if (!Array.isArray(b.interfaces))
          return `missing interfaces array, got ${typeof b.interfaces}`;
        if (b.interfaces.length === 0) return true;
        const s = JSON.stringify(b);
        if (
          b.warning === undefined &&
          b.interfaceCatalogSource === undefined &&
          b.simulation === undefined &&
          !s.includes('simulated') &&
          !s.includes('seeded')
        )
          return 'non-empty interface list without an explicit seeded/simulated marker';
        return true;
      },
    },
    {
      name: 'mojo_ipc_capabilities/monitoring-entry',
      tool: 'mojo_ipc_capabilities',
      origin: 'homemade',
      reference:
        'capability report must enumerate the mojo_ipc_monitoring capability and its tools',
      run: () => handlers.handleMojoIpcCapabilities(),
      validate: (v) => {
        const b = v as {
          capabilities?: Array<{
            capability?: string;
            tools?: string[];
            details?: { tools?: string[] };
          }>;
        };
        const caps = b.capabilities ?? [];
        const monitoring = caps.find((c) => c.capability === 'mojo_ipc_monitoring');
        if (!monitoring)
          return `missing mojo_ipc_monitoring capability entry, got ${caps.map((c) => c.capability).join(',')}`;
        const tools = monitoring.tools ?? monitoring.details?.tools ?? [];
        if (!tools.includes('mojo_monitor'))
          return `capability tools missing mojo_monitor, got ${tools.join(',')}`;
        return true;
      },
    },
  ],
};

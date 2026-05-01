import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { MCPTestClient } from '@tests/e2e/helpers/mcp-client';

interface RouteToolResponse {
  recommendations: Array<{ name: string }>;
  nextActions: Array<{ toolName?: string; command: string }>;
}

interface BinaryDetectFormatResponse {
  success: boolean;
  byteLength: number;
}

interface BinaryDecodeResponse {
  success: boolean;
  result: string;
}

interface ProtocolField {
  name: string;
  offset: number;
  length: number;
  type: string;
}

interface ProtoAutoDetectResponse {
  success: boolean;
  patterns: Array<{
    name: string;
    fields: ProtocolField[];
    byteOrder: string;
  }>;
}

interface ProtoInferFieldsResponse {
  success: boolean;
  fields: ProtocolField[];
}

interface PayloadTemplateBuildResponse {
  success: boolean;
  hexPayload: string;
  byteLength: number;
}

interface ChecksumApplyResponse {
  success: boolean;
  checksumHex: string;
  mutatedHex: string;
}

interface CryptoHarnessResponse {
  allPassed: boolean;
  results: Array<{
    input: string;
    output: string;
    error?: string;
  }>;
}

const BASE64_SAMPLES = ['3q3A3gEA', '3q3A3gIA', '3q3A3gMA'];
const HEX_SAMPLES = ['deadc0de0100', 'deadc0de0200', 'deadc0de0300'];

describe('Protocol Pure Compute E2E', { timeout: 180_000, sequential: true }, () => {
  const client = new MCPTestClient();

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.cleanup();
  });

  test('PROTOCOL-01: route_tool prefers stateless compute helpers over browser probes', async () => {
    if (!client.getToolMap().has('route_tool')) {
      client.recordSynthetic('route_tool', 'SKIP', 'Tool not registered');
      return;
    }

    const routed = await client.call(
      'route_tool',
      {
        task: '离线解码一组 base64 payload 样本，推断协议字段，重建 payload，并用确定性 crypto harness 验证签名逻辑',
      },
      15_000,
    );

    expect(routed.result.status).not.toBe('FAIL');

    const body = routed.parsed as RouteToolResponse;
    const recommendedNames = body.recommendations.map((item) => item.name);

    expect(recommendedNames.slice(0, 10)).toEqual(
      expect.arrayContaining(['binary_detect_format', 'binary_decode', 'proto_auto_detect']),
    );
    expect(recommendedNames[0]).toBe('binary_detect_format');
    expect(recommendedNames).toContain('proto_infer_fields');
    expect(recommendedNames.slice(0, 10)).not.toContain('browser_launch');
    expect(recommendedNames.slice(0, 10)).not.toContain('page_evaluate');
  });

  test('PROTOCOL-02: agent-usable pure-compute chain decodes, infers, rebuilds, and computes payloads', async () => {
    const requiredTools = [
      'binary_detect_format',
      'binary_decode',
      'proto_auto_detect',
      'proto_infer_fields',
      'payload_template_build',
      'checksum_apply',
      'crypto_test_harness',
    ];
    const missing = requiredTools.filter((toolName) => !client.getToolMap().has(toolName));
    if (missing.length > 0) {
      client.recordSynthetic('protocol-pure-compute', 'SKIP', `Missing: ${missing.join(', ')}`);
      return;
    }

    const detected = await client.call(
      'binary_detect_format',
      { data: BASE64_SAMPLES[0], source: 'base64' },
      10_000,
    );
    expect(detected.result.status).toBe('PASS');
    const detectedBody = detected.parsed as BinaryDetectFormatResponse;
    expect(detectedBody.success).toBe(true);
    expect(detectedBody.byteLength).toBe(6);

    const decodedHexes: string[] = [];
    for (const base64Payload of BASE64_SAMPLES) {
      const decoded = await client.call(
        'binary_decode',
        { data: base64Payload, encoding: 'base64', outputFormat: 'hex' },
        10_000,
      );
      expect(decoded.result.status).toBe('PASS');
      const decodedBody = decoded.parsed as BinaryDecodeResponse;
      expect(decodedBody.success).toBe(true);
      decodedHexes.push(decodedBody.result);
    }

    expect(decodedHexes).toEqual(HEX_SAMPLES);

    const autoDetected = await client.call(
      'proto_auto_detect',
      { hexPayloads: decodedHexes },
      10_000,
    );
    expect(autoDetected.result.status).toBe('PASS');

    const autoDetectedBody = autoDetected.parsed as ProtoAutoDetectResponse;
    expect(autoDetectedBody.success).toBe(true);
    expect(autoDetectedBody.patterns).toHaveLength(1);
    expect(autoDetectedBody.patterns[0]?.fields).toHaveLength(2);
    expect(autoDetectedBody.patterns[0]?.fields[0]).toMatchObject({
      name: 'magic',
      offset: 0,
      length: 4,
      type: 'uint32',
    });
    expect(autoDetectedBody.patterns[0]?.fields[1]).toMatchObject({
      name: 'version',
      offset: 4,
      length: 2,
      type: 'uint16',
    });

    const inferred = await client.call('proto_infer_fields', { hexPayloads: decodedHexes }, 10_000);
    expect(inferred.result.status).toBe('PASS');

    const inferredBody = inferred.parsed as ProtoInferFieldsResponse;
    expect(inferredBody.success).toBe(true);
    expect(inferredBody.fields).toHaveLength(2);
    expect(inferredBody.fields[0]).toMatchObject({
      name: 'magic',
      offset: 0,
      length: 4,
      type: 'int',
    });
    expect(inferredBody.fields[1]).toMatchObject({
      name: 'version',
      offset: 4,
      length: 2,
      type: 'int',
    });

    const rebuilt = await client.call(
      'payload_template_build',
      {
        fields: [
          { name: 'magic', type: 'u32', value: 0xdeadc0de },
          { name: 'version', type: 'u16', value: 0x0100 },
        ],
        endian: 'big',
      },
      10_000,
    );
    expect(rebuilt.result.status).toBe('PASS');

    const rebuiltBody = rebuilt.parsed as PayloadTemplateBuildResponse;
    expect(rebuiltBody.success).toBe(true);
    expect(rebuiltBody.hexPayload).toBe(HEX_SAMPLES[0]);
    expect(rebuiltBody.byteLength).toBe(6);

    const checksummed = await client.call(
      'checksum_apply',
      {
        hexPayload: '0800000000010002aabb',
        zeroOffset: 2,
        writeOffset: 2,
      },
      10_000,
    );
    expect(checksummed.result.status).toBe('PASS');

    const checksummedBody = checksummed.parsed as ChecksumApplyResponse;
    expect(checksummedBody.success).toBe(true);
    expect(checksummedBody.checksumHex).toBe('4d41');
    expect(checksummedBody.mutatedHex).toBe('08004d4100010002aabb');

    const harness = await client.call(
      'crypto_test_harness',
      {
        code: `
function sign(hex) {
  const bytes = Buffer.from(hex, 'hex');
  let acc = 0;
  for (const byte of bytes) {
    acc = (acc + byte) & 0xff;
  }
  return acc.toString(16).padStart(2, '0');
}
        `.trim(),
        functionName: 'sign',
        testInputs: [rebuiltBody.hexPayload, HEX_SAMPLES[2], checksummedBody.mutatedHex],
      },
      15_000,
    );
    expect(harness.result.status).toBe('PASS');

    const harnessBody = harness.parsed as CryptoHarnessResponse;
    expect(harnessBody.allPassed).toBe(true);
    expect(harnessBody.results).toHaveLength(3);
    expect(harnessBody.results[0]).toMatchObject({ input: HEX_SAMPLES[0], output: '2a' });
    expect(harnessBody.results[1]).toMatchObject({ input: HEX_SAMPLES[2], output: '2c' });
    expect(harnessBody.results[2]).toMatchObject({
      input: '08004d4100010002aabb',
      output: 'fe',
    });
  });
});

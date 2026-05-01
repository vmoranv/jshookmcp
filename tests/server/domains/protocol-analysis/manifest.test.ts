import { describe, expect, it } from 'vitest';
import manifest from '@server/domains/protocol-analysis/manifest';

describe('protocol-analysis manifest', () => {
  it('declares stateless compute routing patterns for decode and protocol inference tasks', async () => {
    const sources = manifest.workflowRule?.patterns.map((pattern) => pattern.source) ?? [];
    expect(sources.some((source) => source.includes('decode') && source.includes('protocol'))).toBe(
      true,
    );
    expect(sources.some((source) => source.includes('base64') && source.includes('payload'))).toBe(
      true,
    );
    expect(sources.some((source) => source.includes('无状态') && source.includes('协议'))).toBe(
      true,
    );
  });

  it('includes pure-compute helper tools directly in the workflow sequence', async () => {
    expect(manifest.workflowRule?.tools).toEqual(
      expect.arrayContaining([
        'binary_detect_format',
        'binary_decode',
        'proto_auto_detect',
        'proto_infer_fields',
        'payload_template_build',
        'checksum_apply',
        'crypto_test_harness',
      ]),
    );
  });

  it('declares tool dependencies for sample -> decode -> infer -> harness flow', async () => {
    expect(manifest.toolDependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'network_get_requests',
          to: 'binary_decode',
          relation: 'suggests',
        }),
        expect.objectContaining({
          from: 'binary_decode',
          to: 'proto_auto_detect',
          relation: 'precedes',
        }),
        expect.objectContaining({
          from: 'proto_auto_detect',
          to: 'proto_infer_fields',
          relation: 'precedes',
        }),
        expect.objectContaining({
          from: 'proto_infer_fields',
          to: 'proto_infer_state_machine',
          relation: 'precedes',
        }),
        expect.objectContaining({
          from: 'detect_crypto',
          to: 'crypto_test_harness',
          relation: 'suggests',
        }),
      ]),
    );
  });
});

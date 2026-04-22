import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/evidence/index';
import { evidenceTools } from '@server/domains/evidence/definitions';
import { EvidenceHandlers } from '@server/domains/evidence/handlers';

describe('evidence domain exports', () => {
  it('should export evidenceTools', async () => {
    expect(exports.evidenceTools).toBe(evidenceTools);
  });
  it('should export EvidenceHandlers', async () => {
    expect(exports.EvidenceHandlers).toBe(EvidenceHandlers);
  });
});

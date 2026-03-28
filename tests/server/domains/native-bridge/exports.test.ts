import { describe, expect, it } from 'vitest';
import * as exports from '@server/domains/native-bridge/index';
import { nativeBridgeTools } from '@server/domains/native-bridge/definitions';

describe('native-bridge domain exports', () => {
  it('should export nativeBridgeTools', () => {
    expect(exports.nativeBridgeTools).toBe(nativeBridgeTools);
  });
});

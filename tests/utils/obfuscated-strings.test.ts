import { describe, expect, it } from 'vitest';
import {
  APC,
  DBG,
  DLL,
  FN,
  HFN,
  HEN,
  ICMP,
  NTA,
  NTJ,
  NTM,
  SIG,
  SSB,
  ds,
} from '@utils/obfuscated-strings';

const PRINTABLE_ASCII_RE = /^[\x20-\x7E\r\n\t]*$/;

describe('obfuscated-strings ds()', () => {
  it('decodes the encoded literals', () => {
    expect(ds(DLL.kernel32)).toBe('kernel32.dll');
    expect(ds(DLL.ws2_32)).toBe('ws2_32.dll');
    expect(ds(FN.LoadLibraryA)).toBe('LoadLibraryA');
    expect(ds(SIG.GetLastError)).toBe('uint32 GetLastError()');
  });

  it('keeps already-decoded function names intact on a second decode', () => {
    const decoded = ds(FN.LoadLibraryA);
    expect(decoded).toBe('LoadLibraryA');
    expect(ds(decoded)).toBe('LoadLibraryA');

    const decodedShort = ds(FN.GetModuleHandleA);
    expect(decodedShort).toBe('GetModuleHandleA');
    expect(ds(decodedShort)).toBe('GetModuleHandleA');
  });

  it('passes through plaintext API names that never looked like base64', () => {
    expect(ds('kernel32.dll')).toBe('kernel32.dll');
    expect(ds('uint32 GetLastError()')).toBe('uint32 GetLastError()');
  });

  it('passes through non-canonical base64 instead of returning mojibake', () => {
    expect(ds('abcde')).toBe('abcde');
    expect(ds('not-base64!')).toBe('not-base64!');
    expect(ds('AB==')).toBe('AB==');
  });

  it('decodes every exported literal to printable ASCII', () => {
    const groups = { DLL, FN, SIG, DBG, NTA, NTJ, SSB, NTM, ICMP, HEN, APC, HFN };
    for (const group of Object.values(groups)) {
      for (const encoded of Object.values(group)) {
        const decoded = ds(encoded);
        expect(decoded, `failed to decode ${encoded}`).not.toBe(encoded);
        expect(PRINTABLE_ASCII_RE.test(decoded), `non-printable decode for ${encoded}`).toBe(true);
      }
    }
  });
});

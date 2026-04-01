import { describe, expect, it } from 'vitest';
import { formatAddress, parseAddress } from '@src/native/formatAddress';

describe('formatAddress', () => {
  it('formats bigint addresses with uppercase hex digits', () => {
    expect(formatAddress(0xabcdn)).toBe('0xABCD');
  });
});

describe('parseAddress', () => {
  it('parses lowercase and uppercase 0x-prefixed addresses', () => {
    expect(parseAddress('0x10')).toBe(16n);
    expect(parseAddress('0X10')).toBe(16n);
  });

  it('adds a hex prefix when the input is unprefixed', () => {
    expect(parseAddress('ff')).toBe(255n);
  });
});

import { describe, expect, it } from 'vitest';
import { ResponseBuilder, R } from '@server/domains/shared/ResponseBuilder';

describe('ResponseBuilder', () => {
  describe('fluent api', () => {
    it('should set a value and return this', () => {
      const builder = new ResponseBuilder();
      const returned = builder.set('key', 'value');
      expect(returned).toBe(builder);
      const res = builder.json();
      expect((res.content[0] as { text: string }).text).toContain('"key": "value"');
    });

    it('should build a success response', () => {
      const res = new ResponseBuilder().ok().set('data', 123).json();
      expect(res.isError).toBeUndefined();
      expect((res.content[0] as { text: string }).text).toContain('"success": true');
      expect((res.content[0] as { text: string }).text).toContain('"data": 123');
    });

    it('should build a failure response', () => {
      const res = new ResponseBuilder().fail(new Error('test err')).json();
      expect(res.isError).toBeUndefined();
      expect((res.content[0] as { text: string }).text).toContain('"success": false');
      expect((res.content[0] as { text: string }).text).toContain('"error": "test err"');
    });

    it('should build a failure response from string', () => {
      const res = new ResponseBuilder().fail('test err string').json();
      expect((res.content[0] as { text: string }).text).toContain('"error": "test err string"');
    });

    it('should merge objects', () => {
      const res = new ResponseBuilder().merge({ a: 1, b: 2 }).json();
      expect((res.content[0] as { text: string }).text).toContain('"a": 1');
      expect((res.content[0] as { text: string }).text).toContain('"b": 2');
    });

    it('should set mcpError', () => {
      const res = new ResponseBuilder().mcpError().json();
      expect(res.isError).toBe(true);
    });

    it('raw() should work', () => {
      const res = ResponseBuilder.raw({ rawKey: 'val' });
      expect((res.content[0] as { text: string }).text).toContain('rawKey');
    });

    it('text() should work with default isError', () => {
      const res = ResponseBuilder.text('hello');
      expect((res.content[0] as { text: string }).text).toBe('hello');
      expect(res.isError).toBeUndefined();
    });

    it('text() should work with explicit isError', () => {
      const res = ResponseBuilder.text('hello', true);
      expect((res.content[0] as { text: string }).text).toBe('hello');
      expect(res.isError).toBe(true);
    });
  });

  describe('R shorthand', () => {
    it('ok()', () => {
      const res = R.ok().json();
      expect((res.content[0] as { text: string }).text).toContain('"success": true');
    });

    it('fail()', () => {
      const res = R.fail('err').json();
      expect((res.content[0] as { text: string }).text).toContain('"error": "err"');
    });

    it('raw()', () => {
      const res = R.raw({ x: 1 });
      expect((res.content[0] as { text: string }).text).toContain('"x": 1');
    });

    it('text()', () => {
      const res = R.text('str');
      expect((res.content[0] as { text: string }).text).toBe('str');
      expect(res.isError).toBeUndefined();
    });
  });
});

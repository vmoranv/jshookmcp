import { describe, it, expect } from 'vitest';
import { mapCDPError, wrapCDPCall, isCDPSessionGone } from '@modules/browser/CDPErrorMapper';
import { ToolError } from '@errors/ToolError';

describe('CDPErrorMapper', () => {
  describe('mapCDPError', () => {
    it('maps "Session not found" to CONNECTION ToolError', () => {
      const error = new Error('Session not found');
      const mapped = mapCDPError(error, 'page_evaluate');
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('CONNECTION');
      expect(mapped.message).toContain('Hint:');
    });

    it('maps "Target closed" to CONNECTION ToolError', () => {
      const mapped = mapCDPError(new Error('Target closed'));
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('CONNECTION');
    });

    it('maps "Execution context was destroyed" to RUNTIME ToolError', () => {
      const mapped = mapCDPError(new Error('Execution context was destroyed'));
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('RUNTIME');
    });

    it('maps "Node not found" to NOT_FOUND ToolError', () => {
      const mapped = mapCDPError(new Error('Node with given id not found'));
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('NOT_FOUND');
    });

    it('maps "Navigation timeout" to TIMEOUT ToolError', () => {
      const mapped = mapCDPError(new Error('Navigation timeout of 30000ms exceeded'));
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('TIMEOUT');
    });

    it('maps network errors to CONNECTION ToolError', () => {
      const mapped = mapCDPError(new Error('net::ERR_CONNECTION_REFUSED'));
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('CONNECTION');
    });

    it('maps debugger prerequisite errors', () => {
      const mapped = mapCDPError(new Error('Debugger.enable must be called first'));
      expect(mapped).toBeInstanceOf(ToolError);
      expect((mapped as ToolError).code).toBe('PREREQUISITE');
    });

    it('returns original Error for unrecognized errors', () => {
      const error = new Error('Some random error');
      const mapped = mapCDPError(error);
      expect(mapped).toBe(error);
      expect(mapped).not.toBeInstanceOf(ToolError);
    });

    it('passes through existing ToolError unchanged', () => {
      const toolError = new ToolError('VALIDATION', 'bad input');
      const mapped = mapCDPError(toolError);
      expect(mapped).toBe(toolError);
    });

    it('converts non-Error values to Error', () => {
      const mapped = mapCDPError('string error');
      expect(mapped).toBeInstanceOf(Error);
    });

    it('includes toolName in mapped ToolError', () => {
      const mapped = mapCDPError(new Error('Target closed'), 'page_evaluate') as ToolError;
      expect(mapped.toolName).toBe('page_evaluate');
    });
  });

  describe('wrapCDPCall', () => {
    it('returns result on success', async () => {
      const result = await wrapCDPCall(async () => 42);
      expect(result).toBe(42);
    });

    it('translates errors on failure', async () => {
      await expect(
        wrapCDPCall(async () => { throw new Error('Target closed'); }, 'test_tool')
      ).rejects.toBeInstanceOf(ToolError);
    });
  });

  describe('isCDPSessionGone', () => {
    it('returns true for session errors', () => {
      expect(isCDPSessionGone(new Error('Session not found'))).toBe(true);
      expect(isCDPSessionGone(new Error('Target closed'))).toBe(true);
    });

    it('returns false for other errors', () => {
      expect(isCDPSessionGone(new Error('Something else'))).toBe(false);
    });
  });
});

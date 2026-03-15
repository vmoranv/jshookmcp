import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ToolError } from '@errors/ToolError';
import { PrerequisiteError } from '@errors/PrerequisiteError';

describe('PrerequisiteError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('extends ToolError with the PREREQUISITE code and preserved message', () => {
    const error = new PrerequisiteError('debugger must be enabled first');

    expect(error).toBeInstanceOf(PrerequisiteError);
    expect(error).toBeInstanceOf(ToolError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PrerequisiteError');
    expect(error.message).toBe('debugger must be enabled first');
    expect(error.code).toBe('PREREQUISITE');
    expect(error.toolName).toBeUndefined();
    expect(error.details).toBeUndefined();
  });
});

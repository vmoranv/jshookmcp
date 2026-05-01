import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockBuildHookCode = vi.hoisted(() =>
  vi.fn(

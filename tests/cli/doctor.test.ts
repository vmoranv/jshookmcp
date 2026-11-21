import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  runEnvironmentDoctor: vi.fn(),
  formatEnvironmentDoctorReport: vi.fn(),
  dotenvConfig: vi.fn((): { error?: Error; parsed?: Record<string, string> } => ({
    error: Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
  })),
}));

vi.mock('dotenv', () => ({ config: state.dotenvConfig }));
vi.mock('@server/domains/maintenance/environmentDoctor', () => ({
  runEnvironmentDoctor: state.runEnvironmentDoctor,
  formatEnvironmentDoctorReport: state.formatEnvironmentDoctorReport,
}));

describe('cli/doctor', () => {
  const originalBootstrapSentinel = process.env.DOCTOR_BOOTSTRAP_SENTINEL;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    delete process.env.DOCTOR_BOOTSTRAP_SENTINEL;
  });

  afterEach(() => {
    if (originalBootstrapSentinel === undefined) {
      delete process.env.DOCTOR_BOOTSTRAP_SENTINEL;
    } else {
      process.env.DOCTOR_BOOTSTRAP_SENTINEL = originalBootstrapSentinel;
    }
  });

  it('loads runtime env before running doctor checks', async () => {
    const report = {
      success: true,
      generatedAt: '2026-03-15T00:00:00.000Z',
    };
    state.dotenvConfig.mockImplementationOnce(() => {
      process.env.DOCTOR_BOOTSTRAP_SENTINEL = 'loaded';
      return { parsed: { DOCTOR_BOOTSTRAP_SENTINEL: 'loaded' } };
    });
    state.runEnvironmentDoctor.mockImplementationOnce(async () => {
      expect(process.env.DOCTOR_BOOTSTRAP_SENTINEL).toBe('loaded');
      return report;
    });
    state.formatEnvironmentDoctorReport.mockReturnValue('formatted report');
    vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process, 'exit').mockImplementation((() => undefined) as typeof process.exit);

    await import('@src/cli/doctor');

    expect(state.dotenvConfig.mock.invocationCallOrder[0]).toBeLessThan(
      state.runEnvironmentDoctor.mock.invocationCallOrder[0]!,
    );
  });

  it('runs the doctor with bridge health, prints the formatted report, and exits cleanly', async () => {
    const report = {
      success: true,
      generatedAt: '2026-03-15T00:00:00.000Z',
    };

    state.runEnvironmentDoctor.mockResolvedValue(report);
    state.formatEnvironmentDoctorReport.mockReturnValue('formatted report');

    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      return undefined as never;
    }) as typeof process.exit);

    await import('@src/cli/doctor');

    expect(state.runEnvironmentDoctor).toHaveBeenCalledWith({ includeBridgeHealth: true });
    expect(state.formatEnvironmentDoctorReport).toHaveBeenCalledWith(report);
    expect(stdoutWrite).toHaveBeenCalledWith('formatted report\n');
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('propagates doctor failures without writing output or exiting', async () => {
    const error = new Error('doctor failed');

    state.runEnvironmentDoctor.mockRejectedValue(error);

    const stdoutWrite = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      return undefined as never;
    }) as typeof process.exit);

    await expect(import('@src/cli/doctor')).rejects.toThrow(error);

    expect(state.formatEnvironmentDoctorReport).not.toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});

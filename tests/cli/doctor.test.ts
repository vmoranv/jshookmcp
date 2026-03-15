import { describe, it, expect, vi, beforeEach } from 'vitest';

const state = vi.hoisted(() => ({
  runEnvironmentDoctor: vi.fn(),
  formatEnvironmentDoctorReport: vi.fn(),
}));

vi.mock('@utils/environmentDoctor', () => ({
  runEnvironmentDoctor: state.runEnvironmentDoctor,
  formatEnvironmentDoctorReport: state.formatEnvironmentDoctorReport,
}));

describe('cli/doctor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
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
});

/**
 * Phase 3: trace:calibrate is REPORT-ONLY. It prints observed vs current
 * thresholds side-by-side, never writes thresholds back, never gates, always
 * exits 0. It also refuses to treat fixture data as calibration evidence.
 */
import { describe, expect, it } from 'vitest';
import {
  buildCalibrationRows,
  CALIBRATION_DISCLAIMER,
  DEFAULT_THRESHOLDS_SNAPSHOT,
  calibrationHeader,
} from '../../../scripts/trace-calibrate.mjs';

const combined = {
  repeatedToolCallRate: 0.55,
  orphanFailureCount: 3,
  toolDiversity: 0.09,
  p99CallDurationMs: 12000,
};

describe('buildCalibrationRows (observations only)', () => {
  it('emits metric | observed | threshold | delta for each metric', () => {
    const rows = buildCalibrationRows(combined);
    expect(rows.length).toBe(4);
    expect(rows[0]).toEqual({
      metric: 'repeated_tool_call_rate',
      observed: 0.55,
      threshold: DEFAULT_THRESHOLDS_SNAPSHOT.repeated_tool_call_rate,
      delta: 0.55 - DEFAULT_THRESHOLDS_SNAPSHOT.repeated_tool_call_rate,
    });
  });

  it('uses the current DEFAULT_THRESHOLDS values verbatim (no auto-tune)', () => {
    expect(DEFAULT_THRESHOLDS_SNAPSHOT).toEqual({
      repeated_tool_call_rate: 0.4,
      orphan_failure_count: 10,
      tool_diversity: 0.15,
      p99_call_duration_ms: 30_000,
    });
  });

  it('does NOT mutate its input or the thresholds snapshot', () => {
    const before = JSON.stringify(combined);
    buildCalibrationRows(combined);
    expect(JSON.stringify(combined)).toBe(before);
    expect(DEFAULT_THRESHOLDS_SNAPSHOT.repeated_tool_call_rate).toBe(0.4);
  });
});

describe('calibrationHeader (honesty guard)', () => {
  it('always carries the OBSERVATIONS ONLY disclaimer', () => {
    expect(CALIBRATION_DISCLAIMER).toMatch(/OBSERVATIONS ONLY/i);
    expect(CALIBRATION_DISCLAIMER).toMatch(/not compliance|non-compliance|人工|human/i);
    expect(calibrationHeader('live')).toContain(CALIBRATION_DISCLAIMER);
  });

  it('fixture source: warns it must NOT be used for calibration', () => {
    const header = calibrationHeader('fixture');
    expect(header).toMatch(/FIXTURE|fixture/i);
    expect(header).toMatch(/NOT.*calibrat|不可.*标定/i);
    expect(header).toContain(CALIBRATION_DISCLAIMER);
  });

  it('unknown source: still carries the disclaimer', () => {
    expect(calibrationHeader('unknown')).toContain(CALIBRATION_DISCLAIMER);
  });
});

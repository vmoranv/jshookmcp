export const DEFAULT_THRESHOLDS_SNAPSHOT: Readonly<{
  repeated_tool_call_rate: number;
  orphan_failure_count: number;
  tool_diversity: number;
  p99_call_duration_ms: number;
}>;
export const CALIBRATION_DISCLAIMER: string;
export function calibrationHeader(sourceKind?: string): string;
export interface CalibrationRow {
  metric: string;
  observed: number | null;
  threshold: number;
  delta: number | null;
}
export function buildCalibrationRows(combined?: Record<string, unknown> | null): CalibrationRow[];

export type CapabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface CapabilityEntryOptions {
  capability: string;
  status: CapabilityStatus;
  reason?: string;
  fix?: string;
  details?: Record<string, unknown>;
}

export function capabilityEntry(options: CapabilityEntryOptions): Record<string, unknown> {
  return {
    capability: options.capability,
    status: options.status,
    available: options.status === 'available',
    ...(options.reason ? { reason: options.reason } : {}),
    ...(options.fix ? { fix: options.fix } : {}),
    ...options.details,
  };
}

export function capabilityReport(
  tool: string,
  capabilities: CapabilityEntryOptions[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    success: true,
    tool,
    capabilities: capabilities.map(capabilityEntry),
    ...extra,
  };
}

export function capabilityFailure(
  tool: string,
  capability: string,
  reason: string,
  fix?: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    success: false,
    tool,
    capability,
    status: 'unavailable',
    available: false,
    reason,
    ...(fix ? { fix } : {}),
    ...extra,
  };
}

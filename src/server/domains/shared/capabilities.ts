export type CapabilityStatus = 'available' | 'unavailable' | 'unknown';

export interface CapabilityEntryOptions {
  capability: string;
  status: CapabilityStatus;
  reason?: string;
  fix?: string;
  details?: Record<string, unknown>;
}

function capabilityEntry(options: CapabilityEntryOptions): Record<string, unknown> {
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

/**
 * Unified stub/fallback response format for degraded functionality.
 *
 * Use this when a tool must return placeholder/simulated/limited data
 * due to missing dependencies or unsupported environments.
 *
 * @example
 * // Simulated data
 * return createStub({
 *   tool: 'mojo_monitor',
 *   stubType: 'simulated',
 *   reason: 'Frida hooks not implemented',
 *   fix: 'Install Frida and restart',
 *   data: { messages: simulatedMessages }
 * });
 *
 * @example
 * // Limited functionality
 * return createStub({
 *   tool: 'canvas_scene_dump',
 *   stubType: 'partial',
 *   reason: 'No canvas engine detected',
 *   data: { domMetadata: {...} }
 * });
 */
export function createStub(options: {
  tool: string;
  stubType: 'simulated' | 'partial' | 'placeholder' | 'unavailable';
  reason: string;
  fix?: string;
  data?: Record<string, unknown>;
  warning?: string;
}): Record<string, unknown> {
  const { tool, stubType, reason, fix, data, warning } = options;

  return {
    success: stubType !== 'unavailable',
    tool,
    _stub: stubType,
    stubType, // Keep for backward compatibility
    reason,
    ...(fix ? { fix } : {}),
    ...(warning ? { warning } : {}),
    ...data,
  };
}

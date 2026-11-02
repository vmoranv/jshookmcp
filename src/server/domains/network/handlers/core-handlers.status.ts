import { handleSafe, R } from '@server/domains/shared/ResponseBuilder';
import type { ToolResponse } from '@server/types';
import type { NetworkHandlerDeps } from './shared';
import { parseBooleanArg } from './shared';

export async function handleNetworkMonitor(
  deps: NetworkHandlerDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  const action = String(args['action'] ?? '');
  switch (action) {
    case 'enable':
      return handleNetworkEnable(deps, args);
    case 'disable':
      return handleNetworkDisable(deps, args);
    case 'status':
      return handleNetworkGetStatus(deps, args);
    default:
      return R.fail(
        `Invalid generic action parameter: ${action}. Expected enable, disable, status.`,
      ).json();
  }
}

export async function handleNetworkEnable(
  deps: NetworkHandlerDeps,
  args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    const enableExceptions = parseBooleanArg(args.enableExceptions, true);

    await deps.consoleMonitor.enable({
      enableNetwork: true,
      enableExceptions,
    });

    const status = deps.consoleMonitor.getNetworkStatus();

    return {
      message: ' Network monitoring enabled successfully',
      enabled: status.enabled,
      cdpSessionActive: status.cdpSessionActive,
      listenerCount: status.listenerCount,
      usage: {
        step1: 'Network monitoring is now active',
        step2: 'Navigate to a page using page_navigate tool',
        step3: 'Use network_get_requests to retrieve captured requests',
        step4: 'Use network_get_response_body to get response content',
      },
      important: 'Network monitoring must be enabled BEFORE navigating to capture requests',
    };
  });
}

export async function handleNetworkDisable(
  deps: NetworkHandlerDeps,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  return handleSafe(async () => {
    await deps.consoleMonitor.disable();
    return { message: 'Network monitoring disabled' };
  });
}

/** Shared status-response shape (used by both the composition handlers and the legacy base chain). */
function buildNetworkStatusResponse(status: {
  enabled: boolean;
  requestCount: number;
  responseCount: number;
  listenerCount: number;
  cdpSessionActive: boolean;
}): ToolResponse {
  if (!status.enabled) {
    return R.fail(' Network monitoring is NOT enabled')
      .merge({
        enabled: false,
        nextSteps: {
          step1: 'Call network_enable tool to start monitoring',
          step2: 'Then navigate to a page using page_navigate',
          step3: 'Finally use network_get_requests to see captured requests',
        },
        example: 'network_enable -> page_navigate -> network_get_requests',
      })
      .json();
  }

  return R.ok()
    .merge({
      enabled: true,
      message:
        ` Network monitoring is active. Captured ${status.requestCount} requests and ` +
        `${status.responseCount} ` +
        `responses.`,
      requestCount: status.requestCount,
      responseCount: status.responseCount,
      listenerCount: status.listenerCount,
      cdpSessionActive: status.cdpSessionActive,
      nextSteps:
        status.requestCount === 0
          ? {
              hint: 'No requests captured yet',
              action: 'Navigate to a page using page_navigate to capture network traffic',
            }
          : {
              hint: `${status.requestCount} requests captured`,
              action: 'Use network_get_requests to retrieve them',
            },
    })
    .json();
}

export async function handleNetworkGetStatus(
  deps: NetworkHandlerDeps,
  _args: Record<string, unknown>,
): Promise<ToolResponse> {
  try {
    return buildNetworkStatusResponse(deps.consoleMonitor.getNetworkStatus());
  } catch (error) {
    return R.fail(error).json();
  }
}

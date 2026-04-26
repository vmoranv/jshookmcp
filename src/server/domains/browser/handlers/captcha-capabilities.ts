import { capabilityReport, type CapabilityEntryOptions } from '@server/domains/shared/capabilities';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { CodeCollector } from '@server/domains/shared/modules';

type WidgetHookProbe = {
  url: string;
  callbackCount: number;
};

function getConfiguredProvider(): string {
  return (process.env.CAPTCHA_PROVIDER || '').trim().toLowerCase() || 'manual';
}

function getConfiguredBaseUrl(): string {
  return (
    process.env.CAPTCHA_SOLVER_BASE_URL?.trim() ||
    process.env.CAPTCHA_2CAPTCHA_BASE_URL?.trim() ||
    ''
  );
}

function getTwoCaptchaCapability(): CapabilityEntryOptions {
  const configuredProvider = getConfiguredProvider();
  const baseUrl = getConfiguredBaseUrl();
  const apiKeyConfigured = Boolean(process.env.CAPTCHA_API_KEY?.trim());
  const baseUrlConfigured = baseUrl.length > 0;
  const available = apiKeyConfigured && baseUrlConfigured;

  return {
    capability: 'captcha_external_service_2captcha',
    status: available ? 'available' : 'unavailable',
    reason: available
      ? undefined
      : 'The 2captcha-compatible external path needs both CAPTCHA_API_KEY and CAPTCHA_SOLVER_BASE_URL.',
    fix: available
      ? undefined
      : 'Set CAPTCHA_API_KEY and CAPTCHA_SOLVER_BASE_URL to enable external_service mode.',
    details: {
      tools: ['captcha_vision_solve', 'widget_challenge_solve'],
      configuredProvider,
      defaultExternalProviderSupported: configuredProvider === '2captcha',
      apiKeyConfigured,
      baseUrlConfigured,
      ...(baseUrlConfigured ? { baseUrl } : {}),
    },
  };
}

async function getWidgetHookCapability(collector: CodeCollector): Promise<CapabilityEntryOptions> {
  let page;
  try {
    page = await collector.getActivePage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      capability: 'captcha_widget_hook_current_page',
      status: 'unknown',
      reason: `Current page probe failed: ${message}`,
      fix: 'Attach or launch a browser page before using hook mode.',
      details: {
        tools: ['widget_challenge_solve'],
        pageAttached: false,
      },
    };
  }

  if (!page) {
    return {
      capability: 'captcha_widget_hook_current_page',
      status: 'unknown',
      reason: 'No active page is attached.',
      fix: 'Attach or launch a browser page before using hook mode.',
      details: {
        tools: ['widget_challenge_solve'],
        pageAttached: false,
      },
    };
  }

  try {
    const probe = (await page.evaluate(() => {
      const callbacksRaw = (window as unknown as { __turnstile_callbacks?: unknown })
        .__turnstile_callbacks;
      const callbackCount =
        callbacksRaw && typeof callbacksRaw === 'object' && !Array.isArray(callbacksRaw)
          ? Object.keys(callbacksRaw as Record<string, unknown>).length
          : 0;

      return {
        url: location.href,
        callbackCount,
      } satisfies WidgetHookProbe;
    })) as WidgetHookProbe;

    return {
      capability: 'captcha_widget_hook_current_page',
      status: probe.callbackCount > 0 ? 'available' : 'unavailable',
      reason:
        probe.callbackCount > 0
          ? undefined
          : 'The current page does not expose window.__turnstile_callbacks for hook mode.',
      fix:
        probe.callbackCount > 0
          ? undefined
          : 'Use manual mode, or configure the external 2captcha-compatible service for widget solving.',
      details: {
        tools: ['widget_challenge_solve'],
        pageAttached: true,
        ...probe,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      capability: 'captcha_widget_hook_current_page',
      status: 'unknown',
      reason: `Current page probe failed: ${message}`,
      fix: 'Ensure the attached page is reachable before using hook mode.',
      details: {
        tools: ['widget_challenge_solve'],
        pageAttached: true,
      },
    };
  }
}

export async function handleCaptchaSolverCapabilities(
  collector: CodeCollector,
): Promise<ToolResponse> {
  const configuredProvider = getConfiguredProvider();
  const widgetHookCapability = await getWidgetHookCapability(collector);

  return R.raw(
    capabilityReport(
      'captcha_solver_capabilities',
      [
        {
          capability: 'captcha_manual',
          status: 'available',
          details: {
            tools: ['captcha_vision_solve', 'widget_challenge_solve'],
          },
        },
        getTwoCaptchaCapability(),
        {
          capability: 'captcha_external_service_anticaptcha',
          status: 'unavailable',
          reason: 'AntiCaptcha integration is not implemented in this build.',
          fix: 'Use manual mode or the configured 2captcha-compatible service instead.',
          details: {
            tools: ['captcha_vision_solve', 'widget_challenge_solve'],
            configuredProvider,
          },
        },
        {
          capability: 'captcha_external_service_capsolver',
          status: 'unavailable',
          reason: 'CapSolver integration is not implemented in this build.',
          fix: 'Use manual mode or the configured 2captcha-compatible service instead.',
          details: {
            tools: ['captcha_vision_solve', 'widget_challenge_solve'],
            configuredProvider,
          },
        },
        widgetHookCapability,
      ],
      {
        configuredProvider,
      },
    ),
  );
}

/**
 * CAPTCHA solving handlers.
 *
 * Provider-agnostic interface for external solving services and
 * embedded widget challenge helpers.
 */
import type { CodeCollector } from '@server/domains/shared/modules';
import { logger } from '@utils/logger';
import {
  CAPTCHA_SOLVER_BASE_URL,
  CAPTCHA_SUBMIT_TIMEOUT_MS,
  CAPTCHA_POLL_INTERVAL_MS,
  CAPTCHA_RESULT_TIMEOUT_MS,
  CAPTCHA_DEFAULT_TIMEOUT_MS,
  CAPTCHA_MIN_TIMEOUT_MS,
  CAPTCHA_MAX_TIMEOUT_MS,
  CAPTCHA_MAX_RETRIES,
  CAPTCHA_DEFAULT_RETRIES,
} from '@src/constants';

/* ---------- Helpers ---------- */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toTextResponse(payload: Record<string, unknown>) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

function toErrorResponse(tool: string, error: unknown, extra: Record<string, unknown> = {}) {
  return toTextResponse({
    success: false,
    tool,
    error: error instanceof Error ? error.message : String(error),
    ...extra,
  });
}

/* ---------- Provider interface ---------- */

interface SolveResult {
  token: string;
  challengeType: 'image' | 'widget';
  confidence?: number;
  mode: 'external_service';
  durationMs: number;
}

type PublicChallengeType = 'auto' | 'image' | 'widget' | 'browser_check';
type SolverTaskKind = 'image' | 'recaptcha_v2' | 'hcaptcha' | 'turnstile';
type SolverMode = 'manual' | 'hook' | 'external_service';

function normalizeSolverMode(rawMode: unknown): SolverMode {
  const value = typeof rawMode === 'string' ? rawMode.toLowerCase() : '';
  if (value === 'hook') return 'hook';
  if (value === 'external_service') return 'external_service';
  if (value === '2captcha' || value === 'anticaptcha' || value === 'capsolver') {
    return 'external_service';
  }
  return 'manual';
}

function normalizeChallengeTypeHint(rawType: unknown): PublicChallengeType {
  const value = typeof rawType === 'string' ? rawType.toLowerCase() : '';
  if (value === 'image') return 'image';
  if (
    value === 'widget' ||
    value === 'recaptcha_v2' ||
    value === 'recaptcha_v3' ||
    value === 'hcaptcha' ||
    value === 'funcaptcha' ||
    value === 'turnstile'
  ) {
    return 'widget';
  }
  if (value === 'browser_check' || value === 'managed_widget') {
    return 'browser_check';
  }
  return 'auto';
}

function resolveLegacyServiceOverride(rawProvider: unknown): string | undefined {
  if (typeof rawProvider !== 'string' || !rawProvider.trim()) {
    return undefined;
  }
  return rawProvider.trim().toLowerCase();
}

function resolveExternalServiceName(args: Record<string, unknown>): string {
  const legacyOverride = resolveLegacyServiceOverride(args.provider);
  const configured = (process.env.CAPTCHA_PROVIDER || '').trim().toLowerCase();
  return legacyOverride || configured || '2captcha';
}

async function solveWith2Captcha(
  apiKey: string,
  params: {
    taskKind: SolverTaskKind;
    siteKey?: string;
    pageUrl?: string;
    imageBase64?: string;
  },
  timeoutMs: number,
): Promise<SolveResult> {
  const start = Date.now();
  const baseUrl = CAPTCHA_SOLVER_BASE_URL;

  if (!baseUrl) {
    throw new Error(
      'CAPTCHA_SOLVER_BASE_URL must be configured before using external_service mode.'
    );
  }

  // Submit task
  const submitBody: Record<string, unknown> = {
    key: apiKey,
    json: 1,
  };

  if (
    params.taskKind === 'turnstile' ||
    params.taskKind === 'recaptcha_v2' ||
    params.taskKind === 'hcaptcha'
  ) {
    submitBody.method =
      params.taskKind === 'turnstile'
        ? 'turnstile'
        : params.taskKind === 'hcaptcha'
          ? 'hcaptcha'
          : 'userrecaptcha';
    submitBody.sitekey = params.siteKey;
    submitBody.pageurl = params.pageUrl;
  } else {
    submitBody.method = 'base64';
    submitBody.body = params.imageBase64;
  }

  const submitRes = await fetch(`${baseUrl}/in.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(submitBody),
    signal: AbortSignal.timeout(CAPTCHA_SUBMIT_TIMEOUT_MS),
  });
  const submitData = await submitRes.json() as Record<string, unknown>;

  if (submitData.status !== 1) {
    throw new Error(`2captcha submit failed: ${JSON.stringify(submitData)}`);
  }

  const taskId = submitData.request as string;

  // Poll with bounded dynamic sleep to avoid timeout drift while reducing request pressure.
  const pollInterval = CAPTCHA_POLL_INTERVAL_MS;
  while (true) {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(pollInterval, remaining));

    // Check again after sleep
    if (Date.now() - start >= timeoutMs) break;

    const resultUrl = new URL(`${baseUrl}/res.php`);
    resultUrl.searchParams.set('key', apiKey);
    resultUrl.searchParams.set('action', 'get');
    resultUrl.searchParams.set('id', taskId);
    resultUrl.searchParams.set('json', '1');
    const resultRes = await fetch(resultUrl.toString(), {
      signal: AbortSignal.timeout(CAPTCHA_RESULT_TIMEOUT_MS),
    });
    const resultData = await resultRes.json() as Record<string, unknown>;

    if (resultData.status === 1) {
      return {
        token: resultData.request as string,
        challengeType: params.taskKind === 'image' ? 'image' : 'widget',
        mode: 'external_service',
        durationMs: Date.now() - start,
      };
    }

    if (resultData.request !== 'CAPCHA_NOT_READY') {
      throw new Error(`2captcha solve failed: ${JSON.stringify(resultData)}`);
    }
  }

  throw new Error(`2captcha solve timeout after ${timeoutMs}ms`);
}

/* ---------- Exported handlers ---------- */

export async function handleCaptchaVisionSolve(
  args: Record<string, unknown>,
  collector: CodeCollector,
): Promise<unknown> {
  const page = await collector.getActivePage();
  if (!page) throw new Error('No active page.');

  const mode = normalizeSolverMode(args.mode ?? args.provider ?? process.env.CAPTCHA_PROVIDER);
  const externalService = resolveExternalServiceName(args);
  const apiKey = (args.apiKey as string) || process.env.CAPTCHA_API_KEY || '';
  const challengeTypeHint = normalizeChallengeTypeHint(args.challengeType ?? args.typeHint);
  const timeoutMs = Math.min(Math.max((args.timeoutMs as number) ?? CAPTCHA_DEFAULT_TIMEOUT_MS, CAPTCHA_MIN_TIMEOUT_MS), CAPTCHA_MAX_TIMEOUT_MS);
  const maxRetries = Math.min(Math.max((args.maxRetries as number) ?? CAPTCHA_DEFAULT_RETRIES, 0), CAPTCHA_MAX_RETRIES);

  // Auto-detect challenge type if needed
  let challengeType = challengeTypeHint;
  let taskKind: SolverTaskKind = challengeTypeHint === 'image' ? 'image' : 'recaptcha_v2';
  let siteKey = args.siteKey as string | undefined;
  const pageUrl = (args.pageUrl as string) || page.url();

  if (challengeType === 'auto') {
    const detected = await page.evaluate(() => {
      // Check for known CAPTCHA widgets
      if (document.querySelector('[data-sitekey]')) {
        const el = document.querySelector('[data-sitekey]') as HTMLElement;
        const sk = el?.getAttribute('data-sitekey') || '';
        if (document.querySelector('.cf-turnstile')) {
          return { challengeType: 'widget', taskKind: 'turnstile', siteKey: sk };
        }
        if (document.querySelector('.h-captcha')) {
          return { challengeType: 'widget', taskKind: 'hcaptcha', siteKey: sk };
        }
        return { challengeType: 'widget', taskKind: 'recaptcha_v2', siteKey: sk };
      }
      if (document.querySelector('iframe[src*="recaptcha"]')) {
        return { challengeType: 'widget', taskKind: 'recaptcha_v2', siteKey: '' };
      }
      if (document.querySelector('iframe[src*="hcaptcha"]')) {
        return { challengeType: 'widget', taskKind: 'hcaptcha', siteKey: '' };
      }
      if (document.querySelector('.cf-turnstile')) {
        return { challengeType: 'widget', taskKind: 'turnstile', siteKey: '' };
      }
      return { challengeType: 'image', taskKind: 'image', siteKey: '' };
    });
    challengeType = detected.challengeType as PublicChallengeType;
    taskKind = detected.taskKind as SolverTaskKind;
    if (!siteKey && detected.siteKey) siteKey = detected.siteKey;
  } else if (challengeType === 'image') {
    taskKind = 'image';
  } else {
    taskKind = 'recaptcha_v2';
  }

  if (mode === 'manual') {
    return toTextResponse({
      success: true,
      mode: 'manual',
      challengeType,
      siteKey: siteKey ?? null,
      instruction: 'Please solve the CAPTCHA manually in the browser, then continue.',
      hint: 'Configure an external solver service and CAPTCHA_API_KEY to automate this flow.',
    });
  }

  // External provider solving
  if (!apiKey) {
    return toErrorResponse(
      'captcha_vision_solve',
      new Error('External solver credentials are required. Set CAPTCHA_API_KEY.')
    );
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result: SolveResult;

      if (externalService === '2captcha') {
        result = await solveWith2Captcha(apiKey, {
          taskKind,
          siteKey,
          pageUrl,
        }, timeoutMs);
      } else if (externalService === 'anticaptcha' || externalService === 'capsolver') {
        // These providers are not yet implemented — reject to prevent
        // accidentally routing unsupported provider credentials to 2captcha.
        throw new Error(
          'The selected external solver service is not yet implemented. ' +
          'Currently only the configured primary service and manual mode are supported.',
        );
      } else {
        throw new Error('Unsupported external solver service.');
      }

      return toTextResponse({
        success: true,
        token: result.token,
        challengeType: result.challengeType,
        mode: result.mode,
        durationMs: result.durationMs,
        attempt: attempt + 1,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[captcha] Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  return toErrorResponse('captcha_vision_solve', lastError ?? new Error('All attempts failed'), {
    challengeType,
    mode,
    maxRetries,
    suggestion: 'Try manual mode or adjust the external solver configuration.',
  });
}

export async function handleWidgetChallengeSolve(
  args: Record<string, unknown>,
  collector: CodeCollector,
): Promise<unknown> {
  const page = await collector.getActivePage();
  if (!page) throw new Error('No active page.');

  const mode = normalizeSolverMode(args.mode ?? args.provider ?? process.env.CAPTCHA_PROVIDER);
  const externalService = resolveExternalServiceName(args);
  const apiKey = (args.apiKey as string) || process.env.CAPTCHA_API_KEY || '';
  const timeoutMs = Math.min(Math.max((args.timeoutMs as number) ?? 120_000, 5_000), 600_000);
  const injectToken = (args.injectToken as boolean) ?? true;

  // Auto-detect siteKey and pageUrl
  let siteKey = args.siteKey as string | undefined;
  const pageUrl = (args.pageUrl as string) || page.url();

  if (!siteKey) {
    siteKey = await page.evaluate(() => {
      const el = document.querySelector('.cf-turnstile[data-sitekey], [data-sitekey]') as HTMLElement;
      return el?.getAttribute('data-sitekey') ?? '';
    }) || undefined;
  }

  if (!siteKey) {
    return toErrorResponse('widget_challenge_solve', new Error(
      'Could not detect the widget siteKey. Provide it manually or ensure the page exposes a site key.',
    ));
  }

  if (mode === 'hook') {
    // Try to hook the page callback to intercept the challenge token
    // Bound hook wait time to 30s to avoid unbounded waits in page context.
    const hookTimeoutMs = Math.min(timeoutMs, 30_000);
    const token = await page.evaluate((hookTimeout: number) => {
      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Hook timeout')), hookTimeout);
        // Attempt to intercept the widget callback
        const origCallbacks = (window as unknown as Record<string, unknown>).__turnstile_callbacks as Record<string, Function> | undefined;
        if (origCallbacks) {
          for (const [key, cb] of Object.entries(origCallbacks)) {
            (origCallbacks as Record<string, Function>)[key] = (token: string) => {
              clearTimeout(timeout);
              resolve(token);
              cb(token);
            };
          }
        } else {
          clearTimeout(timeout);
          reject(new Error('No widget callbacks found. Try external_service mode instead.'));
        }
      });
    }, hookTimeoutMs).catch(() => null);

    if (token) {
      return toTextResponse({
        success: true,
        token,
        method: 'hook',
        challengeType: 'widget',
        siteKey,
      });
    }
  }

  if (mode === 'manual') {
    return toTextResponse({
      success: true,
      mode: 'manual',
      challengeType: 'widget',
      siteKey,
      pageUrl,
      instruction: 'Please complete the widget challenge manually.',
    });
  }

  // External solver: only allow services implemented for this widget flow.
  if (externalService !== '2captcha') {
    return toErrorResponse('widget_challenge_solve', new Error(
      'The selected external solver service is not implemented for this widget flow. ' +
      'Currently only the configured primary service, manual mode, and hook mode are supported.',
    ));
  }

  if (!apiKey) {
    return toErrorResponse('widget_challenge_solve', new Error('External solver credentials are required.'));
  }

  try {
    const result = await solveWith2Captcha(apiKey, {
      taskKind: 'turnstile',
      siteKey,
      pageUrl,
    }, timeoutMs);

    // Inject token if requested
    if (injectToken && result.token) {
      await page.evaluate((token: string) => {
        // Find the widget response input and set it
        const inputs = document.querySelectorAll('input[name*="turnstile"], input[name*="cf-turnstile"]');
        inputs.forEach((input) => {
          (input as HTMLInputElement).value = token;
        });

        // Try to trigger the callback
        const cfTurnstile = (window as unknown as Record<string, unknown>).turnstile as Record<string, Function> | undefined;
        if (cfTurnstile?.getResponse) {
          // Widget API available
        }
      }, result.token);
    }

      return toTextResponse({
        success: true,
        token: result.token,
        challengeType: result.challengeType,
        siteKey,
        mode: result.mode,
        durationMs: result.durationMs,
        injected: injectToken,
      });
  } catch (error) {
      return toErrorResponse('widget_challenge_solve', error, {
        siteKey,
        mode,
        suggestion: 'Try manual mode or hook mode.',
      });
    }
}

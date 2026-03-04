/**
 * CAPTCHA solving handlers.
 *
 * Provider-agnostic interface for external solving services and
 * Cloudflare Turnstile-specific solver.
 */
import type { CodeCollector } from '../../../../modules/collector/CodeCollector.js';
import { logger } from '../../../../utils/logger.js';

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
  type: string;
  confidence?: number;
  provider: string;
  durationMs: number;
}

async function solveWith2Captcha(
  apiKey: string,
  params: {
    type: string;
    siteKey?: string;
    pageUrl?: string;
    imageBase64?: string;
  },
  timeoutMs: number,
): Promise<SolveResult> {
  const start = Date.now();
  const baseUrl = 'https://2captcha.com';

  // Submit task
  const submitBody: Record<string, unknown> = {
    key: apiKey,
    json: 1,
  };

  if (params.type === 'turnstile' || params.type === 'recaptcha_v2' || params.type === 'hcaptcha') {
    submitBody.method = params.type === 'turnstile' ? 'turnstile' : params.type === 'hcaptcha' ? 'hcaptcha' : 'userrecaptcha';
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
    signal: AbortSignal.timeout(15_000),
  });
  const submitData = await submitRes.json() as Record<string, unknown>;

  if (submitData.status !== 1) {
    throw new Error(`2captcha submit failed: ${JSON.stringify(submitData)}`);
  }

  const taskId = submitData.request as string;

  // Poll with bounded dynamic sleep to avoid timeout drift while reducing request pressure.
  const pollInterval = 5_000;
  while (true) {
    const remaining = timeoutMs - (Date.now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(pollInterval, remaining));

    // Check again after sleep
    if (Date.now() - start >= timeoutMs) break;

    const resultRes = await fetch(
      `${baseUrl}/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`,
      { signal: AbortSignal.timeout(10_000) },
    );
    const resultData = await resultRes.json() as Record<string, unknown>;

    if (resultData.status === 1) {
      return {
        token: resultData.request as string,
        type: params.type,
        provider: '2captcha',
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

  const provider = (args.provider as string) || process.env.CAPTCHA_PROVIDER || 'manual';
  const apiKey = (args.apiKey as string) || process.env.CAPTCHA_API_KEY || '';
  const typeHint = (args.typeHint as string) || 'auto';
  const timeoutMs = Math.min(Math.max((args.timeoutMs as number) ?? 180_000, 5_000), 600_000);
  const maxRetries = Math.min(Math.max((args.maxRetries as number) ?? 2, 0), 5);

  // Auto-detect CAPTCHA type if needed
  let captchaType = typeHint;
  let siteKey = args.siteKey as string | undefined;
  const pageUrl = (args.pageUrl as string) || page.url();

  if (captchaType === 'auto') {
    const detected = await page.evaluate(() => {
      // Check for known CAPTCHA widgets
      if (document.querySelector('[data-sitekey]')) {
        const el = document.querySelector('[data-sitekey]') as HTMLElement;
        const sk = el?.getAttribute('data-sitekey') || '';
        if (document.querySelector('.cf-turnstile')) return { type: 'turnstile', siteKey: sk };
        if (document.querySelector('.h-captcha')) return { type: 'hcaptcha', siteKey: sk };
        return { type: 'recaptcha_v2', siteKey: sk };
      }
      if (document.querySelector('iframe[src*="recaptcha"]')) return { type: 'recaptcha_v2', siteKey: '' };
      if (document.querySelector('iframe[src*="hcaptcha"]')) return { type: 'hcaptcha', siteKey: '' };
      if (document.querySelector('.cf-turnstile')) return { type: 'turnstile', siteKey: '' };
      return { type: 'image', siteKey: '' };
    });
    captchaType = detected.type;
    if (!siteKey && detected.siteKey) siteKey = detected.siteKey;
  }

  if (provider === 'manual') {
    return toTextResponse({
      success: true,
      mode: 'manual',
      captchaType,
      siteKey: siteKey ?? null,
      instruction: 'Please solve the CAPTCHA manually in the browser, then continue.',
      hint: 'Set CAPTCHA_PROVIDER and CAPTCHA_API_KEY env vars for automatic solving.',
    });
  }

  // External provider solving
  if (!apiKey) {
    return toErrorResponse('captcha_vision_solve', new Error(
      `API key required for provider "${provider}". Set CAPTCHA_API_KEY env var.`,
    ));
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      let result: SolveResult;

      if (provider === '2captcha') {
        result = await solveWith2Captcha(apiKey, {
          type: captchaType,
          siteKey,
          pageUrl,
        }, timeoutMs);
      } else if (provider === 'anticaptcha' || provider === 'capsolver') {
        // These providers are not yet implemented — reject to prevent
        // accidentally routing unsupported provider credentials to 2captcha.
        throw new Error(
          `Provider "${provider}" is not yet implemented. ` +
          `Currently only "2captcha" and "manual" are supported.`,
        );
      } else {
        throw new Error(`Unsupported provider: ${provider}`);
      }

      return toTextResponse({
        success: true,
        token: result.token,
        captchaType: result.type,
        provider: result.provider,
        durationMs: result.durationMs,
        attempt: attempt + 1,
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(`[captcha] Attempt ${attempt + 1} failed: ${lastError.message}`);
    }
  }

  return toErrorResponse('captcha_vision_solve', lastError ?? new Error('All attempts failed'), {
    captchaType,
    provider,
    maxRetries,
    suggestion: 'Try a different provider or solve manually.',
  });
}

export async function handleTurnstileSolve(
  args: Record<string, unknown>,
  collector: CodeCollector,
): Promise<unknown> {
  const page = await collector.getActivePage();
  if (!page) throw new Error('No active page.');

  const provider = (args.provider as string) || process.env.CAPTCHA_PROVIDER || 'manual';
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
    return toErrorResponse('turnstile_solve', new Error(
      'Could not detect Turnstile siteKey. Provide it manually or ensure the page has a Turnstile widget.',
    ));
  }

  if (provider === 'hook') {
    // Try to hook window.turnstile to intercept token
    // Bound hook wait time to 30s to avoid unbounded waits in page context.
    const hookTimeoutMs = Math.min(timeoutMs, 30_000);
    const token = await page.evaluate((hookTimeout: number) => {
      return new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Hook timeout')), hookTimeout);
        // Attempt to intercept turnstile callback
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
          reject(new Error('No turnstile callbacks found. Try provider: "2captcha" instead.'));
        }
      });
    }, hookTimeoutMs).catch(() => null);

    if (token) {
      return toTextResponse({
        success: true,
        token,
        method: 'hook',
        siteKey,
      });
    }
  }

  if (provider === 'manual') {
    return toTextResponse({
      success: true,
      mode: 'manual',
      siteKey,
      pageUrl,
      instruction: 'Please complete the Turnstile challenge manually.',
    });
  }

  // External solver: only allow providers implemented for Turnstile.
  if (provider !== '2captcha') {
    return toErrorResponse('turnstile_solve', new Error(
      `Provider "${provider}" is not yet implemented for Turnstile. ` +
      `Currently only "2captcha", "manual", and "hook" are supported.`,
    ));
  }

  if (!apiKey) {
    return toErrorResponse('turnstile_solve', new Error('API key required'));
  }

  try {
    const result = await solveWith2Captcha(apiKey, {
      type: 'turnstile',
      siteKey,
      pageUrl,
    }, timeoutMs);

    // Inject token if requested
    if (injectToken && result.token) {
      await page.evaluate((token: string) => {
        // Find the turnstile response input and set it
        const inputs = document.querySelectorAll('input[name*="turnstile"], input[name*="cf-turnstile"]');
        inputs.forEach((input) => {
          (input as HTMLInputElement).value = token;
        });

        // Try to trigger the callback
        const cfTurnstile = (window as unknown as Record<string, unknown>).turnstile as Record<string, Function> | undefined;
        if (cfTurnstile?.getResponse) {
          // Turnstile API available
        }
      }, result.token);
    }

    return toTextResponse({
      success: true,
      token: result.token,
      siteKey,
      provider: result.provider,
      durationMs: result.durationMs,
      injected: injectToken,
    });
  } catch (error) {
    return toErrorResponse('turnstile_solve', error, {
      siteKey,
      provider,
      suggestion: 'Try provider: "manual" or provider: "hook".',
    });
  }
}

/**
 * CAPTCHA solving handlers.
 *
 * Provider-agnostic interface for external solving services and
 * embedded widget challenge helpers.
 */
import type { CodeCollector } from '@server/domains/shared/modules/collector';
import { argString, argNumber, argBool } from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';
import { fetchWithTimeout } from '@utils/network/fetch';
import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import type { ElicitationBridge } from '@server/ElicitationBridge';
import type {
  ElicitRequestFormParams,
  PrimitiveSchemaDefinition,
} from '@modelcontextprotocol/server';
import { readEnvNullableString, readEnvString } from '@src/config/environment';
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
  CAPTCHA_HOOK_TIMEOUT_MAX_MS,
} from '@src/constants';

// ── Helpers ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Provider interface ──

interface SolveResult {
  token: string;
  challengeType: 'image' | 'widget';
  confidence?: number;
  mode: 'external_service';
  durationMs: number;
}

type PublicChallengeType = 'image' | 'widget' | 'browser_check';
type SolverTaskKind =
  | 'image'
  | 'recaptcha_v2'
  | 'recaptcha_v3'
  | 'hcaptcha'
  | 'funcaptcha'
  | 'turnstile';
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
  return 'image';
}

function normalizeTaskKind(rawTaskKind: unknown): SolverTaskKind | undefined {
  const value = typeof rawTaskKind === 'string' ? rawTaskKind.toLowerCase() : '';
  if (
    value === 'image' ||
    value === 'recaptcha_v2' ||
    value === 'recaptcha_v3' ||
    value === 'hcaptcha' ||
    value === 'funcaptcha' ||
    value === 'turnstile'
  ) {
    return value;
  }
  return undefined;
}

function resolveTaskKind(rawTaskKind: unknown, challengeType: PublicChallengeType): SolverTaskKind {
  const explicitTaskKind = normalizeTaskKind(rawTaskKind);
  if (explicitTaskKind) {
    return explicitTaskKind;
  }
  if (challengeType === 'image') {
    return 'image';
  }
  return 'recaptcha_v2';
}

function requiresWidgetContext(taskKind: SolverTaskKind): boolean {
  return taskKind !== 'image';
}

function resolveLegacyServiceOverride(rawProvider: unknown): string | undefined {
  if (typeof rawProvider !== 'string' || !rawProvider.trim()) {
    return undefined;
  }
  return rawProvider.trim().toLowerCase();
}

function resolveExternalServiceName(args: Record<string, unknown>): string {
  const legacyOverride = resolveLegacyServiceOverride(args.provider);
  const configured = readEnvString('CAPTCHA_PROVIDER', '', { trim: true }).toLowerCase();
  return legacyOverride || configured || '2captcha';
}

function getSolverBaseUrl(service: string): string {
  if (service === '2captcha') {
    return (
      readEnvNullableString('CAPTCHA_SOLVER_BASE_URL', { trim: true }) ||
      readEnvNullableString('CAPTCHA_2CAPTCHA_BASE_URL', { trim: true }) ||
      CAPTCHA_SOLVER_BASE_URL
    );
  }
  if (service === 'anticaptcha') {
    return readEnvNullableString('CAPTCHA_ANTICAPTCHA_BASE_URL', { trim: true }) || '';
  }
  if (service === 'capsolver') {
    return readEnvNullableString('CAPTCHA_CAPSOLVER_BASE_URL', { trim: true }) || '';
  }
  return '';
}

function mapProviderTaskKind(service: string, taskKind: SolverTaskKind): string {
  if (service === 'anticaptcha') {
    if (taskKind === 'recaptcha_v2') return 'RecaptchaV2TaskProxyless';
    if (taskKind === 'recaptcha_v3') return 'RecaptchaV3TaskProxyless';
    if (taskKind === 'hcaptcha') return 'HCaptchaTaskProxyless';
    if (taskKind === 'funcaptcha') return 'FunCaptchaTaskProxyless';
    if (taskKind === 'turnstile') return 'TurnstileTaskProxyless';
    return 'ImageToTextTask';
  }
  if (service === 'capsolver') {
    if (taskKind === 'recaptcha_v2') return 'ReCaptchaV2TaskProxyLess';
    if (taskKind === 'recaptcha_v3') return 'ReCaptchaV3TaskProxyLess';
    if (taskKind === 'hcaptcha') return 'HCaptchaTaskProxyLess';
    if (taskKind === 'funcaptcha') return 'FunCaptchaTaskProxyLess';
    if (taskKind === 'turnstile') return 'AntiTurnstileTaskProxyLess';
    return 'ImageToTextTask';
  }
  return '';
}

async function solveWithJsonTaskApi(
  service: 'anticaptcha' | 'capsolver',
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
  const baseUrl = getSolverBaseUrl(service);
  if (!baseUrl) {
    throw new Error(`${service} base URL is not configured.`);
  }

  const taskType = mapProviderTaskKind(service, params.taskKind);
  const task: Record<string, unknown> =
    params.taskKind === 'image'
      ? {
          type: taskType,
          body: params.imageBase64,
        }
      : {
          type: taskType,
          websiteURL: params.pageUrl,
          websiteKey: params.siteKey,
        };

  const createRes = await fetchWithTimeout(
    `${baseUrl}/createTask`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task,
      }),
    },
    CAPTCHA_SUBMIT_TIMEOUT_MS,
  );
  const createData = (await createRes.json()) as Record<string, unknown>;
  if ((createData.errorId as number | undefined) && createData.errorId !== 0) {
    throw new Error(
      `${service} createTask failed: ${String(createData.errorCode ?? createData.errorDescription ?? JSON.stringify(createData))}`,
    );
  }

  const taskId = createData.taskId;
  if (typeof taskId !== 'number' && typeof taskId !== 'string') {
    throw new Error(`${service} createTask did not return a taskId.`);
  }

  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) break;
    await sleep(Math.min(CAPTCHA_POLL_INTERVAL_MS, timeoutMs - elapsed));

    const resultRes = await fetchWithTimeout(
      `${baseUrl}/getTaskResult`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientKey: apiKey,
          taskId,
        }),
      },
      CAPTCHA_RESULT_TIMEOUT_MS,
    );
    const resultData = (await resultRes.json()) as Record<string, unknown>;
    if ((resultData.errorId as number | undefined) && resultData.errorId !== 0) {
      throw new Error(
        `${service} getTaskResult failed: ${String(resultData.errorCode ?? resultData.errorDescription ?? JSON.stringify(resultData))}`,
      );
    }
    if (resultData.status === 'processing' || resultData.status === 'idle') {
      continue;
    }
    if (resultData.status !== 'ready') {
      throw new Error(`${service} returned unexpected status: ${String(resultData.status)}`);
    }

    const solution =
      typeof resultData.solution === 'object' && resultData.solution !== null
        ? (resultData.solution as Record<string, unknown>)
        : null;
    const token =
      typeof solution?.['gRecaptchaResponse'] === 'string'
        ? (solution['gRecaptchaResponse'] as string)
        : typeof solution?.['token'] === 'string'
          ? (solution['token'] as string)
          : typeof solution?.['text'] === 'string'
            ? (solution['text'] as string)
            : '';
    if (!token) {
      throw new Error(`${service} returned ready without a usable solution token.`);
    }

    return {
      token,
      challengeType: params.taskKind === 'image' ? 'image' : 'widget',
      mode: 'external_service',
      durationMs: Date.now() - start,
    };
  }

  throw new Error(`${service} solve timeout after ${timeoutMs}ms`);
}

async function captureCaptchaImageBase64(page: {
  screenshot?: (options?: Record<string, unknown>) => Promise<Buffer>;
}): Promise<string> {
  if (typeof page.screenshot === 'function') {
    const buffer = await page.screenshot({ type: 'png' });
    return buffer.toString('base64');
  }

  throw new Error('Could not capture image CAPTCHA payload from the current page.');
}

function normalizeBase64Payload(rawValue: unknown): string | undefined {
  if (typeof rawValue !== 'string') {
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.startsWith('data:')) {
    const commaIndex = trimmed.indexOf(',');
    return commaIndex >= 0 ? trimmed.slice(commaIndex + 1) : undefined;
  }
  return trimmed;
}

/** Reject prototype/constructor keys and dotted paths before writing to `window`. */
function isSafeCallbackName(name: string): boolean {
  return (
    /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) && !(name in Object.prototype) && name !== 'prototype'
  );
}

function normalizeTokenInjectionConfig(args: Record<string, unknown>): {
  enabled: boolean;
  responseSelector: string | undefined;
  callbackName: string | undefined;
} {
  const enabled = argBool(args, 'injectToken', true);
  const responseSelector = argString(args, 'responseSelector', '').trim() || undefined;
  const callbackName = argString(args, 'callbackName', '').trim() || undefined;
  return { enabled, responseSelector, callbackName };
}

async function injectCaptchaToken(
  page: {
    evaluate: (...args: any[]) => Promise<unknown>;
  },
  token: string,
  config: { responseSelector?: string; callbackName?: string },
): Promise<void> {
  await page.evaluate(
    (
      solvedToken: string,
      injectionConfig: { responseSelector?: string; callbackName?: string },
    ) => {
      const { responseSelector, callbackName } = injectionConfig;
      if (responseSelector) {
        const element = document.querySelector(responseSelector);
        if (
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
        ) {
          element.value = solvedToken;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (element instanceof HTMLElement) {
          element.setAttribute('data-captcha-token', solvedToken);
          element.dispatchEvent(new CustomEvent('captcha-token', { detail: solvedToken }));
        }
      }

      if (callbackName) {
        const candidate = (window as unknown as Record<string, unknown>)[callbackName];
        if (typeof candidate === 'function') {
          (candidate as (value: string) => void)(solvedToken);
        }
      }
    },
    token,
    config,
  );
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
  const baseUrl = getSolverBaseUrl('2captcha');

  if (!baseUrl) {
    throw new Error(
      'CAPTCHA_SOLVER_BASE_URL must be configured before using external_service mode.',
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

  const submitRes = await fetchWithTimeout(
    `${baseUrl}/in.php`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(submitBody),
    },
    CAPTCHA_SUBMIT_TIMEOUT_MS,
  );
  const submitData = (await submitRes.json()) as Record<string, unknown>;

  if (submitData.status !== 1) {
    throw new Error(`2captcha submit failed: ${JSON.stringify(submitData)}`);
  }

  const taskId = submitData.request as string;

  // Poll with bounded dynamic sleep to avoid timeout drift while reducing request pressure.
  const pollInterval = CAPTCHA_POLL_INTERVAL_MS;
  while (true) {
    const elapsed = Date.now() - start;
    if (elapsed >= timeoutMs) break;
    await sleep(Math.min(pollInterval, timeoutMs - elapsed));

    const resultUrl = new URL(`${baseUrl}/res.php`);
    resultUrl.searchParams.set('key', apiKey);
    resultUrl.searchParams.set('action', 'get');
    resultUrl.searchParams.set('id', taskId);
    resultUrl.searchParams.set('json', '1');
    const resultRes = await fetchWithTimeout(resultUrl.toString(), {}, CAPTCHA_RESULT_TIMEOUT_MS);
    const resultData = (await resultRes.json()) as Record<string, unknown>;

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

// ── Exported handlers ──

export async function handleCaptchaVisionSolve(
  args: Record<string, unknown>,
  collector: CodeCollector,
  elicitationBridge?: ElicitationBridge,
): Promise<ToolResponse> {
  const page = await collector.getActivePage();
  if (!page) return R.fail('No active page.').build();

  const mode = normalizeSolverMode(
    args.mode ?? args.provider ?? readEnvNullableString('CAPTCHA_PROVIDER', { trim: true }),
  );
  const externalService = resolveExternalServiceName(args);
  const apiKey =
    argString(args, 'apiKey', '') || readEnvString('CAPTCHA_API_KEY', '', { trim: true });
  const challengeTypeHint = normalizeChallengeTypeHint(args.challengeType ?? args.typeHint);
  const taskKind = resolveTaskKind(args.taskKind, challengeTypeHint);
  const timeoutMs = Math.min(
    Math.max(argNumber(args, 'timeoutMs', CAPTCHA_DEFAULT_TIMEOUT_MS), CAPTCHA_MIN_TIMEOUT_MS),
    CAPTCHA_MAX_TIMEOUT_MS,
  );
  const maxRetries = Math.min(
    Math.max(argNumber(args, 'maxRetries', CAPTCHA_DEFAULT_RETRIES), 0),
    CAPTCHA_MAX_RETRIES,
  );

  const challengeType = challengeTypeHint;
  const siteKey = argString(args, 'siteKey');
  const pageUrl = argString(args, 'pageUrl', '') || page.url();

  // Widget solving needs a siteKey for external providers, but manual mode
  // delegates the solving to the user in-browser, so it may proceed without one.
  if (requiresWidgetContext(taskKind) && !siteKey && mode !== 'manual') {
    return R.fail('Widget solving requires an explicit siteKey.').build();
  }

  if (mode === 'manual') {
    // ── Resume path (MRTR round-trip): the client re-calls this tool with the
    // requestState token returned by a previous suspension + user responses.
    const resumeToken = argString(args, 'resumeToken');
    if (resumeToken && elicitationBridge) {
      const decoded = elicitationBridge.resumeFromState<{
        pageUrl?: string;
        challengeType?: string;
      }>(resumeToken, 'captcha_manual');
      if (!decoded) {
        return R.fail(
          'resumeToken is invalid, expired or from a different flow. Restart with a fresh captcha_vision_solve call.',
        ).build();
      }
      const responses = (args.resumeResponses ?? {}) as Record<string, unknown>;
      if (responses.solved !== true) {
        return R.fail('User indicated the CAPTCHA is not solved.')
          .set('inputResult', responses.solved === false ? 'declined' : 'incomplete')
          .build();
      }
      return R.ok().build({
        mode: 'manual',
        resumed: true,
        solved: true,
        token: typeof responses.token === 'string' ? responses.token : undefined,
        challengeType: decoded.state.data.challengeType ?? challengeType,
        pageUrl: decoded.state.data.pageUrl ?? pageUrl,
      });
    }

    // ── Suspend path: interactive elicitation when the client supports it,
    // otherwise an InputRequiredResult suspension with an encrypted
    // requestState (plan Task 3.2 — CAPTCHA ↔ ElicitationBridge linkage).
    if (elicitationBridge) {
      const manualForm: ElicitRequestFormParams = {
        message: [
          `🛡️ CAPTCHA detected: **${challengeType}**`,
          '',
          `Page: ${pageUrl}`,
          '',
          'Please solve the CAPTCHA in your browser, then confirm below.',
          'If a response token was generated, paste it in the token field.',
        ].join('\n'),
        requestedSchema: {
          type: 'object',
          properties: {
            solved: {
              type: 'boolean',
              description: 'Have you solved the CAPTCHA?',
              title: 'CAPTCHA Solved',
              default: false,
            } satisfies PrimitiveSchemaDefinition,
            token: {
              type: 'string',
              description: 'CAPTCHA response token (if available)',
              title: 'Response Token',
            } satisfies PrimitiveSchemaDefinition,
          },
          required: ['solved'],
        },
      };

      return elicitationBridge.requestInputAndAwait(
        manualForm,
        async (responses) => {
          if (responses.solved !== true) {
            return R.fail('User indicated the CAPTCHA is not solved.')
              .set('inputResult', 'declined')
              .build();
          }
          return R.ok().build({
            mode: 'manual',
            resumed: true,
            solved: true,
            token: typeof responses.token === 'string' ? responses.token : undefined,
            challengeType,
            pageUrl,
          });
        },
        {
          stateKind: 'captcha_manual',
          stateTtlMs: 10 * 60_000,
          state: { challengeType, pageUrl },
          instruction:
            'Re-call captcha_vision_solve with mode=manual, resumeToken=<requestState> and ' +
            'resumeResponses={ solved: true, token? } after the user solves the CAPTCHA.',
        },
      );
    }

    // Legacy behavior — no elicitation bridge available (e.g. unit tests).
    return R.ok().build({
      mode: 'manual',
      challengeType,
      siteKey: siteKey ?? null,
      instruction: 'Please solve the CAPTCHA manually in the browser, then continue.',
      hint: 'Configure an external solver service and CAPTCHA_API_KEY to automate this flow.',
    });
  }

  if (challengeType === 'browser_check') {
    return R.fail(
      'browser_check challenges are not supported by external solvers — use ' +
        'widget_challenge_solve with hook or manual mode.',
    ).build();
  }

  // External provider solving
  if (!apiKey) {
    return R.fail('External solver credentials are required. Set CAPTCHA_API_KEY.').build();
  }
  if (!['2captcha', 'anticaptcha', 'capsolver'].includes(externalService)) {
    return R.fail('Unsupported external solver service.').build();
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const imageBase64 =
        taskKind === 'image'
          ? (normalizeBase64Payload(args.imageBase64) ??
            (await captureCaptchaImageBase64(page as typeof page & any)))
          : undefined;

      const result: SolveResult =
        externalService === '2captcha'
          ? await solveWith2Captcha(
              apiKey,
              {
                taskKind,
                siteKey,
                pageUrl,
                imageBase64,
              },
              timeoutMs,
            )
          : await solveWithJsonTaskApi(
              externalService as 'anticaptcha' | 'capsolver',
              apiKey,
              {
                taskKind,
                siteKey,
                pageUrl,
                imageBase64,
              },
              timeoutMs,
            );

      return R.ok().build({
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

  return R.fail(lastError ?? new Error('All attempts failed'))
    .merge({
      challengeType,
      mode,
      maxRetries,
      suggestion: 'Try manual mode or adjust the external solver configuration.',
    })
    .build();
}

export async function handleWidgetChallengeSolve(
  args: Record<string, unknown>,
  collector: CodeCollector,
): Promise<ToolResponse> {
  const page = await collector.getActivePage();
  if (!page) return R.fail('No active page.').build();

  const mode = normalizeSolverMode(
    args.mode ?? args.provider ?? readEnvNullableString('CAPTCHA_PROVIDER', { trim: true }),
  );
  const externalService = resolveExternalServiceName(args);
  const apiKey =
    argString(args, 'apiKey', '') || readEnvString('CAPTCHA_API_KEY', '', { trim: true });
  const timeoutMs = Math.min(
    Math.max(argNumber(args, 'timeoutMs', CAPTCHA_DEFAULT_TIMEOUT_MS), CAPTCHA_MIN_TIMEOUT_MS),
    CAPTCHA_MAX_TIMEOUT_MS,
  );
  const injectConfig = normalizeTokenInjectionConfig(args);
  if (injectConfig.callbackName && !isSafeCallbackName(injectConfig.callbackName)) {
    return R.fail(
      'callbackName must be a plain JS identifier (no dotted paths or prototype keys).',
    ).build();
  }
  const taskKind = resolveTaskKind(args.taskKind, 'widget');
  const siteKey = argString(args, 'siteKey');
  const pageUrl = argString(args, 'pageUrl', '') || page.url();

  if (mode === 'hook') {
    if (!siteKey) {
      return R.fail('Widget solving requires an explicit siteKey.').build();
    }
    const hookTimeoutMs = Math.min(timeoutMs, CAPTCHA_HOOK_TIMEOUT_MAX_MS);
    const callbackName = argString(args, 'callbackName', '').trim();
    if (!callbackName) {
      return R.fail('Hook mode requires an explicit callbackName.').build();
    }
    const token = await page
      .evaluate(
        (hookTimeout: number, targetCallbackName: string) => {
          return new Promise<string>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('Hook timeout')), hookTimeout);
            const target = (window as unknown as Record<string, unknown>)[targetCallbackName];
            if (typeof target === 'function') {
              const original = target as (value: string) => unknown;
              (window as unknown as Record<string, unknown>)[targetCallbackName] = (
                captchaToken: string,
              ) => {
                clearTimeout(timeout);
                resolve(captchaToken);
                return original(captchaToken);
              };
            } else {
              clearTimeout(timeout);
              reject(new Error('The requested callbackName is not a callable function.'));
            }
          });
        },
        hookTimeoutMs,
        callbackName,
      )
      .catch(() => null);

    if (token) {
      return R.ok().build({
        token,
        method: 'hook',
        challengeType: 'widget',
        siteKey,
        callbackName,
      });
    }
  }

  if (mode === 'manual') {
    return R.ok().build({
      mode: 'manual',
      challengeType: 'widget',
      siteKey: siteKey || null,
      pageUrl,
      instruction: 'Please complete the widget challenge manually.',
    });
  }

  if (!siteKey) {
    return R.fail('Widget solving requires an explicit siteKey.').build();
  }

  if (!apiKey) {
    return R.fail('External solver credentials are required.').build();
  }

  try {
    const result =
      externalService === '2captcha'
        ? await solveWith2Captcha(
            apiKey,
            {
              taskKind,
              siteKey,
              pageUrl,
            },
            timeoutMs,
          )
        : externalService === 'anticaptcha' || externalService === 'capsolver'
          ? await solveWithJsonTaskApi(
              externalService,
              apiKey,
              {
                taskKind,
                siteKey,
                pageUrl,
              },
              timeoutMs,
            )
          : (() => {
              throw new Error('Unsupported external solver service.');
            })();

    if (injectConfig.enabled && result.token) {
      await injectCaptchaToken(page, result.token, {
        responseSelector: injectConfig.responseSelector,
        callbackName: injectConfig.callbackName,
      });
    }

    return R.ok().build({
      token: result.token,
      challengeType: result.challengeType,
      siteKey,
      mode: result.mode,
      durationMs: result.durationMs,
      taskKind,
      injected: injectConfig.enabled,
      responseSelector: injectConfig.responseSelector ?? null,
      callbackName: injectConfig.callbackName ?? null,
    });
  } catch (error) {
    return R.fail(error)
      .merge({
        siteKey,
        mode,
        suggestion: 'Try manual mode or hook mode.',
      })
      .build();
  }
}

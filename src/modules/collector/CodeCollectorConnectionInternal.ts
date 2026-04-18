import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { connect } from 'rebrowser-puppeteer-core';
import type { Browser } from 'rebrowser-puppeteer-core';
import { logger } from '@utils/logger';
import { connectPlaywrightCdpFallback } from '@modules/collector/playwright-cdp-fallback';
import type { ChromeConnectOptions } from './CodeCollector';

type ChromeReleaseChannel = 'stable' | 'beta' | 'dev' | 'canary';

export function resolveDefaultChromeUserDataDir(channel: ChromeReleaseChannel = 'stable'): string {
  const home = homedir();

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local');
    switch (channel) {
      case 'beta':
        return join(localAppData, 'Google', 'Chrome Beta', 'User Data');
      case 'dev':
        return join(localAppData, 'Google', 'Chrome Dev', 'User Data');
      case 'canary':
        return join(localAppData, 'Google', 'Chrome SxS', 'User Data');
      case 'stable':
      default:
        return join(localAppData, 'Google', 'Chrome', 'User Data');
    }
  }

  if (process.platform === 'darwin') {
    const appSupport = join(home, 'Library', 'Application Support');
    switch (channel) {
      case 'beta':
        return join(appSupport, 'Google', 'Chrome Beta');
      case 'dev':
        return join(appSupport, 'Google', 'Chrome Dev');
      case 'canary':
        return join(appSupport, 'Google', 'Chrome Canary');
      case 'stable':
      default:
        return join(appSupport, 'Google', 'Chrome');
    }
  }

  const configHome = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  switch (channel) {
    case 'beta':
      return join(configHome, 'google-chrome-beta');
    case 'dev':
      return join(configHome, 'google-chrome-unstable');
    case 'canary':
      return join(configHome, 'google-chrome-canary');
    case 'stable':
    default:
      return join(configHome, 'google-chrome');
  }
}

export async function resolveAutoConnectWsEndpointImpl(
  options: ChromeConnectOptions,
): Promise<string> {
  const channel = options.channel ?? 'stable';
  const userDataDir = options.userDataDir ?? resolveDefaultChromeUserDataDir(channel);
  const devToolsActivePortPath = join(userDataDir, 'DevToolsActivePort');

  let fileContent: string;
  try {
    fileContent = await readFile(devToolsActivePortPath, 'utf8');
  } catch (error) {
    throw new Error(
      `Could not read DevToolsActivePort from "${devToolsActivePortPath}". Check if Chrome is running from this profile and remote debugging is enabled at chrome://inspect/#remote-debugging.`,
      { cause: error },
    );
  }

  const [rawPort, rawPath] = fileContent
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!rawPort || !rawPath) {
    throw new Error(`Invalid DevToolsActivePort contents found in "${devToolsActivePortPath}".`);
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid remote debugging port "${rawPort}" in "${devToolsActivePortPath}".`);
  }

  return `ws://127.0.0.1:${port}${rawPath}`;
}

export async function resolveConnectOptionsImpl(
  endpointOrOptions: string | ChromeConnectOptions,
): Promise<{ browserWSEndpoint?: string; browserURL?: string }> {
  if (typeof endpointOrOptions === 'string') {
    const endpoint = endpointOrOptions.trim();
    if (!endpoint) {
      throw new Error('Connection endpoint cannot be empty.');
    }
    return endpoint.startsWith('ws://') || endpoint.startsWith('wss://')
      ? { browserWSEndpoint: endpoint }
      : { browserURL: endpoint };
  }

  if (endpointOrOptions.wsEndpoint) {
    return { browserWSEndpoint: endpointOrOptions.wsEndpoint };
  }

  if (endpointOrOptions.browserURL) {
    return { browserURL: endpointOrOptions.browserURL };
  }

  if (endpointOrOptions.autoConnect || endpointOrOptions.userDataDir || endpointOrOptions.channel) {
    return {
      browserWSEndpoint: await resolveAutoConnectWsEndpointImpl(endpointOrOptions),
    };
  }

  throw new Error(
    'browserURL, wsEndpoint, autoConnect, userDataDir, or channel is required to connect to an existing browser.',
  );
}

export function isAutoConnectRequest(endpointOrOptions: string | ChromeConnectOptions): boolean {
  return (
    typeof endpointOrOptions !== 'string' &&
    Boolean(
      endpointOrOptions.autoConnect || endpointOrOptions.userDataDir || endpointOrOptions.channel,
    )
  );
}

export function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const directMessage =
      'message' in error && typeof error.message === 'string' ? error.message.trim() : '';
    if (directMessage) {
      return directMessage;
    }

    const nestedError = 'error' in error ? error.error : undefined;
    if (nestedError instanceof Error && nestedError.message) {
      return nestedError.message;
    }

    if (typeof nestedError === 'object' && nestedError !== null) {
      const nestedMessage =
        'message' in nestedError && typeof nestedError.message === 'string'
          ? nestedError.message.trim()
          : '';
      if (nestedMessage) {
        return nestedMessage;
      }
    }

    const serialized = JSON.stringify(error);
    if (serialized && serialized !== '{}') {
      return serialized;
    }
  }

  return String(error);
}

export function normalizeConnectError(
  error: unknown,
  target: string,
  endpointOrOptions: string | ChromeConnectOptions,
): Error {
  const message = getUnknownErrorMessage(error);

  if (isAutoConnectRequest(endpointOrOptions) && /ECONNREFUSED/i.test(message)) {
    return new Error(
      `Failed to connect to existing browser: ${message}. ` +
        `Chrome is not currently listening at ${target}. ` +
        'DevToolsActivePort may be stale after a browser restart. ' +
        'Re-open Chrome, confirm remote debugging is enabled at chrome://inspect/#remote-debugging, click Allow if prompted, and retry.',
    );
  }

  return error instanceof Error
    ? error
    : new Error(`Failed to connect to existing browser: ${message}`);
}

export function buildConnectTimeoutError(
  target: string,
  endpointOrOptions: string | ChromeConnectOptions,
  timeoutMs: number,
): Error {
  const baseMessage =
    `Timed out after ${timeoutMs}ms while connecting to existing browser: ${target}. ` +
    'The CDP handshake did not complete in time.';

  if (isAutoConnectRequest(endpointOrOptions)) {
    return new Error(
      `${baseMessage} If Chrome prompted for remote debugging approval, click Allow in Chrome and then retry the tool call.`,
    );
  }

  return new Error(
    `${baseMessage} Verify that the browser debugging endpoint is reachable and retry.`,
  );
}

export function shouldAttemptPlaywrightFallback(error: unknown): boolean {
  const message = getUnknownErrorMessage(error);

  if (/ECONNREFUSED|ENOTFOUND|404|stale/i.test(message)) {
    return false;
  }

  return /timed out|handshake|Protocol error|Target closed|ECONNRESET|socket hang up|WebSocket/i.test(
    message,
  );
}

export async function connectWithPlaywrightFallbackImpl(
  connectOptions: { browserWSEndpoint?: string; browserURL?: string },
  primaryError: unknown,
  timeoutMs: number,
): Promise<Browser> {
  const endpoint = connectOptions.browserWSEndpoint ?? connectOptions.browserURL;
  if (!endpoint) {
    throw primaryError instanceof Error ? primaryError : new Error(String(primaryError));
  }

  logger.warn(
    `[connect-fallback] Rebrowser connect failed. Falling back to Playwright CDP compatibility mode for ${endpoint}.`,
  );

  try {
    return await connectPlaywrightCdpFallback(endpoint, timeoutMs);
  } catch (fallbackError) {
    const primaryMessage = getUnknownErrorMessage(primaryError);
    const fallbackMessage = getUnknownErrorMessage(fallbackError);
    throw new Error(
      `Failed to connect to existing browser via both rebrowser-puppeteer and Playwright CDP compatibility fallback. ` +
        `Primary error: ${primaryMessage}. Fallback error: ${fallbackMessage}.`,
      { cause: fallbackError },
    );
  }
}

export async function connectWithTimeoutImpl(
  connectOptions: { browserWSEndpoint?: string; browserURL?: string },
  target: string,
  endpointOrOptions: string | ChromeConnectOptions,
  timeoutMs: number,
  connectAttemptRef: { current: number },
): Promise<Browser> {
  const attemptId = ++connectAttemptRef.current;
  try {
    return await new Promise<Browser>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        settled = true;
        if (connectAttemptRef.current === attemptId) {
          connectAttemptRef.current += 1;
        }
        reject(buildConnectTimeoutError(target, endpointOrOptions, timeoutMs));
      }, timeoutMs);

      void connect({ ...connectOptions, defaultViewport: null })
        .then(async (browser) => {
          if (settled || connectAttemptRef.current !== attemptId) {
            try {
              await browser.disconnect();
            } catch {
              /* best-effort cleanup for stale connection results */
            }
            return;
          }

          settled = true;
          clearTimeout(timer);
          resolve(browser);
        })
        .catch((error) => {
          if (settled || connectAttemptRef.current !== attemptId) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          reject(normalizeConnectError(error, target, endpointOrOptions));
        });
    });
  } catch (error) {
    if (!shouldAttemptPlaywrightFallback(error)) {
      throw error;
    }

    return await connectWithPlaywrightFallbackImpl(connectOptions, error, timeoutMs);
  }
}

/**
 * jsdom-tools.ts — Headless DOM analysis tools backed by the `jsdom` package.
 *
 * Provides 5 tools for offline HTML parsing, DOM querying, sandboxed script
 * execution, serialization and cookie management. Each call creates or
 * references a session keyed by UUID. Sessions auto-expire after
 * {@link SESSION_TTL_MS} of inactivity.
 */

import { randomUUID } from 'node:crypto';
import { JSDOM } from 'jsdom';

import { R, type ToolResponse } from '@server/domains/shared/ResponseBuilder';
import {
  argString,
  argNumber,
  argBool,
  argEnum,
  argStringRequired,
  argStringArray,
  argObject,
} from '@server/domains/shared/parse-args';
import { logger } from '@utils/logger';

type RunScriptsMode = 'none' | 'outside-only' | 'dangerously';
type CookieAction = 'get' | 'set' | 'clear';

const RUN_SCRIPTS_MODES: ReadonlySet<RunScriptsMode> = new Set([
  'none',
  'outside-only',
  'dangerously',
]);
const COOKIE_ACTIONS: ReadonlySet<CookieAction> = new Set(['get', 'set', 'clear']);

/** Session lifetime in milliseconds. Configurable via env in future. */
const SESSION_TTL_MS = 10 * 60 * 1000;

interface JsdomSession {
  dom: JSDOM;
  url: string;
  runScripts: RunScriptsMode;
  includeNodeLocations: boolean;
  createdAt: number;
  timer: NodeJS.Timeout;
}

export class JsdomHandlers {
  private readonly sessions = new Map<string, JsdomSession>();

  // ── Session lifecycle ──

  private createSessionId(): string {
    return randomUUID();
  }

  private scheduleExpiry(sessionId: string): NodeJS.Timeout {
    const timer = setTimeout(() => {
      logger.debug(`JSDOM session ${sessionId} expired after ${SESSION_TTL_MS}ms`);
      this.closeSession(sessionId);
    }, SESSION_TTL_MS);
    timer.unref?.();
    return timer;
  }

  private refreshSessionExpiry(sessionId: string, session: JsdomSession): void {
    clearTimeout(session.timer);
    session.timer = this.scheduleExpiry(sessionId);
  }

  private getSession(sessionId: string): JsdomSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`JSDOM session not found or expired: ${sessionId}`);
    }
    this.refreshSessionExpiry(sessionId, session);
    return session;
  }

  private closeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    clearTimeout(session.timer);
    try {
      session.dom.window.close();
    } catch (err) {
      logger.debug(`JSDOM window close error: ${String(err)}`);
    }
    this.sessions.delete(sessionId);
  }

  /** Close all active sessions. Called on server shutdown. */
  closeAll(): void {
    for (const id of Array.from(this.sessions.keys())) {
      this.closeSession(id);
    }
  }

  // ── Tool: parse ──

  async handleJsdomParse(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const html = argStringRequired(args, 'html');
      const url = argString(args, 'url', 'about:blank');
      const contentType = argString(args, 'contentType', 'text/html');
      const runScripts = argEnum(args, 'runScripts', RUN_SCRIPTS_MODES, 'none');
      const includeNodeLocations = argBool(args, 'includeNodeLocations', false);
      const pretendToBeVisual = argBool(args, 'pretendToBeVisual', false);
      const referrer = argString(args, 'referrer', '');
      const storageQuotaBytes = argNumber(args, 'storageQuotaBytes', 5_000_000);

      const options: ConstructorParameters<typeof JSDOM>[1] = {
        url,
        contentType,
        includeNodeLocations,
        pretendToBeVisual,
        storageQuota: storageQuotaBytes,
      };
      if (runScripts !== 'none') {
        (options as Record<string, unknown>).runScripts = runScripts;
      }
      if (referrer) {
        (options as Record<string, unknown>).referrer = referrer;
      }

      const dom = new JSDOM(html, options);
      const sessionId = this.createSessionId();
      const session: JsdomSession = {
        dom,
        url,
        runScripts,
        includeNodeLocations,
        createdAt: Date.now(),
        timer: this.scheduleExpiry(sessionId),
      };
      this.sessions.set(sessionId, session);

      const doc = dom.window.document;
      return R.ok()
        .set('sessionId', sessionId)
        .set('title', doc.title || '')
        .set('url', url)
        .set('contentType', contentType)
        .set('runScripts', runScripts)
        .set('ttlMs', SESSION_TTL_MS)
        .set('activeSessions', this.sessions.size)
        .set('stats', {
          elements: doc.getElementsByTagName('*').length,
          scripts: doc.getElementsByTagName('script').length,
          links: doc.getElementsByTagName('a').length,
          images: doc.getElementsByTagName('img').length,
          stylesheets: doc.querySelectorAll('link[rel="stylesheet"], style').length,
        })
        .build();
    } catch (error) {
      return R.fail(error).build();
    }
  }

  // ── Tool: query ──

  async handleJsdomQuery(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const sessionId = argStringRequired(args, 'sessionId');
      const selector = argStringRequired(args, 'selector');
      const maxResults = argNumber(args, 'maxResults', 50);
      const includeHtml = argBool(args, 'includeHtml', false);
      const includeText = argBool(args, 'includeText', true);
      const includeLocation = argBool(args, 'includeLocation', false);
      const attributes = argStringArray(args, 'attributes');

      const session = this.getSession(sessionId);
      const doc = session.dom.window.document;
      const all = Array.from(doc.querySelectorAll(selector));
      const slice = all.slice(0, maxResults);

      const results = slice.map((el) => {
        const item: Record<string, unknown> = {
          tag: el.tagName.toLowerCase(),
        };

        if (attributes.length > 0) {
          const picked: Record<string, string | null> = {};
          for (const name of attributes) picked[name] = el.getAttribute(name);
          item.attributes = picked;
        } else {
          const full: Record<string, string> = {};
          for (const attr of Array.from(el.attributes)) full[attr.name] = attr.value;
          item.attributes = full;
        }

        if (includeText) item.text = (el.textContent ?? '').trim();
        if (includeHtml) item.html = el.outerHTML;

        if (includeLocation && session.includeNodeLocations) {
          try {
            item.location = session.dom.nodeLocation(el) ?? null;
          } catch {
            item.location = null;
          }
        }

        return item;
      });

      return R.ok()
        .set('sessionId', sessionId)
        .set('selector', selector)
        .set('matched', all.length)
        .set('returned', results.length)
        .set('results', results)
        .build();
    } catch (error) {
      return R.fail(error).build();
    }
  }

  // ── Tool: execute ──

  async handleJsdomExecute(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const sessionId = argStringRequired(args, 'sessionId');
      const code = argStringRequired(args, 'code');
      const timeoutHintMs = argNumber(args, 'timeoutMs', 5000);

      const session = this.getSession(sessionId);
      if (session.runScripts === 'none') {
        return R.fail(
          'JSDOM session was created with runScripts="none". Re-parse with runScripts="outside-only" or "dangerously" to execute code.',
        ).build();
      }

      const logs: Array<{ level: string; args: unknown[] }> = [];
      const window = session.dom.window as unknown as Record<string, unknown>;
      const originalConsole = window.console;
      const capturing = createCapturingConsole(originalConsole, logs);
      window.console = capturing;

      let result: unknown;
      let errorMessage: string | null = null;
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        result = (window.eval as (src: string) => unknown)(code);
      } catch (err) {
        errorMessage = err instanceof Error ? err.message : String(err);
      } finally {
        window.console = originalConsole;
      }

      if (errorMessage !== null) {
        return R.fail(errorMessage).set('consoleLogs', logs).build();
      }

      return R.ok()
        .set('sessionId', sessionId)
        .set('result', safeSerialize(result))
        .set('consoleLogs', logs)
        .set('timeoutHintMs', timeoutHintMs)
        .build();
    } catch (error) {
      return R.fail(error).build();
    }
  }

  // ── Tool: serialize ──

  async handleJsdomSerialize(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const sessionId = argStringRequired(args, 'sessionId');
      const pretty = argBool(args, 'pretty', false);
      const fragment = argString(args, 'selector', '');

      const session = this.getSession(sessionId);
      let html: string;

      if (fragment) {
        const element = session.dom.window.document.querySelector(fragment);
        if (!element) {
          return R.fail(`No element matches selector: ${fragment}`).build();
        }
        html = element.outerHTML;
      } else {
        html = session.dom.serialize();
      }

      if (pretty) {
        html = prettyPrintHtml(html);
      }

      return R.ok()
        .set('sessionId', sessionId)
        .set('bytes', Buffer.byteLength(html, 'utf8'))
        .set('pretty', pretty)
        .set('html', html)
        .build();
    } catch (error) {
      return R.fail(error).build();
    }
  }

  // ── Tool: cookies ──

  async handleJsdomCookies(args: Record<string, unknown>): Promise<ToolResponse> {
    try {
      const sessionId = argStringRequired(args, 'sessionId');
      const action = argEnum(args, 'action', COOKIE_ACTIONS, 'get');
      const session = this.getSession(sessionId);
      const jar = session.dom.cookieJar as unknown as CookieJarLike;
      const cookieUrl = argString(args, 'url', session.url);

      if (action === 'get') {
        const cookies = await jar.getCookies(cookieUrl);
        return R.ok()
          .set('sessionId', sessionId)
          .set('url', cookieUrl)
          .set('cookies', cookies.map(serializeCookie))
          .build();
      }

      if (action === 'set') {
        const cookie = argObject(args, 'cookie');
        if (!cookie) {
          return R.fail('cookie object required for action="set"').build();
        }
        const cookieStr = typeof cookie.raw === 'string' ? cookie.raw : buildCookieString(cookie);
        await jar.setCookie(cookieStr, cookieUrl);
        return R.ok()
          .set('sessionId', sessionId)
          .set('action', 'set')
          .set('cookie', cookieStr)
          .build();
      }

      // action === 'clear'
      const store = (
        jar as unknown as {
          store?: { removeAllCookies?: (cb: (err: Error | null) => void) => void };
        }
      ).store;
      if (store && typeof store.removeAllCookies === 'function') {
        await new Promise<void>((resolve, reject) =>
          store.removeAllCookies!((err) => (err ? reject(err) : resolve())),
        );
      }
      return R.ok().set('sessionId', sessionId).set('action', 'clear').build();
    } catch (error) {
      return R.fail(error).build();
    }
  }
}

// ── Helpers ──

interface CookieLike {
  key?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: string | Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

interface CookieJarLike {
  getCookies(url: string): Promise<CookieLike[]>;
  setCookie(str: string, url: string): Promise<unknown>;
}

function serializeCookie(c: CookieLike): Record<string, unknown> {
  return {
    key: c.key ?? '',
    value: c.value ?? '',
    domain: c.domain ?? null,
    path: c.path ?? null,
    expires: c.expires instanceof Date ? c.expires.toISOString() : (c.expires ?? null),
    httpOnly: c.httpOnly === true,
    secure: c.secure === true,
    sameSite: c.sameSite ?? null,
  };
}

function buildCookieString(cookie: Record<string, unknown>): string {
  const name = String(cookie.name ?? cookie.key ?? '');
  const value = String(cookie.value ?? '');
  if (!name) throw new Error('cookie.name (or cookie.key) is required');
  const parts: string[] = [`${name}=${value}`];
  if (typeof cookie.domain === 'string') parts.push(`Domain=${cookie.domain}`);
  if (typeof cookie.path === 'string') parts.push(`Path=${cookie.path}`);
  if (typeof cookie.expires === 'string') parts.push(`Expires=${cookie.expires}`);
  if (typeof cookie.maxAge === 'number') parts.push(`Max-Age=${cookie.maxAge}`);
  if (cookie.secure === true) parts.push('Secure');
  if (cookie.httpOnly === true) parts.push('HttpOnly');
  if (typeof cookie.sameSite === 'string') parts.push(`SameSite=${cookie.sameSite}`);
  return parts.join('; ');
}

function createCapturingConsole(
  original: unknown,
  logs: Array<{ level: string; args: unknown[] }>,
): Record<string, (...args: unknown[]) => void> {
  const levels = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  const proxy: Record<string, (...args: unknown[]) => void> = {};
  for (const level of levels) {
    proxy[level] = (...callArgs: unknown[]) => {
      logs.push({ level, args: callArgs.map((x) => safeSerialize(x)) });
      const orig = (original as Record<string, unknown>)?.[level];
      if (typeof orig === 'function') {
        try {
          (orig as (...a: unknown[]) => void).apply(original, callArgs);
        } catch {
          /* swallow secondary failures */
        }
      }
    };
  }
  return proxy;
}

function safeSerialize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${(value as bigint).toString()}n`;
  if (t === 'function') {
    const fn = value as { name?: string };
    return `[Function: ${fn.name || 'anonymous'}]`;
  }
  if (t === 'symbol') return String(value);
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function prettyPrintHtml(html: string): string {
  // Lightweight formatter: insert newlines between adjacent tag boundaries.
  // jsdom already emits well-formed markup so this is a safe textual transform.
  return html.replace(/>(?=<)/g, '>\n');
}

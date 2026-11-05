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
import type { JSDOM as JSDOMType } from 'jsdom';

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

/** Maximum HTML input size to prevent unbounded memory allocation. */
const MAX_HTML_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB

/** Maximum user code size for browser_jsdom_execute (input validation gate). */
const MAX_EXEC_CODE_LENGTH = 100 * 1024; // 100 KB

/** Session lifetime in milliseconds. Configurable via env in future. */
const SESSION_TTL_MS = 10 * 60 * 1000;

/** Allows one offline DOM workspace per member of a typical 10-agent fan-out. */
const MAX_SESSIONS = 20;

/**
 * Default storage quota for JSDOM sessions. Must match the tool schema default
 * (definitions.tools.jsdom.ts `storageQuotaBytes` default: 5_000_000) and
 * jsdom's own default, so an omitted arg behaves as the schema documents.
 */
const STORAGE_QUOTA_BYTES_DEFAULT = 5_000_000;

interface JsdomSession {
  dom: JSDOMType;
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
      if (Buffer.byteLength(html, 'utf8') > MAX_HTML_SIZE_BYTES) {
        return R.fail(
          `HTML input exceeds ${MAX_HTML_SIZE_BYTES / 1024 / 1024}MB limit. Provide smaller HTML or use a URL.`,
        ).build();
      }
      const url = argString(args, 'url', 'about:blank');
      const contentType = argString(args, 'contentType', 'text/html');
      const runScripts = argEnum(args, 'runScripts', RUN_SCRIPTS_MODES, 'none');
      const includeNodeLocations = argBool(args, 'includeNodeLocations', false);
      const pretendToBeVisual = argBool(args, 'pretendToBeVisual', false);
      const referrer = argString(args, 'referrer', '');
      const storageQuotaBytes = argNumber(args, 'storageQuotaBytes', STORAGE_QUOTA_BYTES_DEFAULT);

      if (this.sessions.size >= MAX_SESSIONS) {
        return R.fail(
          `JSDOM session limit reached (${MAX_SESSIONS}). Close existing sessions first with browser_jsdom_serialize + drop.`,
        ).build();
      }

      const options: ConstructorParameters<typeof JSDOMType>[1] = {
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
      if (Buffer.byteLength(code, 'utf8') > MAX_EXEC_CODE_LENGTH) {
        return R.fail(`code exceeds ${MAX_EXEC_CODE_LENGTH / 1024}KB limit`).build();
      }
      const timeoutHintMs = argNumber(args, 'timeoutMs', 5000);

      const session = this.getSession(sessionId);
      if (session.runScripts === 'none') {
        return R.fail(
          'JSDOM session was created with runScripts="none". Re-parse with runScripts="outside-only" or ' +
            '"dangerously" to execute code.',
        ).build();
      }

      // Execute in QuickJS WASM sandbox for security isolation
      const sandboxResult = await this.executeInSandbox(session, code, timeoutHintMs);

      if (!sandboxResult.ok) {
        return R.fail(sandboxResult.error ?? 'Execution failed')
          .set(
            'consoleLogs',
            sandboxResult.logs.map((msg) => ({ level: 'log', args: [msg] })),
          )
          .set('timedOut', sandboxResult.timedOut)
          .build();
      }

      return R.ok()
        .set('sessionId', sessionId)
        .set('result', sandboxResult.output)
        .set(
          'consoleLogs',
          sandboxResult.logs.map((msg) => ({ level: 'log', args: [msg] })),
        )
        .set('timeoutHintMs', timeoutHintMs)
        .set('durationMs', sandboxResult.durationMs)
        .build();
    } catch (error) {
      return R.fail(error).build();
    }
  }

  /**
   * Execute user code in QuickJS WASM sandbox with JSDOM DOM access.
   *
   * This provides strong isolation: code runs in WebAssembly and cannot
   * access Node.js APIs, filesystem, or network even if it escapes the
   * QuickJS VM.
   *
   * **Trade-off**: Direct DOM manipulation is not supported in the sandbox.
   * Code can access read-only document/window properties but cannot call
   * querySelector/getElementById. Users who need DOM queries should use
   * browser_jsdom_query tool instead. This trade-off is acceptable because
   * security (preventing Node.js API access) is more critical than convenience.
   */
  private async executeInSandbox(
    session: JsdomSession,
    code: string,
    timeoutMs: number,
  ): Promise<{
    ok: boolean;
    output?: unknown;
    error?: string;
    timedOut: boolean;
    durationMs: number;
    logs: string[];
  }> {
    const { QuickJSSandbox } = await import('@server/sandbox/QuickJSSandbox');
    const sandbox = new QuickJSSandbox();

    // Extract DOM state into serializable form for injection
    const domGlobals = this.extractDOMGlobals(session);

    // Execute in isolated QuickJS runtime
    const result = await sandbox.execute(code, {
      timeoutMs,
      globals: domGlobals,
    });

    return result;
  }

  /**
   * Extract JSDOM window/document state into plain objects for QuickJS.
   *
   * QuickJS cannot directly access JSDOM's native objects or call methods
   * across the WASM boundary. We provide read-only properties only.
   * For DOM queries, users should use browser_jsdom_query tool.
   */
  private extractDOMGlobals(session: JsdomSession): Record<string, unknown> {
    const window = session.dom.window;
    const doc = window.document;

    return {
      // Document proxy with read-only properties
      document: {
        title: doc.title,
        URL: doc.URL,
        domain: doc.domain,
        documentElement: {
          tagName: doc.documentElement?.tagName,
          innerHTML: doc.documentElement?.innerHTML,
        },
      },
      // Window proxy
      window: {
        location: {
          href: window.location.href,
          protocol: window.location.protocol,
          host: window.location.host,
          hostname: window.location.hostname,
          port: window.location.port,
          pathname: window.location.pathname,
          search: window.location.search,
          hash: window.location.hash,
        },
        navigator: {
          userAgent: window.navigator.userAgent,
          language: window.navigator.language,
          platform: window.navigator.platform,
        },
      },
    };
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

function prettyPrintHtml(html: string): string {
  // Lightweight formatter: insert newlines between adjacent tag boundaries.
  // jsdom already emits well-formed markup so this is a safe textual transform.
  return html.replace(/>(?=<)/g, '>\n');
}

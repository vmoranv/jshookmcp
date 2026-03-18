import { describe, expect, it } from 'vitest';

import {
  buildFetchInterceptorCode,
  buildXHRInterceptorCode,
  CLEAR_INJECTED_BUFFERS_EXPRESSION,
  RESET_INJECTED_INTERCEPTORS_EXPRESSION,
} from '@modules/monitor/NetworkMonitor.interceptors';

describe('NetworkMonitor interceptors', () => {
  it('builds XHR interceptor code with buffer limits and request capture hooks', () => {
    const code = buildXHRInterceptorCode(25);

    expect(code).toContain('window.__xhrInterceptorInstalled');
    expect(code).toContain('window.XMLHttpRequest = function()');
    expect(code).toContain('xhrRequests.length > 25');
    expect(code).toContain('window.__getXHRRequests = function()');
  });

  it('builds fetch interceptor code with localStorage persistence and limit enforcement', () => {
    const code = buildFetchInterceptorCode(10);

    expect(code).toContain('window.__fetchInterceptorInstalled');
    expect(code).toContain('fetchRequests.length > 10');
    expect(code).toContain("localStorage.setItem('__capturedAPIs'");
    expect(code).toContain('window.__getFetchRequests = function()');
  });

  it('exports expressions for clearing buffers and restoring original interceptors', () => {
    expect(CLEAR_INJECTED_BUFFERS_EXPRESSION).toContain('xhrCleared');
    expect(CLEAR_INJECTED_BUFFERS_EXPRESSION).toContain('fetchCleared');
    expect(RESET_INJECTED_INTERCEPTORS_EXPRESSION).toContain(
      'window.XMLHttpRequest = window.__originalXMLHttpRequestForHook'
    );
    expect(RESET_INJECTED_INTERCEPTORS_EXPRESSION).toContain(
      'window.fetch = window.__originalFetchForHook'
    );
  });
});

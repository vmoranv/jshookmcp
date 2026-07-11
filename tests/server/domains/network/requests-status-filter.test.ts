import { describe, expect, it } from 'vitest';

import { applyRequestFilters } from '@server/domains/network/handlers/core-handlers.requests';
import type { NetworkRequestPayload } from '@server/domains/network/handlers.base.types';
import { TEST_URLS, withPath } from '@tests/shared/test-urls';

function makeRequest(id: string, status: number | undefined): NetworkRequestPayload {
  // The merged payload carries the CDP/Playwright shape (response.status) via the
  // NetworkRequestPayload [key: string]: unknown index signature.
  return {
    requestId: id,
    url: withPath(TEST_URLS.root, `api/${id}`),
    method: 'GET',
    ...(status !== undefined ? { response: { status } } : {}),
  } as NetworkRequestPayload;
}

const BASE_FILTERS = { limit: 100, offset: 0, autoEnabled: true };

function requestIds(payload: unknown): string[] {
  return (payload as { requests: Array<{ requestId?: string }> }).requests.map(
    (r) => r.requestId ?? '',
  );
}

describe('applyRequestFilters — statusCode filter', () => {
  it('filters by an exact status code', () => {
    const { finalPayload } = applyRequestFilters(
      [makeRequest('a', 200), makeRequest('b', 404), makeRequest('c', 500)],
      { ...BASE_FILTERS, statusCode: '404' },
    );
    expect(requestIds(finalPayload)).toEqual(['b']);
  });

  it('filters by a 4xx status class', () => {
    const { finalPayload } = applyRequestFilters(
      [makeRequest('a', 200), makeRequest('b', 403), makeRequest('c', 404), makeRequest('d', 503)],
      { ...BASE_FILTERS, statusCode: '4xx' },
    );
    expect(requestIds(finalPayload)).toEqual(['b', 'c']);
  });

  it('filters by a 5xx status class', () => {
    const { finalPayload } = applyRequestFilters(
      [makeRequest('a', 200), makeRequest('b', 500), makeRequest('c', 503)],
      { ...BASE_FILTERS, statusCode: '5xx' },
    );
    expect(requestIds(finalPayload)).toEqual(['b', 'c']);
  });

  it('filters by a 2xx status class (boundary: 200-299)', () => {
    const { finalPayload } = applyRequestFilters(
      [makeRequest('a', 200), makeRequest('b', 204), makeRequest('c', 301), makeRequest('d', 404)],
      { ...BASE_FILTERS, statusCode: '2xx' },
    );
    expect(requestIds(finalPayload)).toEqual(['a', 'b']);
  });

  it('excludes requests without a captured response status when statusCode is set', () => {
    const { finalPayload } = applyRequestFilters(
      [makeRequest('a', 200), makeRequest('b', undefined), makeRequest('c', 404)],
      { ...BASE_FILTERS, statusCode: '404' },
    );
    // 'b' has no response.status → excluded when filtering by status
    expect(requestIds(finalPayload)).toEqual(['c']);
  });

  it('does not filter by status when statusCode is absent (regression)', () => {
    const { finalPayload } = applyRequestFilters(
      [makeRequest('a', 200), makeRequest('b', 404)],
      BASE_FILTERS,
    );
    expect(requestIds(finalPayload)).toEqual(['a', 'b']);
  });

  it('matches a top-level status when the nested response is absent', () => {
    // Some captures surface status at the top level of the payload.
    const requests: NetworkRequestPayload[] = [
      { requestId: 'x', url: withPath(TEST_URLS.root, 'x'), method: 'GET', status: 418 },
      { requestId: 'y', url: withPath(TEST_URLS.root, 'y'), method: 'GET', status: 200 },
    ] as NetworkRequestPayload[];
    const { finalPayload } = applyRequestFilters(requests, {
      ...BASE_FILTERS,
      statusCode: '418',
    });
    expect(requestIds(finalPayload)).toEqual(['x']);
  });

  it('matches nothing for an unparseable statusCode expression', () => {
    const { finalPayload } = applyRequestFilters([makeRequest('a', 200)], {
      ...BASE_FILTERS,
      statusCode: 'not-a-code',
    });
    expect(requestIds(finalPayload)).toEqual([]);
  });

  it('combines statusCode with a url filter (intersection)', () => {
    const { finalPayload } = applyRequestFilters(
      [
        { ...makeRequest('a', 404), url: withPath(TEST_URLS.root, 'api/a') },
        { ...makeRequest('b', 404), url: withPath(TEST_URLS.root, 'other/b') },
        { ...makeRequest('c', 200), url: withPath(TEST_URLS.root, 'api/c') },
      ],
      { ...BASE_FILTERS, statusCode: '404', url: 'api/' },
    );
    expect(requestIds(finalPayload)).toEqual(['a']);
  });

  it('surfaces statusCode in the filters echo of the response', () => {
    const { finalPayload } = applyRequestFilters([makeRequest('a', 200), makeRequest('b', 404)], {
      ...BASE_FILTERS,
      statusCode: '4xx',
    });
    const filtersEcho = (finalPayload as { filters?: Record<string, unknown> }).filters;
    expect(filtersEcho?.statusCode).toBe('4xx');
  });
});

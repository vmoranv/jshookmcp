import { describe, expect, it } from 'vitest';
import { ResponseBodyCache } from '@modules/monitor/PlaywrightNetworkMonitor.body-cache';

describe('ResponseBodyCache byte budgets', () => {
  it('rejects a body over the per-entry byte limit', () => {
    const cache = new ResponseBodyCache(10, 100, 5);
    cache.set('large', '123456', false, 'text/plain', 6);

    expect(cache.get('large')).toBeNull();
    expect(cache.byteSize).toBe(0);
  });

  it('evicts LRU entries when total bytes fill before the entry limit', () => {
    const cache = new ResponseBodyCache(200, 10, 10);
    cache.set('a', '123456', false, 'text/plain', 6);
    cache.set('b', '78901', false, 'text/plain', 5);

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')?.body).toBe('78901');
    expect(cache.byteSize).toBe(5);
  });

  it('refreshes LRU order and resets byte accounting on clear', () => {
    const cache = new ResponseBodyCache(3, 8, 8);
    cache.set('a', '1111', false, 'text/plain', 4);
    cache.set('b', '2222', false, 'text/plain', 4);
    expect(cache.get('a')?.body).toBe('1111');

    cache.set('c', '3333', false, 'text/plain', 4);
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')?.body).toBe('1111');
    expect(cache.get('c')?.body).toBe('3333');

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.byteSize).toBe(0);
  });

  it('accounts UTF-8 and base64 bodies by decoded bytes', () => {
    const cache = new ResponseBodyCache(10, 7, 7);
    cache.set('utf8', '你好', false, 'text/plain', 6);
    cache.set('base64', Buffer.from('ab').toString('base64'), true, 'application/octet-stream', 2);

    expect(cache.get('utf8')).toBeNull();
    expect(cache.get('base64')).not.toBeNull();
    expect(cache.byteSize).toBe(2);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const resolvePidState = vi.hoisted(() => ({
  resolveMemoryDomainPid: vi.fn(),
}));

vi.mock('../../../../src/server/domains/memory/pid-resolver', () => ({
  resolveMemoryDomainPid: resolvePidState.resolveMemoryDomainPid,
}));

import { BookmarkHandlers } from '../../../../src/server/domains/memory/handlers/bookmark';

describe('BookmarkHandlers', () => {
  let handlers: BookmarkHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    resolvePidState.resolveMemoryDomainPid.mockResolvedValue(1234);
    handlers = new BookmarkHandlers();
    // Clear any leftover bookmarks from previous tests (module-level store)
    await handlers.handleBookmarkDispatch({ action: 'clear', pid: 1234 });
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  describe('add and list bookmarks', () => {
    it('adds a bookmark with label and color, then lists it', async () => {
      // Add a bookmark
      const addResp = await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x7FF612340000',
        label: 'Player Health',
        color: '#FF0000',
      });
      const addParsed = parseResponse(addResp);

      expect(addParsed.success).toBe(true);
      expect(addParsed.action).toBe('add');
      expect(addParsed.label).toBe('Player Health');
      expect(addParsed.color).toBe('#FF0000');
      expect(addParsed.totalBookmarks).toBe(1);

      // List bookmarks
      const listResp = await handlers.handleBookmarkDispatch({
        action: 'list',
        pid: 1234,
      });
      const listParsed = parseResponse(listResp);

      expect(listParsed.success).toBe(true);
      expect(listParsed.totalBookmarks).toBe(1);
      expect(listParsed.bookmarks).toBeInstanceOf(Array);
      expect(listParsed.bookmarks[0].address).toBe('0x7ff612340000');
      expect(listParsed.bookmarks[0].label).toBe('Player Health');
      expect(listParsed.bookmarks[0].color).toBe('#FF0000');
    });

    it('adds, removes, and clears bookmarks correctly', async () => {
      // Add two bookmarks
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x10000000',
      });
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x20000000',
      });

      // List should show 2
      const listResp1 = await handlers.handleBookmarkDispatch({
        action: 'list',
        pid: 1234,
      });
      expect(parseResponse(listResp1).totalBookmarks).toBe(2);

      // Remove one
      const removeResp = await handlers.handleBookmarkDispatch({
        action: 'remove',
        pid: 1234,
        address: '0x10000000',
      });
      const removeParsed = parseResponse(removeResp);
      expect(removeParsed.removed).toBe(true);
      expect(removeParsed.totalBookmarks).toBe(1);

      // Clear all
      const clearResp = await handlers.handleBookmarkDispatch({
        action: 'clear',
        pid: 1234,
      });
      const clearParsed = parseResponse(clearResp);
      expect(clearParsed.cleared).toBe(1);

      // List should be empty
      const listResp2 = await handlers.handleBookmarkDispatch({
        action: 'list',
        pid: 1234,
      });
      expect(parseResponse(listResp2).totalBookmarks).toBe(0);
    });
  });

  describe('export bookmarks', () => {
    it('exports bookmarks as structured JSON with json string', async () => {
      // Add two bookmarks
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 9999,
        address: '0xAABB0000',
        label: 'Gold',
        color: '#FFD700',
      });
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 9999,
        address: '0xAABB0008',
        label: 'HP',
        color: '#FF0000',
      });

      const exportResp = await handlers.handleBookmarkDispatch({
        action: 'export',
        pid: 9999,
      });
      const parsed = parseResponse(exportResp);
      expect(parsed.success).toBe(true);
      expect(parsed.action).toBe('export');
      expect(parsed.pid).toBe(1234);
      expect(parsed.totalBookmarks).toBe(2);
      expect(parsed.bookmarks).toBeInstanceOf(Array);
      expect(parsed.bookmarks).toHaveLength(2);
      expect(parsed.bookmarksJson).toBeTypeOf('string');

      const parsedJson = JSON.parse(parsed.bookmarksJson);
      expect(parsedJson).toHaveLength(2);
      expect(parsedJson[0].address).toBe('0xaabb0000');
      expect(parsedJson[0].label).toBe('Gold');
      expect(parsedJson[1].address).toBe('0xaabb0008');
    });

    it('returns empty export for PID with no bookmarks', async () => {
      const exportResp = await handlers.handleBookmarkDispatch({
        action: 'export',
        pid: 7777,
      });
      const parsed = parseResponse(exportResp);
      expect(parsed.success).toBe(true);
      expect(parsed.totalBookmarks).toBe(0);
      expect(parsed.bookmarksJson).toBe('[]');
    });
  });
});

describe('BookmarkHandlers — dispatch validation and remaining branch paths', () => {
  let handlers: BookmarkHandlers;

  beforeEach(async () => {
    vi.clearAllMocks();
    resolvePidState.resolveMemoryDomainPid.mockResolvedValue(1234);
    handlers = new BookmarkHandlers();
    // Clear any leftover bookmarks from previous tests (module-level store)
    await handlers.handleBookmarkDispatch({ action: 'clear', pid: 1234 });
  });

  function parseResponse(response: any) {
    return JSON.parse((response.content[0] as any).text);
  }

  it('rejects a dispatch without a known action', async () => {
    const missing = parseResponse(await handlers.handleBookmarkDispatch({ pid: 1234 }));
    expect(missing.success).toBe(false);
    expect(missing.error).toContain('missing or invalid required argument "action"');

    const unknown = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'rename', pid: 1234 }),
    );
    expect(unknown.success).toBe(false);
    expect(unknown.error).toContain('rename');
  });

  it('rejects an add with a non-hex color', async () => {
    const resp = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x40000000',
        color: 'red',
      }),
    );
    expect(resp.success).toBe(false);
    expect(resp.error).toContain('hex color');
  });

  it('updates an existing bookmark in place, preserving label, color, and createdAt', async () => {
    const first = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x50000000',
        label: 'Health',
        color: '#00FF00',
      }),
    );
    expect(first.updated).toBe(false);
    expect(first.hint).toContain('Bookmarked');

    const listAfterFirst = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'list', pid: 1234 }),
    );
    expect(listAfterFirst.bookmarks[0].createdAt).toBeTypeOf('string');

    // Re-add the same address with no label/color — existing values must survive.
    const second = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0x50000000',
      }),
    );
    expect(second.updated).toBe(true);
    expect(second.totalBookmarks).toBe(1);
    expect(second.label).toBe('Health');
    expect(second.color).toBe('#00FF00');
    expect(second.hint).toContain('Updated');

    const listAfterSecond = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'list', pid: 1234 }),
    );
    expect(listAfterSecond.totalBookmarks).toBe(1);
    expect(listAfterSecond.bookmarks[0].label).toBe('Health');
    expect(listAfterSecond.bookmarks[0].createdAt).toBe(listAfterFirst.bookmarks[0].createdAt);
  });

  it('normalizes hex letter case when matching addresses', async () => {
    const add = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'add',
        pid: 1234,
        address: '0xABCD0000', // uppercase hex digits (validateHexAddress rejects a "0X" prefix)
      }),
    );
    expect(add.address).toBe('0xabcd0000');

    // No label was given → list maps it to null.
    const list = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'list', pid: 1234 }),
    );
    expect(list.bookmarks[0].address).toBe('0xabcd0000');
    expect(list.bookmarks[0].label).toBeNull();

    // Lowercase no-prefix form must hit the same entry (bookmarkKey strips 0x case-insensitively).
    const remove = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'remove',
        pid: 1234,
        address: 'abcd0000',
      }),
    );
    expect(remove.removed).toBe(true);
  });

  it('reports a miss when removing from a PID with no bookmarks', async () => {
    const resp = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'remove',
        pid: 1234,
        address: '0x60000000',
      }),
    );
    expect(resp.success).toBe(true);
    expect(resp.removed).toBe(false);
    expect(resp.totalBookmarks).toBe(0);
    expect(resp.hint).toContain('No bookmarks found for PID');
  });

  it('reports a miss when the address is not bookmarked but the PID has bookmarks', async () => {
    await handlers.handleBookmarkDispatch({
      action: 'add',
      pid: 1234,
      address: '0x70000000',
    });
    const resp = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'remove',
        pid: 1234,
        address: '0x71000000',
      }),
    );
    expect(resp.removed).toBe(false);
    expect(resp.totalBookmarks).toBe(1);
    expect(resp.hint).toContain('No bookmark found at');
  });

  it('drops the PID store when the last bookmark is removed', async () => {
    await handlers.handleBookmarkDispatch({
      action: 'add',
      pid: 1234,
      address: '0x80000000',
    });
    const remove = parseResponse(
      await handlers.handleBookmarkDispatch({
        action: 'remove',
        pid: 1234,
        address: '0x80000000',
      }),
    );
    expect(remove.removed).toBe(true);
    expect(remove.totalBookmarks).toBe(0);
    expect(remove.hint).toContain('0 remaining');

    const list = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'list', pid: 1234 }),
    );
    expect(list.totalBookmarks).toBe(0);
    expect(list.hint).toContain("Use action='add'");
  });

  it('returns an empty list with a hint for a PID without bookmarks', async () => {
    const list = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'list', pid: 1234 }),
    );
    expect(list.success).toBe(true);
    expect(list.bookmarks).toEqual([]);
    expect(list.totalBookmarks).toBe(0);
    expect(list.hint).toContain("Use action='add'");
  });

  it('reports zero when clearing a PID without bookmarks', async () => {
    const resp = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'clear', pid: 1234 }),
    );
    expect(resp.success).toBe(true);
    expect(resp.cleared).toBe(0);
    expect(resp.hint).toContain('No bookmarks to clear');
  });

  it('lists bookmarks sorted by address', async () => {
    await handlers.handleBookmarkDispatch({ action: 'add', pid: 1234, address: '0xC0000000' });
    await handlers.handleBookmarkDispatch({ action: 'add', pid: 1234, address: '0xA0000000' });
    await handlers.handleBookmarkDispatch({ action: 'add', pid: 1234, address: '0xB0000000' });

    const list = parseResponse(
      await handlers.handleBookmarkDispatch({ action: 'list', pid: 1234 }),
    );
    const addresses = (list.bookmarks as Array<{ address: string }>).map((b) => b.address);
    expect(addresses).toEqual(['0xa0000000', '0xb0000000', '0xc0000000']);
  });
});

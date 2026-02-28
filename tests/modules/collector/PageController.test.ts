import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { PageController } from '../../../src/modules/collector/PageController.js';

describe('PageController', () => {
  let page: any;
  let collector: any;
  let controller: PageController;

  beforeEach(() => {
    page = {
      goto: vi.fn().mockResolvedValue(undefined),
      title: vi.fn().mockResolvedValue('Demo'),
      url: vi.fn().mockReturnValue('https://example.com/final'),
      click: vi.fn().mockResolvedValue(undefined),
      evaluate: vi.fn(),
      waitForSelector: vi.fn().mockResolvedValue(undefined),
      setViewport: vi.fn().mockResolvedValue(undefined),
      setUserAgent: vi.fn().mockResolvedValue(undefined),
      $: vi.fn(),
    };
    collector = { getActivePage: vi.fn().mockResolvedValue(page) };
    controller = new PageController(collector);
  });

  it('navigates with defaults and returns page metadata', async () => {
    const result = await controller.navigate('https://example.com');

    expect(page.goto).toHaveBeenCalledWith('https://example.com', {
      waitUntil: 'networkidle2',
      timeout: 30000,
    });
    expect(result.url).toBe('https://example.com/final');
    expect(result.title).toBe('Demo');
  });

  it('click uses default click options', async () => {
    await controller.click('#submit');

    expect(page.click).toHaveBeenCalledWith('#submit', {
      button: 'left',
      clickCount: 1,
      delay: undefined,
    });
  });

  it('waitForSelector returns success payload when element appears', async () => {
    page.evaluate.mockResolvedValue({ tagName: 'button', id: 'submit' });

    const result = await controller.waitForSelector('#submit', 1000);
    expect(result.success).toBe(true);
    expect(result.element?.id).toBe('submit');
  });

  it('waitForSelector returns failure payload on timeout', async () => {
    page.waitForSelector.mockRejectedValue(new Error('timeout'));

    const result = await controller.waitForSelector('#missing', 10);
    expect(result.success).toBe(false);
    expect(result.message).toContain('Timeout waiting for selector');
  });

  it('emulateDevice resolves aliases and applies device settings', async () => {
    const resolved = await controller.emulateDevice('iPhone 13 Pro');

    expect(resolved).toBe('iPhone');
    expect(page.setViewport).toHaveBeenCalled();
    expect(page.setUserAgent).toHaveBeenCalled();
  });

  it('emulateDevice rejects unsupported device names', async () => {
    await expect(controller.emulateDevice('BlackBerry Classic')).rejects.toThrow(
      'Unsupported device'
    );
  });

  it('uploadFile throws when file input element is missing', async () => {
    page.$.mockResolvedValue(null);

    await expect(controller.uploadFile('#upload', 'D:/tmp/a.txt')).rejects.toThrow(
      'File input not found'
    );
  });
});


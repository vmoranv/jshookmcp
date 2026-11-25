export const PAGE_NAVIGATION_WAIT_UNTIL_VALUES = [
  'load',
  'domcontentloaded',
  'networkidle',
  'commit',
] as const;

export type PageNavigationWaitUntil = (typeof PAGE_NAVIGATION_WAIT_UNTIL_VALUES)[number];

export function toChromeCompatibleWaitUntil(
  waitUntil: PageNavigationWaitUntil = 'networkidle',
): 'load' | 'domcontentloaded' | 'networkidle2' {
  if (waitUntil === 'networkidle') return 'networkidle2';
  // Puppeteer has no 'commit' lifecycle event, so it degrades to waiting for the
  // full `load` event. This is slower than 'commit' on heavy pages (the
  // Playwright/Camoufox path passes 'commit' through untouched), which is why
  // it is called out here rather than silently mapped to 'domcontentloaded'
  // (closer in timing but a different completion guarantee).
  if (waitUntil === 'commit') return 'load';
  return waitUntil;
}

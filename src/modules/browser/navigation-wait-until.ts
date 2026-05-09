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
  if (waitUntil === 'commit') return 'load';
  return waitUntil;
}

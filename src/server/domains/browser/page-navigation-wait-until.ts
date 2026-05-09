import { argEnum } from '@server/domains/shared/parse-args';
import {
  PAGE_NAVIGATION_WAIT_UNTIL_VALUES,
  type PageNavigationWaitUntil,
} from '@modules/browser/navigation-wait-until';

const PAGE_NAVIGATION_WAIT_UNTIL_SET = new Set<PageNavigationWaitUntil>(
  PAGE_NAVIGATION_WAIT_UNTIL_VALUES,
);

export function parsePageNavigationWaitUntil(
  args: Record<string, unknown>,
): PageNavigationWaitUntil {
  return argEnum(args, 'waitUntil', PAGE_NAVIGATION_WAIT_UNTIL_SET, 'networkidle');
}

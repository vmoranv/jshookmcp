/**
 * StealthVerifier — offline anti-detection consistency checks.
 *
 * Runs verification scripts via page.evaluate() to check that
 * stealth patches are working correctly. Returns structured results
 * that the AI can parse programmatically.
 */

import { type Page } from 'rebrowser-puppeteer-core';

export interface StealthCheck {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

export interface StealthCheckResult {
  passed: boolean;
  checks: StealthCheck[];
  score: number;
  passedCount: number;
  totalCount: number;
  recommendations: string[];
}

export class StealthVerifier {
  /**
   * Run all anti-detection checks on the given page.
   * Should be called AFTER stealth_inject for meaningful results.
   */
  async verify(page: Page): Promise<StealthCheckResult> {
    const checks: StealthCheck[] = await page.evaluate(async () => {
      const results: Array<{ name: string; passed: boolean; expected: string; actual: string }> =
        [];

      // 1. navigator.webdriver should be undefined
      const wd = (navigator as unknown as Record<string, unknown>).webdriver;
      results.push({
        name: 'navigator.webdriver',
        passed: wd === undefined || wd === false,
        expected: 'undefined',
        actual: String(wd),
      });

      // 2. window.chrome should exist
      const win = window as unknown as Record<string, unknown>;
      const hasChrome = typeof win.chrome === 'object' && win.chrome !== null;
      results.push({
        name: 'window.chrome',
        passed: hasChrome,
        expected: 'object',
        actual: typeof win.chrome,
      });

      // 3. chrome.app.isInstalled should exist
      const chromeApp = hasChrome ? (win.chrome as Record<string, unknown>).app : null;
      const hasAppIsInstalled =
        chromeApp && typeof chromeApp === 'object' && 'isInstalled' in chromeApp;
      results.push({
        name: 'chrome.app.isInstalled',
        passed: Boolean(hasAppIsInstalled),
        expected: 'exists (false)',
        actual: hasAppIsInstalled
          ? String((chromeApp as Record<string, unknown>).isInstalled)
          : 'missing',
      });

      // 4. navigator.plugins.length >= 3
      const pluginCount = navigator.plugins?.length ?? 0;
      results.push({
        name: 'navigator.plugins',
        passed: pluginCount >= 3,
        expected: '>= 3',
        actual: String(pluginCount),
      });

      // 5. navigator.languages should not be empty
      const langs = navigator.languages;
      results.push({
        name: 'navigator.languages',
        passed: langs.length > 0,
        expected: 'non-empty',
        actual: JSON.stringify(langs),
      });

      // 6. navigator.platform vs UA consistency
      const ua = navigator.userAgent;
      const platform = navigator.platform;
      let platformConsistent = true;
      if (ua.includes('Windows') && !platform.includes('Win')) platformConsistent = false;
      if (ua.includes('Macintosh') && !platform.includes('Mac')) platformConsistent = false;
      if (ua.includes('Linux') && !platform.includes('Linux')) platformConsistent = false;
      results.push({
        name: 'platform/UA consistency',
        passed: platformConsistent,
        expected: 'consistent',
        actual: `UA=${ua.substring(0, 50)}... platform=${platform}`,
      });

      // 7. WebGL vendor should not be empty
      let webglVendor = 'unavailable';
      try {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl');
        if (gl) {
          const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            webglVendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'empty';
          }
        }
      } catch {
        webglVendor = 'error';
      }
      results.push({
        name: 'WebGL vendor',
        passed: webglVendor !== 'empty' && webglVendor !== 'error',
        expected: 'non-empty vendor string',
        actual: webglVendor,
      });

      // 8. No cdc_ properties on document
      const docKeys = Object.keys(document);
      const cdcKeys = docKeys.filter((k) => k.startsWith('cdc_') || k.startsWith('$cdc_'));
      results.push({
        name: 'cdc_ variables',
        passed: cdcKeys.length === 0,
        expected: 'none',
        actual: cdcKeys.length === 0 ? 'none' : cdcKeys.join(', '),
      });

      // 9. navigator.hardwareConcurrency >= 4
      const hwc = navigator.hardwareConcurrency ?? 0;
      results.push({
        name: 'hardwareConcurrency',
        passed: hwc >= 4,
        expected: '>= 4',
        actual: String(hwc),
      });

      // 10. navigator.deviceMemory exists and >= 4
      const dm = (navigator as unknown as Record<string, unknown>).deviceMemory as
        | number
        | undefined;
      results.push({
        name: 'deviceMemory',
        passed: dm !== undefined && dm >= 4,
        expected: '>= 4',
        actual: String(dm ?? 'undefined'),
      });

      // 11. Playwright command-line API marker should not leak
      const commandLineApi = (window as unknown as Record<string, unknown>)['__commandLineAPI'];
      results.push({
        name: '__commandLineAPI',
        passed: commandLineApi === undefined,
        expected: 'undefined',
        actual: typeof commandLineApi,
      });

      // 12. Playwright init scripts marker should not leak
      const pwInitScripts = (window as unknown as Record<string, unknown>)['__pwInitScripts'];
      results.push({
        name: '__pwInitScripts',
        passed: pwInitScripts === undefined,
        expected: 'undefined',
        actual: typeof pwInitScripts,
      });

      // 13. chrome.runtime.id should not expose extension IDs by default
      const chromeRuntimeId =
        hasChrome && typeof (win.chrome as Record<string, unknown>).runtime === 'object'
          ? ((win.chrome as Record<string, unknown>).runtime as Record<string, unknown>).id
          : undefined;
      results.push({
        name: 'chrome.runtime.id',
        passed: chromeRuntimeId === undefined,
        expected: 'undefined',
        actual: String(chromeRuntimeId ?? 'undefined'),
      });

      // 14. Error stack should not include Playwright/Puppeteer markers
      let stackLeak = 'clean';
      try {
        const err = new Error('stealth-check');
        const stack = String(err.stack ?? '');
        const lowered = stack.toLowerCase();
        if (
          lowered.includes('playwright') ||
          lowered.includes('puppeteer') ||
          lowered.includes('__pw')
        )
          stackLeak = 'detected';
      } catch {
        stackLeak = 'error';
      }
      results.push({
        name: 'Error.stack leak',
        passed: stackLeak === 'clean',
        expected: 'clean',
        actual: stackLeak,
      });

      // 15. Notification permission and Permissions API should agree
      let permissionState = 'unsupported';
      try {
        const permissions = (navigator as unknown as Record<string, unknown>).permissions as
          | { query?: (input: { name: string }) => Promise<{ state?: string }> }
          | undefined;
        if (permissions?.query) {
          const result = await permissions.query({ name: 'notifications' });
          permissionState = String(result?.state ?? 'unknown');
        }
      } catch {
        permissionState = 'error';
      }
      const notificationPermission =
        typeof Notification === 'object' && Notification !== null
          ? String((Notification as { permission?: string }).permission ?? 'unknown')
          : 'unknown';
      const permissionConsistent =
        permissionState === 'unsupported' ||
        permissionState === 'error' ||
        permissionState === notificationPermission;
      results.push({
        name: 'permissions consistency',
        passed: permissionConsistent,
        expected: 'matches Notification.permission',
        actual: `permissions=${permissionState} notification=${notificationPermission}`,
      });

      return results;
    });

    const passedCount = checks.filter((c) => c.passed).length;
    const totalCount = checks.length;
    const score = Math.round((passedCount / totalCount) * 100);

    const recommendations: string[] = [];
    for (const check of checks) {
      if (!check.passed) {
        switch (check.name) {
          case 'navigator.webdriver':
            recommendations.push('Run stealth_inject to hide navigator.webdriver');
            break;
          case 'window.chrome':
            recommendations.push('Run stealth_inject to inject window.chrome object');
            break;
          case 'chrome.app.isInstalled':
            recommendations.push('Update stealth scripts to include chrome.app structure');
            break;
          case 'navigator.plugins':
            recommendations.push('Run stealth_inject to restore navigator.plugins');
            break;
          case 'platform/UA consistency':
            recommendations.push(
              'Run stealth_set_user_agent with matching platform before stealth_inject',
            );
            break;
          case 'cdc_ variables':
            recommendations.push('Run stealth_inject to clean up ChromeDriver cdc_ variables');
            break;
          case '__commandLineAPI':
            recommendations.push('Remove leaked Playwright command-line globals before navigation');
            break;
          case '__pwInitScripts':
            recommendations.push('Remove leaked Playwright init-script globals before navigation');
            break;
          case 'chrome.runtime.id':
            recommendations.push('Do not expose chrome.runtime.id unless an extension is expected');
            break;
          case 'Error.stack leak':
            recommendations.push('Patch stack traces to avoid Playwright or Puppeteer markers');
            break;
          case 'permissions consistency':
            recommendations.push('Keep navigator.permissions and Notification.permission in sync');
            break;
          default:
            recommendations.push(
              `Fix: ${check.name} — expected ${check.expected}, got ${check.actual}`,
            );
        }
      }
    }

    return {
      passed: passedCount === totalCount,
      checks,
      score,
      passedCount,
      totalCount,
      recommendations,
    };
  }
}

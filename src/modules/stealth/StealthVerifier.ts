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

      // Local collector shared by the groups below. Everything in this callback
      // is serialised into the page context, so none of it can be hoisted to
      // module scope — the groups exist to keep each function readable, not to
      // share code across the boundary.
      const add = (name: string, passed: boolean, expected: string, actual: string): void => {
        results.push({ name, passed, expected, actual });
      };
      // ── navigator / window surface ──
      const collectNavigatorChecks = (): void => {
        // 1. navigator.webdriver should be undefined
        const wd = (navigator as unknown as Record<string, unknown>).webdriver;
        add('navigator.webdriver', wd === undefined || wd === false, 'undefined', String(wd));

        // 2. window.chrome should exist
        const win = window as unknown as Record<string, unknown>;
        const hasChrome = typeof win.chrome === 'object' && win.chrome !== null;
        add('window.chrome', hasChrome, 'object', typeof win.chrome);

        // 3. chrome.app.isInstalled should exist
        const chromeApp = hasChrome ? (win.chrome as Record<string, unknown>).app : null;
        const hasAppIsInstalled =
          chromeApp && typeof chromeApp === 'object' && 'isInstalled' in chromeApp;
        add(
          'chrome.app.isInstalled',
          Boolean(hasAppIsInstalled),
          'exists (false)',
          hasAppIsInstalled
            ? String((chromeApp as Record<string, unknown>).isInstalled)
            : 'missing',
        );

        // 4. navigator.plugins.length >= 3
        const pluginCount = navigator.plugins?.length ?? 0;
        add('navigator.plugins', pluginCount >= 3, '>= 3', String(pluginCount));

        // 5. navigator.languages should not be empty
        const langs = navigator.languages;
        add('navigator.languages', langs.length > 0, 'non-empty', JSON.stringify(langs));

        // 6. navigator.platform vs UA consistency
        const ua = navigator.userAgent;
        const platform = navigator.platform;
        let platformConsistent = true;
        if (ua.includes('Windows') && !platform.includes('Win')) platformConsistent = false;
        if (ua.includes('Macintosh') && !platform.includes('Mac')) platformConsistent = false;
        if (ua.includes('Linux') && !platform.includes('Linux')) platformConsistent = false;
        add(
          'platform/UA consistency',
          platformConsistent,
          'consistent',
          `UA=${ua.substring(0, 50)}... platform=${platform}`,
        );

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
        add(
          'WebGL vendor',
          webglVendor !== 'empty' && webglVendor !== 'error',
          'non-empty vendor string',
          webglVendor,
        );
      };

      // ── document markers, CPU/memory, debugger leaks ──
      const collectEnvironmentChecks = (): void => {
        // 8. No cdc_ properties on document
        const docKeys = Object.keys(document);
        const cdcKeys = docKeys.filter((k) => k.startsWith('cdc_') || k.startsWith('$cdc_'));
        add(
          'cdc_ variables',
          cdcKeys.length === 0,
          'none',
          cdcKeys.length === 0 ? 'none' : cdcKeys.join(', '),
        );

        // 9. navigator.hardwareConcurrency >= 4
        const hwc = navigator.hardwareConcurrency ?? 0;
        add('hardwareConcurrency', hwc >= 4, '>= 4', String(hwc));

        // 10. navigator.deviceMemory exists and >= 4
        const dm = (navigator as unknown as Record<string, unknown>).deviceMemory as
          | number
          | undefined;
        add('deviceMemory', dm !== undefined && dm >= 4, '>= 4', String(dm ?? 'undefined'));
      };

      // ── runtime id, stack traces, permission agreement ──
      const collectBehaviourChecks = async (): Promise<void> => {
        // 11. Playwright command-line API marker should not leak
        const commandLineApi = (window as unknown as Record<string, unknown>)['__commandLineAPI'];
        add('__commandLineAPI', commandLineApi === undefined, 'undefined', typeof commandLineApi);

        // 12. Playwright init scripts marker should not leak
        const pwInitScripts = (window as unknown as Record<string, unknown>)['__pwInitScripts'];
        add('__pwInitScripts', pwInitScripts === undefined, 'undefined', typeof pwInitScripts);

        // 13. chrome.runtime.id should not expose extension IDs by default
        // Recompute the chrome surface here: `win`/`hasChrome` belong to the
        // navigator group and are not in scope across the group boundary.
        const winForRuntime = window as unknown as Record<string, unknown>;
        const hasChromeForRuntime =
          typeof winForRuntime.chrome === 'object' && winForRuntime.chrome !== null;
        const chromeRuntimeId =
          hasChromeForRuntime &&
          typeof (winForRuntime.chrome as Record<string, unknown>).runtime === 'object'
            ? ((winForRuntime.chrome as Record<string, unknown>).runtime as Record<string, unknown>)
                .id
            : undefined;
        add(
          'chrome.runtime.id',
          chromeRuntimeId === undefined,
          'undefined',
          String(chromeRuntimeId ?? 'undefined'),
        );

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
        add('Error.stack leak', stackLeak === 'clean', 'clean', stackLeak);

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
        add(
          'permissions consistency',
          permissionConsistent,
          'matches Notification.permission',
          `permissions=${permissionState} notification=${notificationPermission}`,
        );
      };

      // Group order defines check order in the returned array.
      collectNavigatorChecks();
      collectEnvironmentChecks();
      await collectBehaviourChecks();

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

import { logger } from '../../../utils/logger.js';
import { PRESETS, PRESET_LIST } from './preset-definitions.js';

interface HookablePage {
  evaluateOnNewDocument(code: string): Promise<unknown>;
  evaluate(code: string): Promise<unknown>;
}

interface PageControllerLike {
  getPage(): Promise<HookablePage>;
}

export class HookPresetToolHandlers {
  private pageController: PageControllerLike;

  constructor(pageController: PageControllerLike) {
    this.pageController = pageController;
  }

  async handleHookPreset(args: Record<string, unknown>) {
    try {
      if (args.listPresets === true) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  totalPresets: PRESET_LIST.length,
                  presets: PRESET_LIST,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const captureStack = (args.captureStack as boolean) ?? false;
      const logToConsole = (args.logToConsole as boolean) ?? true;
      const method = (args.method as string) || 'evaluate';

      let targets: string[] = [];
      if (args.preset) {
        targets = [args.preset as string];
      } else if (Array.isArray(args.presets)) {
        targets = args.presets as string[];
      } else {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error:
                    ' Provide either preset (single) or presets (multiple), or set listPresets=true to list available presets',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const invalid = targets.filter((t) => !PRESETS[t]);
      if (invalid.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: `: ${invalid.join(', ')}`,
                  availablePresets: PRESET_LIST.map((p) => p.id),
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const page = await this.pageController.getPage();
      const injected: string[] = [];
      const errors: Array<{ preset: string; error: string }> = [];

      for (const presetId of targets) {
        try {
          const code = PRESETS[presetId]!.buildCode(captureStack, logToConsole);
          if (method === 'evaluateOnNewDocument') {
            await page.evaluateOnNewDocument(code);
          } else {
            await page.evaluate(code);
          }
          injected.push(presetId);
          logger.info(` Hook preset injected: ${presetId}`);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          errors.push({ preset: presetId, error: errorMessage });
          logger.error(` Failed to inject preset ${presetId}:`, err);
        }
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: errors.length === 0,
                injected,
                failed: errors,
                method,
                captureStack,
                message: ` ${injected.length}/${targets.length}  Hook`,
                usage: ` ai_hook_get_data(hookId: "preset-<>") `,
              },
              null,
              2
            ),
          },
        ],
      };
    } catch (error) {
      logger.error('Hook preset injection failed', error);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                success: false,
                error: error instanceof Error ? error.message : String(error),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  }
}

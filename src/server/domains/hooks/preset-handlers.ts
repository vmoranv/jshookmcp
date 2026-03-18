import { logger } from '@utils/logger';
import { PRESETS, PRESET_LIST } from '@server/domains/hooks/preset-definitions';
import { buildHookCode, type PresetEntry } from '@server/domains/hooks/preset-builder';
import { argBool, argString, argStringArray } from '@server/domains/shared/parse-args';

interface HookablePage {
  evaluateOnNewDocument(code: string): Promise<unknown>;
  evaluate(code: string): Promise<unknown>;
}

interface PageControllerLike {
  getPage(): Promise<HookablePage>;
}

interface InlineCustomTemplate {
  id?: string;
  description?: string;
  body?: string;
}

export class HookPresetToolHandlers {
  private pageController: PageControllerLike;

  constructor(pageController: PageControllerLike) {
    this.pageController = pageController;
  }

  async handleHookPreset(args: Record<string, unknown>) {
    try {
      const customPresetMap = this.buildCustomPresetMap(args);
      const availablePresets: Record<string, PresetEntry> = {
        ...PRESETS,
        ...customPresetMap,
      };
      const availablePresetList = [
        ...PRESET_LIST,
        ...Object.entries(customPresetMap).map(([id, preset]) => ({
          id,
          description: `${preset.description} (custom)`,
        })),
      ];

      if (args.listPresets === true) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  totalPresets: availablePresetList.length,
                  presets: availablePresetList,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const captureStack = argBool(args, 'captureStack', false);
      const logToConsole = argBool(args, 'logToConsole', true);
      const method = argString(args, 'method', 'evaluate');

      let targets: string[] = [];
      if (args.preset) {
        targets = [argString(args, 'preset')!];
      } else if (Array.isArray(args.presets)) {
        targets = argStringArray(args, 'presets');
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

      const invalid = targets.filter((t) => !availablePresets[t]);
      if (invalid.length > 0) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: false,
                  error: `: ${invalid.join(', ')}`,
                  availablePresets: availablePresetList.map((p) => p.id),
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
          const code = availablePresets[presetId]!.buildCode(captureStack, logToConsole);
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

  private buildCustomPresetMap(args: Record<string, unknown>): Record<string, PresetEntry> {
    const rawTemplates: InlineCustomTemplate[] = [];
    if (args.customTemplate && typeof args.customTemplate === 'object') {
      rawTemplates.push(args.customTemplate as InlineCustomTemplate);
    }
    if (Array.isArray(args.customTemplates)) {
      rawTemplates.push(...(args.customTemplates as InlineCustomTemplate[]));
    }

    const customPresets: Record<string, PresetEntry> = {};
    for (const template of rawTemplates) {
      const id = template.id?.trim();
      const body = template.body?.trim();
      if (!id || !body) {
        throw new Error('Each custom template requires non-empty id and body');
      }
      if (PRESETS[id]) {
        throw new Error(`Custom template id conflicts with built-in preset: ${id}`);
      }
      customPresets[id] = {
        description: template.description?.trim() || `Custom inline preset: ${id}`,
        buildCode: (captureStack, logToConsole) =>
          buildHookCode(id, body, captureStack, logToConsole),
      };
    }
    return customPresets;
  }
}

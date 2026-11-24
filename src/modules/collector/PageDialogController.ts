/** Dialog handling for a managed page. */
import type { Page } from 'rebrowser-puppeteer-core';
import type { CodeCollector } from '@modules/collector/CodeCollector';
import { PAGE_OPERATION_TIMEOUT_MS } from '@src/constants';
import { logger } from '@utils/logger';

export interface DialogHandlerOptions {
  accept?: boolean;
  promptText?: string;
  dismissAll?: boolean;
}

/** Auto-dismiss any dialog (dialog may already be closed). */
export async function dismissDialog(dialog: { dismiss: () => Promise<void> }): Promise<void> {
  try {
    await dialog.dismiss();
  } catch {
    // Ignore — dialog may already be closed
  }
}

export class PageDialogController {
  private readonly collector: CodeCollector;
  /** Installed auto-dismiss dialog handlers per page — re-registering the
   *  same page must not stack listeners (page.on is never auto-removed). */
  private readonly dialogDismissHandlers = new WeakMap<
    Page,
    (dialog: { dismiss: () => Promise<void> }) => Promise<void>
  >();

  constructor(collector: CodeCollector) {
    this.collector = collector;
  }

  async handleDialog(options: DialogHandlerOptions = {}): Promise<{
    handled: boolean;
    message: string;
    type?: string;
    dialogMessage?: string;
  }> {
    const page = await this.collector.getActivePage();
    const accept = options.accept !== false;
    const dismissAll = options.dismissAll !== false;
    const promptText = options.promptText;

    const handleSingle = (dialog: {
      type: () => string;
      message: () => string;
      accept: (promptText?: string) => Promise<void>;
      dismiss: () => Promise<void>;
    }): Promise<{ type: string; dialogMessage: string }> => {
      const dialogType = dialog.type();
      const dialogMessage = dialog.message();
      if (accept) {
        if (dialogType === 'prompt' && promptText !== undefined) {
          return dialog.accept(promptText).then(() => ({ type: dialogType, dialogMessage }));
        }
        return dialog.accept().then(() => ({ type: dialogType, dialogMessage }));
      }
      return dialog.dismiss().then(() => ({ type: dialogType, dialogMessage }));
    };

    if (dismissAll) {
      const existing = this.dialogDismissHandlers.get(page);
      if (existing) {
        page.off('dialog', existing);
      }
      this.dialogDismissHandlers.set(page, dismissDialog);
      page.on('dialog', dismissDialog);
      return {
        handled: true,
        message: 'Persistent dialog handler installed — all future dialogs will be auto-dismissed.',
      };
    }

    try {
      const result = await new Promise<{ type: string; dialogMessage: string }>(
        (resolve, reject) => {
          // Keep the exact handler reference so it can be removed on timeout as
          // well as on fire; page.once() leaves a stale handler attached when no
          // dialog arrives and would later swallow an unrelated dialog.
          const onDialog = async (dialog: {
            type: () => string;
            message: () => string;
            accept: (promptText?: string) => Promise<void>;
            dismiss: () => Promise<void>;
          }): Promise<void> => {
            clearTimeout(timeout);
            page.off('dialog', onDialog);
            try {
              resolve(await handleSingle(dialog));
            } catch (err) {
              reject(err);
            }
          };

          const timeout = setTimeout(() => {
            page.off('dialog', onDialog);
            reject(
              new Error(
                `Timed out waiting for a dialog (${PAGE_OPERATION_TIMEOUT_MS / 1000}s). No dialog appeared.`,
              ),
            );
          }, PAGE_OPERATION_TIMEOUT_MS);

          page.on('dialog', onDialog);
        },
      );

      const verb = accept ? 'accepted' : 'dismissed';
      return {
        handled: true,
        message: `${verb} ${result.type} dialog${result.dialogMessage ? `: "${result.dialogMessage}"` : ''}`,
        type: result.type,
        dialogMessage: result.dialogMessage || undefined,
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.warn(`Dialog handler: ${errMsg}`);
      return { handled: false, message: errMsg };
    }
  }
}

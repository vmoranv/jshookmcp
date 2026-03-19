import { logger } from '@utils/logger';
import { WorkflowHandlersAccountBundle } from '@server/domains/workflow/handlers.impl.workflow-account-bundle';
import {
  WORKFLOW_BATCH_MAX_RETRIES,
  WORKFLOW_BATCH_MAX_BACKOFF_MS,
  WORKFLOW_BATCH_MAX_TIMEOUT_MS,
  WORKFLOW_BATCH_RETRY_BACKOFF_MS,
  WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS,
  WORKFLOW_BATCH_MAX_ACCOUNTS,
  WORKFLOW_BATCH_MAX_CONCURRENCY,
} from '@src/constants';
import { argNumber, argString, argObject, argStringArray } from '@server/domains/shared/parse-args';

/**
 * Batch account registration handler.
 *
 * Executes register_account_flow for multiple accounts **sequentially**
 * (concurrent execution is unsafe because all flows share a single browser
 * page and use fixed tab aliases — see CRITICAL C4 in review).
 *
 * Features:
 * - Per-account retry with capped exponential backoff
 * - Idempotent key (email/username) to skip already-succeeded accounts
 * - Timeout with cleanup (clearTimeout to avoid timer leak)
 * - Hard caps on all tuneable parameters
 * - Aggregated success/failure summary
 */

/* ── Constants ────────────────────────────────────────────────────────── */
const BATCH_MAX_ACCOUNTS = WORKFLOW_BATCH_MAX_ACCOUNTS;
const BATCH_MAX_CONCURRENCY = WORKFLOW_BATCH_MAX_CONCURRENCY;

const MAX_RETRIES = WORKFLOW_BATCH_MAX_RETRIES;
const MAX_BACKOFF_MS = WORKFLOW_BATCH_MAX_BACKOFF_MS;
const MAX_TIMEOUT_MS = WORKFLOW_BATCH_MAX_TIMEOUT_MS;

export class WorkflowHandlersBatch extends WorkflowHandlersAccountBundle {
  async handleBatchRegister(args: Record<string, unknown>) {
    const registerUrl = argString(args, 'registerUrl', '');
    const rawAccounts = args.accounts;
    let accounts: Array<Record<string, unknown>> = Array.isArray(rawAccounts) ? rawAccounts : [];
    // Hard cap on account count
    if (accounts.length > BATCH_MAX_ACCOUNTS) {
      accounts = accounts.slice(0, BATCH_MAX_ACCOUNTS);
    }
    // Force serial execution because the flow shares a page instance and fixed tab aliases.
    const maxConcurrency = Math.min(
      Math.max(1, argNumber(args, 'maxConcurrency', 1)),
      BATCH_MAX_CONCURRENCY
    );
    const maxRetries = Math.min(Math.max(0, argNumber(args, 'maxRetries', 1)), MAX_RETRIES);
    const retryBackoffMs = Math.max(
      0,
      argNumber(args, 'retryBackoffMs', WORKFLOW_BATCH_RETRY_BACKOFF_MS)
    );
    const timeoutPerAccountMs = Math.min(
      Math.max(5000, argNumber(args, 'timeoutPerAccountMs', WORKFLOW_BATCH_TIMEOUT_PER_ACCOUNT_MS)),
      MAX_TIMEOUT_MS
    );
    const defaultSubmitSelector = argString(args, 'submitSelector', "button[type='submit']");

    if (!registerUrl || accounts.length === 0) {
      return this.jsonTextResult({
        success: false,
        error: 'registerUrl and accounts[] are required',
      });
    }

    // Idempotent tracking: keyed by email or first field value
    const succeeded = new Set<string>();
    const results: Array<{
      index: number;
      idempotentKey: string;
      success: boolean;
      attempts: number;
      result?: unknown;
      error?: string;
    }> = [];

    const getIdempotentKey = (acct: Record<string, unknown>, globalIdx: number): string => {
      const fields = argObject(acct, 'fields') as Record<string, string> | undefined;
      if (!fields) return `account-${globalIdx}`;
      return (
        fields.email ??
        fields.username ??
        fields.name ??
        Object.values(fields)[0] ??
        `account-${globalIdx}`
      );
    };

    /** Mask PII for logging (show first 2 + last 2 chars) */
    const maskKey = (key: string): string => {
      if (key.length <= 6) return key.charAt(0) + '***' + key.charAt(key.length - 1);
      return key.slice(0, 2) + '***' + key.slice(-2);
    };

    // Chunk by maxConcurrency (forced to 1 — shared page)
    for (let i = 0; i < accounts.length; i += maxConcurrency) {
      const chunk = accounts.slice(i, i + maxConcurrency);

      const chunkPromises = chunk.map(async (acct, chunkIdx) => {
        const globalIdx = i + chunkIdx;
        const idempotentKey = getIdempotentKey(acct, globalIdx);

        // Skip already-succeeded accounts (idempotency)
        if (succeeded.has(idempotentKey)) {
          results.push({
            index: globalIdx,
            idempotentKey: maskKey(idempotentKey),
            success: true,
            attempts: 0,
            result: { skipped: true, reason: 'already_succeeded' },
          });
          return;
        }

        const acctFields = (argObject(acct, 'fields') ?? {}) as Record<string, string>;
        const acctSubmitSelector = argString(acct, 'submitSelector', defaultSubmitSelector);
        const acctEmailProviderUrl = argString(acct, 'emailProviderUrl');
        const acctEmailSelector = argString(acct, 'emailSelector');
        const acctVerificationLinkPattern = argString(acct, 'verificationLinkPattern');
        const acctCheckboxSelectors = argStringArray(acct, 'checkboxSelectors');

        let lastError: string | null = null;
        let attempts = 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          attempts = attempt + 1;

          // Per-account timeout with cleanup
          let timeoutId: ReturnType<typeof setTimeout> | undefined;

          try {
            const flowPromise = this.handleRegisterAccountFlow({
              registerUrl,
              fields: acctFields,
              submitSelector: acctSubmitSelector,
              emailProviderUrl: acctEmailProviderUrl,
              emailSelector: acctEmailSelector,
              verificationLinkPattern: acctVerificationLinkPattern,
              checkboxSelectors: acctCheckboxSelectors,
              timeoutMs: timeoutPerAccountMs,
            });

            const timeoutPromise = new Promise<never>((_, reject) => {
              timeoutId = setTimeout(
                () => reject(new Error(`Registration timeout after ${timeoutPerAccountMs}ms`)),
                timeoutPerAccountMs
              );
            });

            const flowResult = await Promise.race([flowPromise, timeoutPromise]);

            // Parse result to check success
            const resultText = (flowResult as { content: Array<{ text: string }> }).content?.[0]
              ?.text;
            if (typeof resultText === 'string') {
              const parsed = JSON.parse(resultText) as Record<string, unknown>;
              if (parsed.success) {
                succeeded.add(idempotentKey);
                results.push({
                  index: globalIdx,
                  idempotentKey: maskKey(idempotentKey),
                  success: true,
                  attempts,
                  result: parsed,
                });
                return; // success, no more retries
              }
              lastError = (parsed.error as string) ?? 'Registration returned success=false';
            } else {
              lastError = 'Unexpected result format';
            }
          } catch (error) {
            lastError = error instanceof Error ? error.message : String(error);
            logger.debug(
              `[batch_register] Account ${maskKey(idempotentKey)} attempt ${attempts} failed: ${lastError}`
            );
          } finally {
            // Always clear timeout timer to avoid leaks.
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }

          // Capped exponential backoff before retry.
          if (attempt < maxRetries) {
            const backoff = Math.min(retryBackoffMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
            await new Promise((r) => setTimeout(r, backoff));
          }
        }

        // All attempts exhausted
        logger.warn(
          `[batch_register] Account ${maskKey(idempotentKey)} exhausted ${attempts} attempt(s): ${lastError ?? 'All attempts failed'}`
        );
        results.push({
          index: globalIdx,
          idempotentKey: maskKey(idempotentKey),
          success: false,
          attempts,
          error: lastError ?? 'All attempts failed',
        });
      });

      await Promise.allSettled(chunkPromises);
    }


    results.sort((a, b) => a.index - b.index);

    const successCount = results.filter((r) => r.success).length;
    const failCount = results.filter((r) => !r.success).length;

    return this.jsonTextResult({
      success: failCount === 0,
      summary: {
        total: accounts.length,
        succeeded: successCount,
        failed: failCount,
        skipped: results.filter((r) => (r.result as Record<string, unknown>)?.skipped).length,
        truncated:
          Array.isArray(rawAccounts) && rawAccounts.length > BATCH_MAX_ACCOUNTS
            ? { original: rawAccounts.length, limit: BATCH_MAX_ACCOUNTS }
            : undefined,
      },
      results,
    });
  }
}

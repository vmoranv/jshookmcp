import { logger } from '../../../utils/logger.js';
import { WorkflowHandlersAccountBundle } from './handlers.impl.workflow-account-bundle.js';

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
const MAX_ACCOUNTS = 50;
const MAX_CONCURRENCY = 1; // forced serial — shared page (see C4)
const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 30_000;
const MAX_TIMEOUT_MS = 300_000;

export class WorkflowHandlersBatch extends WorkflowHandlersAccountBundle {

  async handleBatchRegister(args: Record<string, unknown>) {
    const registerUrl = args.registerUrl as string;
    const rawAccounts = args.accounts;
    let accounts: Array<Record<string, unknown>> = Array.isArray(rawAccounts) ? rawAccounts : [];
    // Hard cap on account count
    if (accounts.length > MAX_ACCOUNTS) {
      accounts = accounts.slice(0, MAX_ACCOUNTS);
    }
    // Force serial execution (C4: shared page + fixed tab alias)
    const maxConcurrency = Math.min(Math.max(1, (args.maxConcurrency as number) ?? 1), MAX_CONCURRENCY);
    const maxRetries = Math.min(Math.max(0, (args.maxRetries as number) ?? 1), MAX_RETRIES);
    const retryBackoffMs = Math.max(0, (args.retryBackoffMs as number) ?? 2000);
    const timeoutPerAccountMs = Math.min(Math.max(5000, (args.timeoutPerAccountMs as number) ?? 90000), MAX_TIMEOUT_MS);
    const defaultSubmitSelector = (args.submitSelector as string) ?? "button[type='submit']";

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
      const fields = acct.fields as Record<string, string> | undefined;
      if (!fields) return `account-${globalIdx}`;
      return fields.email ?? fields.username ?? fields.name ?? Object.values(fields)[0] ?? `account-${globalIdx}`;
    };

    /** Mask PII for logging (show first 2 + last 2 chars) */
    const maskKey = (key: string): string => {
      if (key.length <= 6) return key.charAt(0) + '***' + key.charAt(key.length - 1);
      return key.slice(0, 2) + '***' + key.slice(-2);
    };

    // Process accounts in chunks of maxConcurrency (currently forced to 1)
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

        const acctFields = (acct.fields as Record<string, string>) ?? {};
        const acctSubmitSelector = (acct.submitSelector as string) ?? defaultSubmitSelector;
        const acctEmailProviderUrl = acct.emailProviderUrl as string | undefined;
        const acctEmailSelector = acct.emailSelector as string | undefined;
        const acctVerificationLinkPattern = acct.verificationLinkPattern as string | undefined;
        const rawCheckboxSelectors = acct.checkboxSelectors;
        const acctCheckboxSelectors: string[] = Array.isArray(rawCheckboxSelectors)
          ? rawCheckboxSelectors as string[]
          : [];

        let lastError: string | null = null;
        let attempts = 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          attempts = attempt + 1;

          // Timeout with proper cleanup (C1 fix)
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
                timeoutPerAccountMs,
              );
            });

            const flowResult = await Promise.race([flowPromise, timeoutPromise]);

            // Parse result to check success
            const resultText = (flowResult as { content: Array<{ text: string }> }).content?.[0]?.text;
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
            logger.warn(`[batch_register] Account ${maskKey(idempotentKey)} attempt ${attempts} failed: ${lastError}`);
          } finally {
            // Always clean up timeout timer (C1 fix: prevent timer leak)
            if (timeoutId !== undefined) clearTimeout(timeoutId);
          }

          // Capped exponential backoff before retry (M1 fix)
          if (attempt < maxRetries) {
            const backoff = Math.min(retryBackoffMs * Math.pow(2, attempt), MAX_BACKOFF_MS);
            await new Promise(r => setTimeout(r, backoff));
          }
        }

        // All attempts exhausted
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

    // Sort results by index for stable output (Suggestion fix)
    results.sort((a, b) => a.index - b.index);

    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    return this.jsonTextResult({
      success: failCount === 0,
      summary: {
        total: accounts.length,
        succeeded: successCount,
        failed: failCount,
        skipped: results.filter(r => (r.result as Record<string, unknown>)?.skipped).length,
        truncated: Array.isArray(rawAccounts) && rawAccounts.length > MAX_ACCOUNTS
          ? { original: rawAccounts.length, limit: MAX_ACCOUNTS }
          : undefined,
      },
      results,
    });
  }
}

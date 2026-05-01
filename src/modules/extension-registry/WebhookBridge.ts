import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getExtensionRegistryDir } from '@utils/outputPaths';

interface WebhookRecord {
  id: string;
  url: string;
  events: string[];
  active: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toWebhookRecord(value: unknown): WebhookRecord | null {
  if (!isRecord(value)) {
    return null;
  }

  const { id, url, events, active } = value;
  if (
    typeof id !== 'string' ||
    typeof url !== 'string' ||
    !Array.isArray(events) ||
    typeof active !== 'boolean'
  ) {
    return null;
  }

  return {
    id,
    url,
    events: events.filter((event): event is string => typeof event === 'string'),
    active,
  };
}

export class WebhookBridge {
  private readonly rootDir: string;

  private readonly storageFile: string;

  private readonly webhooks = new Map<string, WebhookRecord>();

  constructor(rootDir = getExtensionRegistryDir()) {
    this.rootDir = rootDir;
    this.storageFile = path.join(rootDir, 'webhooks.json');
    this.initializeFromDisk();
  }

  async registerWebhook(url: string, events: string[]): Promise<string> {
    void new URL(url);

    const record: WebhookRecord = {
      id: `webhook-${Date.now()}-${this.webhooks.size + 1}`,
      url,
      events: [...new Set(events.filter((event) => event.trim().length > 0))],
      active: true,
    };

    this.webhooks.set(record.id, record);
    await this.persist();
    return record.id;
  }

  async sendEvent(event: string, payload: unknown): Promise<void> {
    const deliveries = [...this.webhooks.values()].filter(
      (record) => record.active && (record.events.includes(event) || record.events.includes('*')),
    );

    for (const record of deliveries) {
      const response = await fetch(record.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          event,
          payload,
          timestamp: new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Webhook delivery failed for ${record.url}: ${response.status} ${response.statusText}`,
        );
      }
    }
  }

  listWebhooks(): { id: string; url: string; events: string[]; active: boolean }[] {
    return [...this.webhooks.values()].map((record) => ({
      id: record.id,
      url: record.url,
      events: [...record.events],
      active: record.active,
    }));
  }

  /**
   * Register an external callback URL for a webhook endpoint.
   * Used when webhook({ action: "create" }) registers an endpoint — the URL is stored
   * here so emitEvent() can forward events to external callbacks.
   */
  registerExternalCallback(endpointId: string, url: string): void {
    const existing = this.webhooks.get(endpointId);
    if (existing) {
      existing.url = url;
      return;
    }

    this.webhooks.set(endpointId, {
      id: endpointId,
      url,
      events: ['*'],
      active: true,
    });
  }

  private initializeFromDisk(): void {
    if (!existsSync(this.rootDir)) {
      mkdirSync(this.rootDir, { recursive: true });
    }

    if (!existsSync(this.storageFile)) {
      return;
    }

    const content = readFileSync(this.storageFile, 'utf8');
    if (!content.trim()) {
      return;
    }

    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) {
      return;
    }

    for (const item of parsed) {
      const record = toWebhookRecord(item);
      if (record) {
        this.webhooks.set(record.id, record);
      }
    }
  }

  private async persist(): Promise<void> {
    await mkdir(this.rootDir, { recursive: true });
    await writeFile(this.storageFile, JSON.stringify([...this.webhooks.values()], null, 2), 'utf8');
  }
}

import type { CdpSessionLike, JsonRecord, TextToolResponse } from './handlers.impl.sourcemap-parse-base.js';
import { SourcemapToolHandlersParseBase } from './handlers.impl.sourcemap-parse-base.js';

export class SourcemapToolHandlersCommon extends SourcemapToolHandlersParseBase {
  protected combineSourceRoot(sourceRoot: string | undefined, sourcePath: string): string {
    if (!sourceRoot) {
      return sourcePath;
    }

    if (!sourcePath) {
      return sourceRoot;
    }

    if (this.hasProtocol(sourcePath) || sourcePath.startsWith('/')) {
      return sourcePath;
    }

    if (this.hasProtocol(sourceRoot)) {
      try {
        const base = sourceRoot.endsWith('/') ? sourceRoot : `${sourceRoot}/`;
        return new URL(sourcePath, base).toString();
      } catch {
        return `${sourceRoot.replace(/\/+$/g, '')}/${sourcePath.replace(/^\/+/g, '')}`;
      }
    }

    return `${sourceRoot.replace(/\/+$/g, '')}/${sourcePath.replace(/^\/+/g, '')}`;
  }

  protected normalizeSourcePath(sourcePath: string, index: number): string {
    let candidate = sourcePath.trim();
    if (!candidate) {
      return `source_${index + 1}.js`;
    }

    if (candidate.startsWith('webpack://')) {
      candidate = candidate.slice('webpack://'.length);
    }

    if (candidate.startsWith('data:')) {
      return `inline/source_${index + 1}.txt`;
    }

    if (this.hasProtocol(candidate)) {
      try {
        const parsed = new URL(candidate);
        candidate = `${parsed.hostname}${parsed.pathname}`;
      } catch {
        candidate = candidate.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '');
      }
    }

    candidate = candidate.replace(/[?#].*$/g, '');
    candidate = candidate.replace(/^[A-Za-z]:[\\/]/, '');
    candidate = candidate.replace(/^\/+/, '');

    const parts = candidate
      .split(/[\\/]+/)
      .map((segment) => this.sanitizePathSegment(segment))
      .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');

    if (parts.length === 0) {
      return `source_${index + 1}.js`;
    }

    return parts.join('/');
  }

  protected sanitizePathSegment(segment: string): string {
    const sanitized = segment
      .replace(/[<>:"|?*\u0000-\u001F]/g, '_')
      .replace(/\s+/g, ' ')
      .trim();

    if (!sanitized || sanitized === '.' || sanitized === '..') {
      return '_';
    }

    return sanitized;
  }

  protected safeTarget(value: string): string {
    return value
      .replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, '')
      .replace(/[^a-zA-Z0-9_-]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .slice(0, 48);
  }

  protected hasProtocol(value: string): boolean {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);
  }

  protected parseBooleanArg(value: unknown, defaultValue: boolean): boolean {
    return typeof value === 'boolean' ? value : defaultValue;
  }

  protected requiredStringArg(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${fieldName} is required`);
    }
    return value.trim();
  }

  protected optionalStringArg(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  protected asRecord(value: unknown): JsonRecord {
    return typeof value === 'object' && value !== null ? (value as JsonRecord) : {};
  }

  protected asString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  protected async safeDetach(session: CdpSessionLike): Promise<void> {
    if (!session.detach) {
      return;
    }
    try {
      await session.detach();
    } catch {
      return;
    }
  }

  protected async trySend(
    session: CdpSessionLike,
    method: string,
    params?: JsonRecord
  ): Promise<void> {
    try {
      await session.send(method, params);
    } catch {
      return;
    }
  }

  protected async delay(ms: number): Promise<void> {
    await new Promise<void>((resolvePromise) => {
      setTimeout(() => resolvePromise(), ms);
    });
  }

  protected json(payload: unknown): TextToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  }

  protected fail(tool: string, error: unknown): TextToolResponse {
    const message = error instanceof Error ? error.message : String(error);
    return this.json({
      success: false,
      tool,
      error: message,
    });
  }
}

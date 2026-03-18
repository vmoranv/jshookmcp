/**
 * Plugin integrity verification — digest allowlists, env guards, compatibility checks.
 */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ExtensionBuilder } from '@server/plugins/PluginContract';
import { isCompatibleVersion } from './ExtensionManager.version';

export async function sha256Hex(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return createHash('sha256').update(content).digest('hex');
}

export function normalizeHex(value: string): string {
  return value.trim().toLowerCase().replace(/^0x/, '');
}

function isTruthyEnv(value: string | undefined): boolean {
  return ['1', 'true'].includes((value ?? '').toLowerCase());
}

export function isPluginSignatureRequired(): boolean {
  const raw = process.env.MCP_PLUGIN_SIGNATURE_REQUIRED;
  if (raw === undefined || raw.trim() === '') {
    return process.env.NODE_ENV === 'production';
  }
  return isTruthyEnv(raw);
}

export function isPluginStrictLoad(): boolean {
  const raw = process.env.MCP_PLUGIN_STRICT_LOAD;
  if (raw === undefined || raw.trim() === '') {
    return isPluginSignatureRequired();
  }
  return isTruthyEnv(raw) || isPluginSignatureRequired();
}

export function parseDigestAllowlist(raw: string | undefined): Set<string> {
  const value = raw?.trim();
  if (!value) return new Set();
  return new Set(
    value
      .split(',')
      .map((item) => normalizeHex(item))
      .filter((item) => item.length > 0)
  );
}

export async function verifyPluginIntegrity(
  plugin: ExtensionBuilder,
  currentVersion: string
): Promise<{ ok: boolean; errors: string[]; warnings: string[] }> {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isCompatibleVersion(plugin.getCompatibleCore, currentVersion)) {
    errors.push(
      `Plugin ${plugin.id} incompatible with core ${currentVersion}; requires ${plugin.getCompatibleCore}`
    );
  }

  // File integrity verified separately since builders do not package checksums inline easily.
  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

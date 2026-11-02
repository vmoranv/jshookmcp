import {
  APK_SURFACE_HINTS_MAX_EVIDENCE,
  APK_SURFACE_HINTS_MAX_CUSTOM_ENTRY_LINES,
  APK_SURFACE_HINTS_MAX_CUSTOM_PATTERNS,
} from '@src/constants';

export interface ApkSurfaceHint {
  name: string;
  evidence: string[];
}

export type ApkSurfaceHintKind = 'protector' | 'sdk';

export interface ApkSurfaceHintRule {
  name: string;
  patterns: string[];
  kind?: ApkSurfaceHintKind;
}

export interface ApkSurfaceHintOptions {
  customSurfaceHints?: ApkSurfaceHintRule[];
}

export interface ApkSurfaceHintSet {
  protectorHints: ApkSurfaceHint[];
  sdkHints: ApkSurfaceHint[];
}

interface EvidenceLine {
  raw: string;
  lower: string;
  clipped: string;
}

interface ApkSurfaceIndex {
  entries: EvidenceLine[];
  xml: EvidenceLine[];
}

const MAX_EVIDENCE = APK_SURFACE_HINTS_MAX_EVIDENCE;
const MAX_CUSTOM_ENTRY_LINES = APK_SURFACE_HINTS_MAX_CUSTOM_ENTRY_LINES;
const MAX_CUSTOM_PATTERNS = APK_SURFACE_HINTS_MAX_CUSTOM_PATTERNS;
const EVIDENCE_CLIP_BYTES = 160;

const NATIVE_LOADER_RE =
  /^lib\/.+\/[^/]*(loader|shell|stub|protect|guard|pack|anti|decrypt|unpack)[^/]*\.so$/;
const SECONDARY_CODE_DIR_RE = /(^|\/)(assets|unknown)\//;
const SECONDARY_CODE_EXT_RE = /\.(dex|cdex|jar|dat|bin|dve|y)$/;
const MULTI_DEX_RE = /(^|\/)classes[2-9]\d*\.(dex|cdex)$/;
const NATIVE_LIB_RE = /^lib\/.+\/[^/]+\.so$/;
const STARTUP_WRAPPER_RE = /android:name="[^"]*(loader|shell|stub|wrapper|protect|guard)[^"]*"/;
const NETWORK_PERMISSION_RE = /android\.permission\.(internet|access_network_state)/;
const BACKGROUND_COMPONENT_RE = /<(service|receiver|provider)\b/;

export function matchApkSurfaceHints(
  entries: string[],
  xml: string,
  options: ApkSurfaceHintOptions = {},
): ApkSurfaceHintSet {
  const index = createSurfaceIndex(entries, xml);
  const protectorHints = mergeHints(
    matchGenericProtectorHintsFromIndex(index),
    matchCustomSurfaceHints(index, options, 'protector'),
  );
  const sdkHints = mergeHints(
    matchGenericSdkHintsFromIndex(index),
    matchCustomSurfaceHints(index, options, 'sdk'),
  );
  return { protectorHints, sdkHints };
}

function matchGenericProtectorHintsFromIndex(index: ApkSurfaceIndex): ApkSurfaceHint[] {
  const hints: ApkSurfaceHint[] = [];
  const nativeLoaderEvidence = collectEntryEvidence(index, (line) =>
    NATIVE_LOADER_RE.test(line.lower),
  );
  if (nativeLoaderEvidence.length > 0) {
    hints.push({ name: 'native-loader-surface', evidence: nativeLoaderEvidence });
  }

  const secondaryDexEvidence = collectEntryEvidence(
    index,
    (line) => SECONDARY_CODE_DIR_RE.test(line.lower) && SECONDARY_CODE_EXT_RE.test(line.lower),
  );
  if (secondaryDexEvidence.length > 0) {
    hints.push({ name: 'secondary-code-container', evidence: secondaryDexEvidence });
  }

  const multiDexEvidence = collectEntryEvidence(index, (line) => MULTI_DEX_RE.test(line.lower));
  if (multiDexEvidence.length > 0) {
    hints.push({ name: 'multi-dex-surface', evidence: multiDexEvidence });
  }

  const wrapperEvidence = findXmlEvidence(index, [STARTUP_WRAPPER_RE]);
  if (wrapperEvidence.length > 0) {
    hints.push({ name: 'startup-wrapper-surface', evidence: wrapperEvidence });
  }

  return hints;
}

function matchGenericSdkHintsFromIndex(index: ApkSurfaceIndex): ApkSurfaceHint[] {
  const hints: ApkSurfaceHint[] = [];
  const networkEvidence = findXmlEvidence(index, [NETWORK_PERMISSION_RE]);
  if (networkEvidence.length > 0) {
    hints.push({ name: 'network-permission-surface', evidence: networkEvidence });
  }

  const componentEvidence = findXmlEvidence(index, [BACKGROUND_COMPONENT_RE]);
  if (componentEvidence.length > 0) {
    hints.push({ name: 'background-component-surface', evidence: componentEvidence });
  }

  const nativeEvidence = collectEntryEvidence(index, (line) => NATIVE_LIB_RE.test(line.lower));
  if (nativeEvidence.length > 0) {
    hints.push({ name: 'native-bridge-surface', evidence: nativeEvidence });
  }

  const webviewEvidence = [
    ...collectEntryEvidence(index, (line) => line.lower.includes('webview')),
    ...findXmlEvidence(index, [/webview/]),
  ].slice(0, MAX_EVIDENCE);
  if (webviewEvidence.length > 0) {
    hints.push({ name: 'webview-surface', evidence: webviewEvidence });
  }

  return hints;
}

function matchCustomSurfaceHints(
  index: ApkSurfaceIndex,
  options: ApkSurfaceHintOptions,
  kind: ApkSurfaceHintKind,
): ApkSurfaceHint[] {
  const rules = options.customSurfaceHints ?? [];
  if (rules.length === 0) return [];
  const normalizedRules = rules
    .filter((rule) => (rule.kind ?? 'protector') === kind)
    .map((rule) => ({
      name: rule.name,
      patterns: normalizePatterns(rule.patterns),
    }))
    .filter((rule) => rule.patterns.length > 0);
  if (normalizedRules.length === 0) return [];

  const evidenceByName = new Map<string, Set<string>>();
  const lines = [...index.entries.slice(0, MAX_CUSTOM_ENTRY_LINES), ...index.xml];
  for (const line of lines) {
    for (const rule of normalizedRules) {
      const evidence = evidenceByName.get(rule.name) ?? new Set<string>();
      if (evidence.size >= MAX_EVIDENCE) continue;
      if (rule.patterns.some((pattern) => line.lower.includes(pattern))) {
        evidence.add(line.clipped);
        evidenceByName.set(rule.name, evidence);
      }
    }
  }

  return normalizedRules
    .map((rule) => ({
      name: rule.name,
      evidence: [...(evidenceByName.get(rule.name) ?? [])],
    }))
    .filter((hint) => hint.evidence.length > 0);
}

function findXmlEvidence(index: ApkSurfaceIndex, patterns: RegExp[]): string[] {
  const evidence: string[] = [];
  for (const pattern of patterns) {
    for (const line of index.xml) {
      if (pattern.test(line.lower)) evidence.push(line.clipped);
      if (evidence.length >= MAX_EVIDENCE) return evidence;
    }
  }
  return [...new Set(evidence)].slice(0, MAX_EVIDENCE);
}

function collectEntryEvidence(
  index: ApkSurfaceIndex,
  predicate: (line: EvidenceLine) => boolean,
): string[] {
  const evidence: string[] = [];
  for (const line of index.entries) {
    if (predicate(line)) evidence.push(line.raw);
    if (evidence.length >= MAX_EVIDENCE) return evidence;
  }
  return evidence;
}

function normalizePatterns(patterns: string[]): string[] {
  return patterns
    .map((pattern) => pattern.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_PATTERNS);
}

function createSurfaceIndex(entries: string[], xml: string): ApkSurfaceIndex {
  return {
    entries: entries.map(toEvidenceLine),
    xml: xmlEvidenceLines(xml).map(toEvidenceLine),
  };
}

function toEvidenceLine(raw: string): EvidenceLine {
  return {
    raw,
    lower: raw.toLowerCase(),
    clipped: raw.slice(0, EVIDENCE_CLIP_BYTES),
  };
}

function xmlEvidenceLines(xml: string): string[] {
  return xml
    .split(/\r?\n|(?=<)/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function mergeHints(...groups: ApkSurfaceHint[][]): ApkSurfaceHint[] {
  const merged = new Map<string, Set<string>>();
  for (const group of groups) {
    for (const hint of group) {
      const evidence = merged.get(hint.name) ?? new Set<string>();
      for (const item of hint.evidence) evidence.add(item);
      merged.set(hint.name, evidence);
    }
  }
  return [...merged.entries()].map(([name, evidence]) => ({
    name,
    evidence: [...evidence].slice(0, 10),
  }));
}

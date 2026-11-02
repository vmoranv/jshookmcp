/**
 * Cheat Table (.CT) Import/Export
 *
 * CE's .CT files are XML-based. This module provides basic import/export for
 * address-only cheat tables (no Auto Assembler scripts).
 *
 * @module CheatTableIO
 */

// ── Types ──

export interface CheatEntry {
  /** User-visible description (e.g. "Health", "Player Base") */
  description: string;
  /** Hex address (e.g. "0x7FF612340000") or module+offset (e.g. "game.exe"+00123456) */
  address: string;
  /** CE VariableType string (e.g. "4 Bytes", "Float", "8 Bytes") */
  variableType: string;
  /** If module-relative, the module name */
  moduleName?: string;
  /** If module-relative, the offset from module base (hex string) */
  offset?: string;
}

// ── Value type mapping (jshookmcp → CE VariableType) ──

const VALUE_TYPE_TO_CE: Record<string, string> = {
  byte: 'Byte',
  int8: 'Byte',
  int16: '2 Bytes',
  uint16: '2 Bytes',
  int32: '4 Bytes',
  uint32: '4 Bytes',
  int64: '8 Bytes',
  uint64: '8 Bytes',
  float: 'Float',
  double: 'Double',
  pointer: '8 Bytes',
  string: 'String',
  hex: 'Array of Bytes',
};

const CE_TO_VALUE_TYPE: Record<string, string> = {
  Byte: 'byte',
  '2 Bytes': 'int16',
  '4 Bytes': 'int32',
  '8 Bytes': 'int64',
  Float: 'float',
  Double: 'double',
  String: 'string',
  'Array of Bytes': 'hex',
  Binary: 'hex',
};

/**
 * Map a jshookmcp ScanValueType to a CE VariableType string.
 */
export function mapValueTypeToCE(valueType: string): string {
  return VALUE_TYPE_TO_CE[valueType] ?? '4 Bytes';
}

/**
 * Map a CE VariableType string back to a jshookmcp value type.
 */
export function mapCEToValueType(ceType: string): string {
  return CE_TO_VALUE_TYPE[ceType] ?? 'int32';
}

// ── Export ──

/**
 * Generate a .CT XML string from an array of entries.
 */
export function exportCheatTable(entries: CheatEntry[], version = 45): string {
  const entryElements = entries
    .map(
      (entry, i) =>
        `    <CheatEntry>\n` +
        `      <ID>${i}</ID>\n` +
        `      <Description>${xmlEscape(entry.description)}</Description>\n` +
        `      <VariableType>${xmlEscape(entry.variableType)}</VariableType>\n` +
        // Address is NOT xmlEscape'd: CE .CT files use literal quotes in
        // module-relative addresses like "game.exe"+00123456
        `      <Address>${entry.address}</Address>\n` +
        `    </CheatEntry>`,
    )
    .join('\n');

  return (
    `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<CheatTable CheatEngineTableVersion="${version}">\n` +
    `  <CheatEntries>\n` +
    `${entryElements}\n` +
    `  </CheatEntries>\n` +
    `</CheatTable>\n`
  );
}

/**
 * Build a module-relative address string: "game.exe"+00123456
 */
export function formatModuleAddress(moduleName: string, offset: string): string {
  // Strip 0x prefix from offset for CE module+offset format
  const cleanOffset = offset.replace(/^0x/i, '').toUpperCase();
  return `"${moduleName}"+${cleanOffset}`;
}

// ── Import ──

export interface ImportWarnings {
  skippedAutoAssembler: string[];
  skippedOther: string[];
}

export interface ImportResult {
  entries: CheatEntry[];
  warnings: ImportWarnings;
}

/**
 * Parse a .CT XML string and extract CheatEntry elements.
 *
 * This is a regex-based parser that handles the subset of XML used by CE .CT
 * files. It does NOT load a full XML DOM — it uses targeted regex patterns
 * to extract CheatEntry blocks and their fields.
 */
export function importCheatTable(xml: string): ImportResult {
  const entries: CheatEntry[] = [];
  const skippedAutoAssembler: string[] = [];
  const skippedOther: string[] = [];

  // Find version: CheatEngineTableVersion="N"
  // Not critical for parsing, just informational

  // Extract CheatEntry blocks — match from <CheatEntry> to </CheatEntry>
  // Use a non-greedy approach: find each </CheatEntry> and work backwards
  const entryRegex = /<CheatEntry>([\s\S]*?)<\/CheatEntry>/gi;
  let entryMatch: RegExpExecArray | null;

  while ((entryMatch = entryRegex.exec(xml)) !== null) {
    const block = entryMatch[1]!;

    // Check for Auto Assembler scripts — skip those entries
    if (/<AssemblerScript>[\s\S]*?<\/AssemblerScript>/i.test(block)) {
      const desc = extractTagValue(block, 'Description') ?? '(unnamed)';
      skippedAutoAssembler.push(desc);
      continue;
    }

    // Check for other unsupported child elements
    if (/<(?:LuaScript|Hotkeys|DisableAssemblerScript)[\s>]/i.test(block)) {
      const desc = extractTagValue(block, 'Description') ?? '(unnamed)';
      skippedOther.push(desc);
      continue;
    }

    const description = extractTagValue(block, 'Description') ?? '';
    const variableType = extractTagValue(block, 'VariableType') ?? '4 Bytes';
    let address = xmlUnescape(extractTagValue(block, 'Address') ?? '');

    // Parse address: could be hex ("0x...") or module+offset ("module.exe"+OFFSET)
    let moduleName: string | undefined;
    let offset: string | undefined;

    const moduleOffsetRegex = /"([^"]+)"\s*\+\s*([0-9A-Fa-f]+)/;
    const moMatch = moduleOffsetRegex.exec(address);
    if (moMatch) {
      moduleName = moMatch[1]!;
      offset = `0x${moMatch[2]!.toUpperCase()}`;
    }

    // Normalize hex address
    if (!moduleName && address && /^[0-9A-Fa-f]+$/.test(address)) {
      address = `0x${address}`;
    }

    entries.push({
      description,
      address,
      variableType,
      moduleName,
      offset,
    });
  }

  return {
    entries,
    warnings: {
      skippedAutoAssembler,
      skippedOther,
    },
  };
}

// ── Helpers ──

function extractTagValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = regex.exec(xml);
  return match ? match[1]!.trim() : null;
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

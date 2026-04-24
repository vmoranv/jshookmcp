export interface WASMDetection {
  type: string;
  confidence: number;
  locations: WASMLocation[];
  description: string;
}

export interface WASMLocation {
  line: number;
  column: number;
  snippet: string;
}

export interface WASMMixedSchemeResult {
  detected: boolean;
  detections: WASMDetection[];
  warnings: string[];
}

export interface WASMBytecodeDecodeResult {
  success: boolean;
  code: string;
  warnings: string[];
  metadata: {
    hasMagic: boolean;
    version: number | null;
    exports: string[];
    imports: string[];
    rawSize: number;
  };
}

function detectWASMBinaryLoading(code: string): WASMLocation[] {
  const locations: WASMLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const patterns = [
      /WebAssembly\.instantiate\s*\(/,
      /WebAssembly\.compile\s*\(/,
      /WebAssembly\.validate\s*\(/,
      /new\s+WebAssembly\.Module\s*\(/,
    ];

    for (const pattern of patterns) {
      const match = line.match(pattern);
      if (match) {
        locations.push({ line: i + 1, column: line.indexOf(match[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectJSWASMInterop(code: string): WASMLocation[] {
  const locations: WASMLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const interopPatterns = [
      /instance\.exports\.\w+/,
      /webassembly\.instance/,
      /\.\s*get\s*\(\s*\d+\s*\)/,
      /\.\s*set\s*\(\s*\d+\s*,/,
      /memory\.buffer/,
      /new\s+Uint8Array\s*\(\s*memory\.buffer\s*\)/,
    ];

    for (const pattern of interopPatterns) {
      const match = line.match(pattern);
      if (match) {
        locations.push({ line: i + 1, column: line.indexOf(match[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectWASMStringObfuscation(code: string): WASMLocation[] {
  const locations: WASMLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const stringPatterns = [
      /String\.fromCharCode\.apply\s*\([^)]*\)/,
      /fromCharCode\s*\(\s*\d+\s*\)(?:\s*\+\s*fromCharCode\s*\(\s*\d+\s*\))+/,
      /\[\s*\d+\s*\]\.reduce\s*\(\s*stringReducer/,
      /charCodeAt\s*\(\s*\d+\s*\)/,
    ];

    for (const pattern of stringPatterns) {
      const match = line.match(pattern);
      if (match) {
        locations.push({ line: i + 1, column: line.indexOf(match[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectWASMControlFlowHijacking(code: string): WASMLocation[] {
  const locations: WASMLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    if (/table\.get\s*\(|table\.set\s*\(/.test(line)) {
      locations.push({ line: i + 1, column: line.search(/\S/), snippet: line.slice(0, 80) });
    }

    if (/indirect\s*\(\s*\d+\s*,\s*\d+\s*\)/.test(line)) {
      locations.push({ line: i + 1, column: line.search(/\S/), snippet: line.slice(0, 80) });
    }
  }

  return locations;
}

function detectWASMBytecodeEmbedding(code: string): WASMLocation[] {
  const locations: WASMLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const bytePatterns = [
      /\[\s*(?:0x[0-9a-fA-F]{2}\s*,\s*)+(?:0x[0-9a-fA-F]{2}\s*,?\s*)+\]/,
      /new\s+Uint8Array\s*\(\s*\[/,
      /atob\s*\(\s*["'][^"']+["']\s*\)/,
      /btoa\s*\(\s*[^)]+\s*\)/,
      /String\.fromCharCode\s*\(\s*(?:0x[0-9a-fA-F]{2}\s*,?\s*)+\)/,
    ];

    for (const pattern of bytePatterns) {
      const match = line.match(pattern);
      if (match) {
        locations.push({ line: i + 1, column: line.indexOf(match[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectWASMJSMixedExecution(code: string): WASMLocation[] {
  const locations: WASMLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const mixedPatterns = [
      /new\s+Function\s*\(\s*(?:instance|module|wasm)/i,
      /eval\s*\(\s*(?:atob|btoa|String\.fromCharCode)/,
      /setTimeout\s*\(\s*(?:instance|wasm|module)/,
      /importScripts\s*\(/,
    ];

    for (const pattern of mixedPatterns) {
      const match = line.match(pattern);
      if (match) {
        locations.push({ line: i + 1, column: line.indexOf(match[0]), snippet: line.slice(0, 80) });
      }
    }
  }

  return locations;
}

export function analyzeWASMMixedScheme(code: string): WASMMixedSchemeResult {
  const detections: WASMDetection[] = [];
  const warnings: string[] = [];

  const binaryLoading = detectWASMBinaryLoading(code);
  if (binaryLoading.length > 0) {
    detections.push({
      type: 'wasm-binary-loading',
      confidence: 0.95,
      locations: binaryLoading,
      description: 'WebAssembly binary loading or compilation detected',
    });
  }

  const interop = detectJSWASMInterop(code);
  if (interop.length > 0) {
    detections.push({
      type: 'js-wasm-interop',
      confidence: 0.85,
      locations: interop,
      description: 'JavaScript and WebAssembly interop patterns found',
    });
  }

  const stringObf = detectWASMStringObfuscation(code);
  if (stringObf.length > 0) {
    detections.push({
      type: 'wasm-string-obfuscation',
      confidence: 0.8,
      locations: stringObf,
      description: 'String obfuscation using WASM memory and charCode patterns',
    });
  }

  const cfHijack = detectWASMControlFlowHijacking(code);
  if (cfHijack.length > 0) {
    detections.push({
      type: 'wasm-control-flow-hijacking',
      confidence: 0.9,
      locations: cfHijack,
      description: 'WASM table manipulation for control flow hijacking',
    });
  }

  const bytecode = detectWASMBytecodeEmbedding(code);
  if (bytecode.length > 0) {
    detections.push({
      type: 'wasm-bytecode-embedding',
      confidence: 0.88,
      locations: bytecode,
      description: 'WASM bytecode embedded in JavaScript as byte arrays',
    });
  }

  const mixedExec = detectWASMJSMixedExecution(code);
  if (mixedExec.length > 0) {
    detections.push({
      type: 'wasm-js-mixed-execution',
      confidence: 0.92,
      locations: mixedExec,
      description: 'Mixed WASM and JS execution environments',
    });
  }

  if (detections.length > 0) {
    warnings.push(`WASM+JS mixed scheme detected: ${detections.map((d) => d.type).join(', ')}`);
  }

  return {
    detected: detections.length > 0,
    detections,
    warnings,
  };
}

export function getWASMMixedSchemeSummary(code: string): {
  threat: 'low' | 'medium' | 'high';
  details: string;
} {
  const result = analyzeWASMMixedScheme(code);
  if (!result.detected) {
    return { threat: 'low', details: 'No WASM+JS mixed scheme patterns detected' };
  }

  const highConfidence = result.detections.filter((d) => d.confidence >= 0.9).length;
  const totalLocations = result.detections.reduce((sum, d) => sum + d.locations.length, 0);

  if (highConfidence >= 2 || totalLocations >= 5) {
    return {
      threat: 'high',
      details: `High threat: ${highConfidence} high-confidence detections, ${totalLocations} total locations`,
    };
  }

  return {
    threat: 'medium',
    details: `Medium threat: ${result.detections.length} detection types, ${totalLocations} locations`,
  };
}

export function detectWASMBytecodePayloads(
  code: string,
): Array<{ type: 'base64' | 'hex' | 'string'; payload: string; line: number }> {
  const payloads: Array<{ type: 'base64' | 'hex' | 'string'; payload: string; line: number }> = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const base64Match = line.match(/atob\s*\(\s*["']([A-Za-z0-9+/]+={0,2})["']\s*\)/);
    if (base64Match && base64Match[1] && base64Match[1].length > 20) {
      payloads.push({ type: 'base64', payload: base64Match[1], line: i + 1 });
      continue;
    }

    const hexMatch = line.match(/\[([\s\S]*?)\];?\s*$/);
    if (hexMatch && hexMatch[1]) {
      const hexBytes = hexMatch[1].match(/0x[0-9a-fA-F]{2}/gi);
      if (hexBytes && hexBytes.length >= 4) {
        payloads.push({ type: 'hex', payload: hexBytes.join(','), line: i + 1 });
        continue;
      }
    }

    const wasmMagic = line.match(/(?:0x00|0x61|0x73|0x6D)/g);
    if (wasmMagic && wasmMagic.length >= 4) {
      payloads.push({ type: 'string', payload: wasmMagic.slice(0, 8).join(','), line: i + 1 });
    }
  }

  return payloads;
}

export function extractWASMMetadata(wasmBytes: Uint8Array): {
  hasMagic: boolean;
  version: number | null;
  exports: string[];
  imports: string[];
  rawSize: number;
} {
  const exports: string[] = [];
  const imports: string[] = [];
  const rawSize = wasmBytes.length;

  if (wasmBytes.length < 8) {
    return { hasMagic: false, version: null, exports, imports, rawSize };
  }

  const hasMagic =
    wasmBytes[0] === 0x00 &&
    wasmBytes[1] === 0x61 &&
    wasmBytes[2] === 0x73 &&
    wasmBytes[3] === 0x6d;

  const version = hasMagic
    ? ((wasmBytes[4]! << 0) |
        (wasmBytes[5]! << 8) |
        (wasmBytes[6]! << 16) |
        (wasmBytes[7]! << 24)) >>>
      0
    : null;

  return { hasMagic, version, exports, imports, rawSize };
}

export async function decodeWASMBytecodeEmbedding(code: string): Promise<WASMBytecodeDecodeResult> {
  const warnings: string[] = [];
  const payloads = detectWASMBytecodePayloads(code);

  if (payloads.length === 0) {
    return {
      success: false,
      code,
      warnings: ['No WASM bytecode payloads detected'],
      metadata: { hasMagic: false, version: null, exports: [], imports: [], rawSize: 0 },
    };
  }

  const firstPayload = payloads[0]!;

  if (firstPayload.type === 'base64') {
    try {
      const decoded = Buffer.from(firstPayload.payload, 'base64');
      const metadata = extractWASMMetadata(new Uint8Array(decoded));

      if (metadata.hasMagic) {
        warnings.push(
          `Decoded WASM binary: magic ${metadata.hasMagic ? 'valid' : 'invalid'}, version ${metadata.version ?? 'unknown'}`,
        );
        const decodedCode = `/* WASM bytecode decoded: ${decoded.length} bytes, ${metadata.exports.length} exports, ${metadata.imports.length} imports */\n${code}`;
        return {
          success: true,
          code: decodedCode,
          warnings,
          metadata,
        };
      }
    } catch {
      warnings.push('Failed to decode base64 WASM payload');
    }
  }

  if (firstPayload.type === 'hex') {
    try {
      const hexStr = firstPayload.payload.replace(/0x/gi, '');
      const hexPairs = hexStr.match(/.{1,2}/g);
      const bytes = new Uint8Array(hexPairs?.map((b) => parseInt(b, 16)) ?? []);
      const metadata = extractWASMMetadata(bytes);

      if (metadata.hasMagic) {
        warnings.push(`Decoded hex WASM: ${bytes.length} bytes`);
        const decodedCode = `/* WASM hex decoded: ${bytes.length} bytes */\n${code}`;
        return {
          success: true,
          code: decodedCode,
          warnings,
          metadata,
        };
      }
    } catch {
      warnings.push('Failed to decode hex WASM payload');
    }
  }

  return {
    success: false,
    code,
    warnings: [...warnings, 'WASM payload detected but could not be fully decoded'],
    metadata: { hasMagic: false, version: null, exports: [], imports: [], rawSize: 0 },
  };
}

export interface JITSprayDetection {
  type: string;
  confidence: number;
  locations: JITSprayLocation[];
  description: string;
}

export interface JITSprayLocation {
  line: number;
  column: number;
  snippet: string;
}

export interface JITSprayResult {
  detected: boolean;
  detections: JITSprayDetection[];
  warnings: string[];
}

function detectStringConcatBuilding(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const matches = line.match(/(?:["']([^"']{1,4})["']\s*\+\s*(?:\(?[^+\)]+\)?\s*\+\s*)*["']([^"']{1,4})["'])/g);
    if (matches) {
      for (const match of matches) {
        if (match.length > 20) {
          locations.push({ line: i + 1, column: line.indexOf(match), snippet: match.slice(0, 80) });
        }
      }
    }
  }

  return locations;
}

function detectDynamicConstructor(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const pattern = /new\s+Function\s*\(|Function\s*\(\s*"[^"]+"\s*(?:,\s*"[^"]+")*\s*\)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      locations.push({ line: i + 1, column: match.index, snippet: match[0].slice(0, 80) });
    }
  }

  return locations;
}

function detectEvalWithBuiltCode(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const pattern = /eval\s*\(\s*(?:["'`](?:[^"'`])+["'`]|String|fromCharCode|charCodeAt)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      locations.push({ line: i + 1, column: match.index, snippet: match[0].slice(0, 80) });
    }
  }

  return locations;
}

function detectSetIntervalString(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const pattern = /(?:setTimeout|setInterval)\s*\(\s*(?:["'`](?:[^"'`]){5,}["'`]|Function|eval)/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      locations.push({ line: i + 1, column: match.index, snippet: match[0].slice(0, 80) });
    }
  }

  return locations;
}

function detectMachineCodePatterns(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const patterns = [
      { re: /\b0x[0-9a-fA-F]{2,}(?:\s*,\s*0x[0-9a-fA-F]{2,}){1,}/g, name: 'hex-byte-sequence' },
      { re: /\b0x(?:90|CC){5,}/gi, name: 'nop-pattern' },
      { re: /\b(?:NOP|INT3|JMP)\b/gi, name: 'asm-keyword' },
    ];

    for (const { re } of patterns) {
      let match;
      while ((match = re.exec(line)) !== null) {
        locations.push({ line: i + 1, column: match.index, snippet: match[0].slice(0, 80) });
      }
    }
  }

  return locations;
}

function detectProxyFunction(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    if (/Proxy\s*\(/.test(line) && /(?:handler|target)/.test(line)) {
      const idx = line.search(/Proxy\s*\(/);
      locations.push({ line: i + 1, column: idx >= 0 ? idx : 0, snippet: line.slice(0, 80) });
    }
  }

  return locations;
}

function detectWebAssemblyInstantiate(code: string): JITSprayLocation[] {
  const locations: JITSprayLocation[] = [];
  const lines = code.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const pattern = /WebAssembly\.instantiate/g;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      locations.push({ line: i + 1, column: match.index, snippet: match[0].slice(0, 80) });
    }
  }

  return locations;
}

export function detectJITSpray(code: string): JITSprayResult {
  const detections: JITSprayDetection[] = [];
  const warnings: string[] = [];

  const stringBuilding = detectStringConcatBuilding(code);
  if (stringBuilding.length > 0) {
    detections.push({
      type: 'string-building',
      confidence: 0.65,
      locations: stringBuilding,
      description: 'Character-by-character string concatenation often used to build JIT-sprayed code',
    });
  }

  const dynamicConstructor = detectDynamicConstructor(code);
  if (dynamicConstructor.length > 0) {
    detections.push({
      type: 'dynamic-constructor',
      confidence: 0.7,
      locations: dynamicConstructor,
      description: 'Dynamic Function constructor used to create runtime code',
    });
  }

  const evalBuiltCode = detectEvalWithBuiltCode(code);
  if (evalBuiltCode.length > 0) {
    detections.push({
      type: 'eval-with-constructed-string',
      confidence: 0.75,
      locations: evalBuiltCode,
      description: 'eval() with dynamically constructed string argument',
    });
  }

  const setIntervalString = detectSetIntervalString(code);
  if (setIntervalString.length > 0) {
    detections.push({
      type: 'settimeout-string',
      confidence: 0.6,
      locations: setIntervalString,
      description: 'setTimeout/setInterval with string code argument',
    });
  }

  const machineCode = detectMachineCodePatterns(code);
  if (machineCode.length > 0) {
    detections.push({
      type: 'machine-code-patterns',
      confidence: 0.9,
      locations: machineCode,
      description: 'Inline machine code bytes or opcodes detected',
    });
  }

  const proxyFunc = detectProxyFunction(code);
  if (proxyFunc.length > 0) {
    detections.push({
      type: 'proxy-function',
      confidence: 0.5,
      locations: proxyFunc,
      description: 'JavaScript Proxy object used to intercept code execution',
    });
  }

  const wasmInstantiate = detectWebAssemblyInstantiate(code);
  if (wasmInstantiate.length > 0) {
    detections.push({
      type: 'wasm-instantiate',
      confidence: 0.55,
      locations: wasmInstantiate,
      description: 'WebAssembly.instantiate used to run binary code from JS',
    });
  }

  if (detections.length > 0) {
    warnings.push(`JIT-spray obfuscation detected: ${detections.map((d) => d.type).join(', ')}`);
  }

  return {
    detected: detections.length > 0,
    detections,
    warnings,
  };
}

export function getJITSpraySummary(code: string): { risk: 'low' | 'medium' | 'high'; details: string } {
  const result = detectJITSpray(code);
  if (!result.detected) {
    return { risk: 'low', details: 'No JIT-spray patterns detected' };
  }

  const highConfidence = result.detections.filter((d) => d.confidence >= 0.75).length;
  const totalLocations = result.detections.reduce((sum, d) => sum + d.locations.length, 0);

  if (highConfidence > 0 || totalLocations >= 3) {
    return {
      risk: 'high',
      details: `High risk: ${highConfidence} high-confidence detections, ${totalLocations} total locations`,
    };
  }

  return {
    risk: 'medium',
    details: `Medium risk: ${result.detections.length} detection types, ${totalLocations} locations`,
  };
}

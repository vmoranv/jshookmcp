const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toVlqSigned(value: number): number {
  return value < 0 ? (-value << 1) | 1 : value << 1;
}

function encodeVlq(value: number): string {
  let v = toVlqSigned(value);
  let result = '';
  while (true) {
    const digit = v & 0x1f;
    v >>= 5;
    if (v === 0) {
      result += BASE64_ALPHABET[digit];
      break;
    }
    result += BASE64_ALPHABET[digit | 0x20];
    if (v < 0x20) {
      result += BASE64_ALPHABET[v];
      break;
    }
  }
  return result;
}

export interface SourceMapSegment {
  generatedLine: number;
  generatedColumn: number;
  sourceIndex: number;
  originalLine: number;
  originalColumn: number;
  nameIndex?: number;
}

export interface SourceMapOptions {
  source?: string;
  sourceRoot?: string;
  file?: string;
}

export class SourcemapGenerator {
  private readonly sources: string[] = [];
  private readonly sourcesContent: (string | null)[] = [];
  private readonly names: string[] = [];
  private readonly mappings: SourceMapSegment[] = [];
  private readonly seenMappings: Set<string> = new Set();
  private sourceRoot: string;
  private file: string;

  constructor(options: SourceMapOptions = {}) {
    this.sourceRoot = options.sourceRoot ?? '';
    this.file = options.file ?? 'transformed.js';
    if (options.source) {
      this.addSource(options.source, options.source);
    }
  }

  addSource(name: string, content: string, sourceContent?: string | null): number {
    const idx = this.sources.indexOf(name);
    if (idx !== -1) {
      if (sourceContent !== undefined) {
        this.sourcesContent[idx] = sourceContent;
      }
      return idx;
    }
    const index = this.sources.length;
    this.sources.push(name);
    this.sourcesContent.push(sourceContent !== undefined ? sourceContent : content);
    return index;
  }

  addMapping(
    generatedLine: number,
    generatedColumn: number,
    sourceIndex: number,
    originalLine: number,
    originalColumn: number,
    nameIndex?: number,
  ): void {
    const key = `${generatedLine}:${generatedColumn}:${sourceIndex}:${originalLine}:${originalColumn}:${nameIndex ?? -1}`;
    if (this.seenMappings.has(key)) {
      return;
    }
    this.seenMappings.add(key);
    this.mappings.push({
      generatedLine,
      generatedColumn,
      sourceIndex,
      originalLine,
      originalColumn,
      nameIndex,
    });
  }

  clearMappings(): void {
    this.mappings.length = 0;
    this.seenMappings.clear();
  }

  generate(generatedCode: string): string {
    const generatedLines = generatedCode.split('\n');
    const vlqMappings = this.encodeMappings(generatedLines);
    const map = {
      version: 3 as const,
      file: this.file,
      sourceRoot: this.sourceRoot,
      sources: this.sources,
      sourcesContent: this.sourcesContent,
      mappings: vlqMappings,
      names: this.names,
    };
    return JSON.stringify(map);
  }

  generateInline(generatedCode: string): string {
    const map = this.generate(generatedCode);
    const base64 = Buffer.from(map, 'utf-8').toString('base64');
    return `${generatedCode}\n//# sourceMappingURL=data:application/json;base64,${base64}`;
  }

  setSourceRoot(root: string): void {
    this.sourceRoot = root;
  }

  setFile(file: string): void {
    this.file = file;
  }

  addName(name: string): number {
    const idx = this.names.indexOf(name);
    if (idx !== -1) return idx;
    const i = this.names.length;
    this.names.push(name);
    return i;
  }

  private encodeMappings(_generatedLines: string[]): string {
    if (this.mappings.length === 0) return '';

    const sorted = [...this.mappings].sort((a, b) => {
      if (a.generatedLine !== b.generatedLine) return a.generatedLine - b.generatedLine;
      return a.generatedColumn - b.generatedColumn;
    });

    let prevGenCol = 0;
    let prevSrcIdx = 0;
    let prevOrigLine = 0;
    let prevOrigCol = 0;
    let prevNameIdx = 0;

    const lineGroups: string[][] = [];
    let currentLine = 0;

    for (const seg of sorted) {
      while (currentLine < seg.generatedLine) {
        if (lineGroups.length > 0) {
          const lastLine = lineGroups[lineGroups.length - 1];
          if (lastLine && lastLine.length > 0) {
            lineGroups[lineGroups.length - 1] = lastLine.filter(p => p.length > 0);
          }
        }
        currentLine++;
      }

      while (lineGroups.length < currentLine) {
        lineGroups.push([]);
      }

      const colDelta = seg.generatedColumn - prevGenCol;
      const srcDelta = seg.sourceIndex - prevSrcIdx;
      const origLineDelta = seg.originalLine - prevOrigLine;
      const origColDelta = seg.originalColumn - prevOrigCol;

      const parts: number[] = [colDelta, srcDelta, origLineDelta, origColDelta];
      if (seg.nameIndex !== undefined) {
        parts.push(seg.nameIndex - prevNameIdx);
        prevNameIdx = seg.nameIndex;
      }

      let encoded = '';
      for (const p of parts) {
        encoded += encodeVlq(p);
      }

      if (encoded) {
        const lineIdx = currentLine - 1;
        if (lineGroups[lineIdx]) {
          lineGroups[lineIdx].push(encoded);
        }
      }

      prevGenCol = seg.generatedColumn;
      prevSrcIdx = seg.sourceIndex;
      prevOrigLine = seg.originalLine;
      prevOrigCol = seg.originalColumn;
    }

    if (lineGroups.length > 0) {
      const lastLine = lineGroups[lineGroups.length - 1];
      if (lastLine && lastLine.length > 0) {
        lineGroups[lineGroups.length - 1] = lastLine.filter(p => p.length > 0);
      }
    }

    return lineGroups.map(parts => parts.join(',')).join(';');
  }
}

export function createSourcemapForTransformation(
  original: string,
  transformed: string,
  options: SourceMapOptions = {},
): { code: string; sourcemap: string } {
  const generator = new SourcemapGenerator(options);
  const sourceIndex = generator.addSource(
    options.source ?? 'original.js',
    original,
    original,
  );

  const origLines = original.split('\n');
  const transLines = transformed.split('\n');

  const maxLines = Math.max(origLines.length, transLines.length);

  for (let i = 0; i < maxLines; i++) {
    const origLine = origLines[i] ?? '';
    const transLine = transLines[i] ?? '';

    if (origLine === transLine) {
      for (let c = 0; c < origLine.length; c++) {
        generator.addMapping(i + 1, c, sourceIndex, i + 1, c);
      }
    } else if (!_lineMeaningfullyChanged(origLine, transLine)) {
      const prefixLen = _commonPrefixLen(origLine, transLine);
      const suffixLen = _commonSuffixLen(origLine, transLine);
      for (let c = prefixLen; c < origLine.length - suffixLen; c++) {
        generator.addMapping(i + 1, c, sourceIndex, i + 1, c);
      }
    } else {
      const prefixLen = _commonPrefixLen(origLine, transLine);
      if (prefixLen > 0) {
        for (let c = 0; c < prefixLen; c++) {
          generator.addMapping(i + 1, c, sourceIndex, i + 1, c);
        }
      }
    }
  }

  const sm = generator.generate(transformed);
  return { code: transformed, sourcemap: sm };
}

function _lineMeaningfullyChanged(orig: string, trans: string): boolean {
  if (orig === trans) return false;
  const origTrimmed = orig.trim();
  const transTrimmed = trans.trim();
  if (origTrimmed === transTrimmed) return false;
  return true;
}

function _commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function _commonSuffixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[a.length - 1 - i] === b[b.length - 1 - i]) i++;
  return i;
}

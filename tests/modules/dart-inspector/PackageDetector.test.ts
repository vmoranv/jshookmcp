/**
 * Tests for PackageDetector — aggregation of `package:` references into a
 * deduplicated, stdlib-aware report.
 *
 * Two layers exercised:
 *  - Static `PackageDetector.aggregate()` — pure function on a list of refs.
 *  - `PackageDetector.detect()` — full pipeline including StringsExtractor
 *    integration on a synthetic libapp.so fixture.
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { PackageDetector } from '@modules/dart-inspector/PackageDetector';
import { ToolError } from '@errors/ToolError';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url)).replace(
  /tests[\\/]modules[\\/]dart-inspector$/,
  'tests/fixtures/dart-inspector',
);
const FIXTURE_BIN = join(FIXTURE_DIR, 'packages-libapp.so');
const FIXTURE_JSON = join(FIXTURE_DIR, 'expected-packages.json');

interface ExpectedFixture {
  fixtureSize: number;
  packages: Array<{
    name: string;
    isFlutterStdlib: boolean;
    occurrenceCount: number;
    files: string[];
  }>;
  flutterStdlibPackages: string[];
  thirdPartyPackages: string[];
  invalid: string[];
}

async function loadExpected(): Promise<ExpectedFixture> {
  const raw = await readFile(FIXTURE_JSON, 'utf-8');
  return JSON.parse(raw) as ExpectedFixture;
}

/** Build a synthetic ref list mirroring the fixture's `package:` strings. */
function syntheticRefs(): Array<{ value: string; offsets?: number[] }> {
  return [
    { value: 'package:dio/src/dio.dart', offsets: [100, 220] },
    { value: 'package:dio/src/interceptor.dart', offsets: [140] },
    { value: 'package:dio/dio.dart', offsets: [180] },
    { value: 'package:http/http.dart', offsets: [270] },
    { value: 'package:http/src/client.dart', offsets: [310] },
    { value: 'package:flutter/material.dart', offsets: [700] },
    { value: 'package:flutter/widgets.dart', offsets: [750] },
    { value: 'package:sky_engine/ui.dart', offsets: [990] },
  ];
}

const DEFAULT_AGG = {
  includeFlutterStdlib: false,
  includeFiles: true,
  includeOffsets: false,
  maxFilesPerPackage: 50,
  maxPackages: 1000,
  extra: new Set<string>(),
};

describe('PackageDetector.aggregate', () => {
  it('aggregates refs by package and dedupes file paths', () => {
    const refs = [
      { value: 'package:dio/src/dio.dart' },
      { value: 'package:dio/src/dio.dart' }, // duplicate file
      { value: 'package:dio/dio.dart' },
      { value: 'package:http/http.dart' },
    ];
    const result = PackageDetector.aggregate(refs, DEFAULT_AGG);
    expect(result.packages.map((p) => p.name)).toEqual(['dio', 'http']);
    const dio = result.packages.find((p) => p.name === 'dio');
    expect(dio).toBeDefined();
    expect(dio?.occurrenceCount).toBe(3); // every ref counts, even duplicate file
    expect(dio?.files).toEqual(['package:dio/src/dio.dart', 'package:dio/dio.dart']);
    expect(dio?.isFlutterStdlib).toBe(false);
    expect(result.total).toBe(2);
    expect(result.thirdPartyCount).toBe(2);
    expect(result.flutterStdlibCount).toBe(0);
    expect(result.truncated).toBeUndefined();
  });

  it('filters Flutter stdlib by default but surfaces counts', () => {
    const refs = [
      { value: 'package:flutter/material.dart' },
      { value: 'package:dio/dio.dart' },
      { value: 'package:sky_engine/ui.dart' },
    ];
    const result = PackageDetector.aggregate(refs, DEFAULT_AGG);
    expect(result.packages.map((p) => p.name)).toEqual(['dio']);
    expect(result.total).toBe(1);
    expect(result.flutterStdlibCount).toBe(2);
    expect(result.thirdPartyCount).toBe(1);
  });

  it('includes stdlib entries when includeFlutterStdlib=true', () => {
    const refs = [{ value: 'package:flutter/material.dart' }, { value: 'package:dio/dio.dart' }];
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      includeFlutterStdlib: true,
    });
    expect(result.packages.map((p) => p.name)).toEqual(['dio', 'flutter']);
    const flutter = result.packages.find((p) => p.name === 'flutter');
    expect(flutter?.isFlutterStdlib).toBe(true);
  });

  it('honors extraStdlibPackages overlay (filter mode)', () => {
    const refs = [{ value: 'package:dio/dio.dart' }, { value: 'package:my_corp_base/x.dart' }];
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      extra: new Set(['my_corp_base']),
    });
    expect(result.packages.map((p) => p.name)).toEqual(['dio']);
    expect(result.flutterStdlibCount).toBe(1); // my_corp_base counted as stdlib
    expect(result.thirdPartyCount).toBe(1);
  });

  it('honors extraStdlibPackages overlay (include mode marks as stdlib)', () => {
    const refs = [{ value: 'package:my_corp_base/x.dart' }];
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      includeFlutterStdlib: true,
      extra: new Set(['my_corp_base']),
    });
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.isFlutterStdlib).toBe(true);
  });

  it('strips files when includeFiles=false', () => {
    const refs = [{ value: 'package:dio/dio.dart' }, { value: 'package:dio/src/dio.dart' }];
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      includeFiles: false,
    });
    expect(result.packages).toHaveLength(1);
    expect(result.packages[0]?.files).toBeUndefined();
    expect(result.packages[0]?.filesTruncated).toBeUndefined();
    expect(result.packages[0]?.occurrenceCount).toBe(2);
  });

  it('truncates files when maxFilesPerPackage exceeded', () => {
    const refs = Array.from({ length: 5 }, (_, i) => ({
      value: `package:dio/file${i}.dart`,
    }));
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      maxFilesPerPackage: 2,
    });
    const dio = result.packages[0];
    expect(dio?.files).toHaveLength(2);
    expect(dio?.filesTruncated).toBe(true);
    expect(dio?.occurrenceCount).toBe(5);
  });

  it('truncates overall package list when maxPackages exceeded', () => {
    const refs = Array.from({ length: 10 }, (_, i) => ({
      value: `package:pkg${i}/file.dart`,
    }));
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      maxPackages: 3,
    });
    expect(result.packages).toHaveLength(3);
    expect(result.total).toBe(3);
    expect(result.truncated).toBe(true);
    // sorted lexicographically — pkg0, pkg1, pkg2 first.
    expect(result.packages.map((p) => p.name)).toEqual(['pkg0', 'pkg1', 'pkg2']);
  });

  it('skips malformed package: refs without throwing', () => {
    const refs = [
      { value: 'package:' },
      { value: 'package://double-slash/x.dart' },
      { value: 'not-a-package-ref' },
      { value: 'package:dio/dio.dart' },
    ];
    const result = PackageDetector.aggregate(refs, DEFAULT_AGG);
    expect(result.packages.map((p) => p.name)).toEqual(['dio']);
  });

  it('returns empty report on empty refs', () => {
    const result = PackageDetector.aggregate([], DEFAULT_AGG);
    expect(result.packages).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.flutterStdlibCount).toBe(0);
    expect(result.thirdPartyCount).toBe(0);
    expect(result.truncated).toBeUndefined();
  });

  it('merges offsets across refs when includeOffsets=true', () => {
    const refs = [
      { value: 'package:dio/dio.dart', offsets: [1024, 4096] },
      { value: 'package:dio/src/dio.dart', offsets: [9999] },
      // duplicate offset across refs of same package — should dedupe
      { value: 'package:dio/dio.dart', offsets: [4096, 12345] },
    ];
    const result = PackageDetector.aggregate(refs, {
      ...DEFAULT_AGG,
      includeOffsets: true,
    });
    const dio = result.packages.find((p) => p.name === 'dio');
    expect(dio?.offsets).toEqual([1024, 4096, 9999, 12345]);
  });

  it('omits offsets when includeOffsets=false', () => {
    const refs = [{ value: 'package:dio/dio.dart', offsets: [100, 200] }];
    const result = PackageDetector.aggregate(refs, DEFAULT_AGG);
    expect(result.packages[0]?.offsets).toBeUndefined();
  });
});

describe('PackageDetector.detect — aggregate-only mode', () => {
  it('skips file IO when packageRefs supplied', async () => {
    const detector = new PackageDetector();
    const refs = syntheticRefs().map((r) => r.value);
    const report = await detector.detect({ packageRefs: refs });
    expect(report.packages.length).toBeGreaterThan(0);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    expect(report.scannedBytes).toBeUndefined();
    expect(report.packages.find((p) => p.name === 'dio')).toBeDefined();
    // flutter & sky_engine filtered by default
    expect(report.packages.find((p) => p.name === 'flutter')).toBeUndefined();
    expect(report.packages.find((p) => p.name === 'sky_engine')).toBeUndefined();
  });

  it('accepts pre-extracted PackageRef objects with offsets', async () => {
    const detector = new PackageDetector();
    const report = await detector.detect({
      packageRefs: syntheticRefs(),
      includeOffsets: true,
    });
    const dio = report.packages.find((p) => p.name === 'dio');
    expect(dio?.offsets).toEqual([100, 140, 180, 220]);
  });

  it('rejects calls with neither filePath nor packageRefs', async () => {
    const detector = new PackageDetector();
    await expect(detector.detect({} as never)).rejects.toBeInstanceOf(ToolError);
  });

  it('rejects maxFilesPerPackage=0 with VALIDATION error', async () => {
    const detector = new PackageDetector();
    await expect(
      detector.detect({ packageRefs: ['package:dio/dio.dart'], maxFilesPerPackage: 0 }),
    ).rejects.toThrow(/maxFilesPerPackage/);
  });

  it('rejects empty extraStdlibPackages entry with VALIDATION error', async () => {
    const detector = new PackageDetector();
    await expect(
      detector.detect({
        packageRefs: ['package:dio/dio.dart'],
        extraStdlibPackages: [''],
      }),
    ).rejects.toThrow(/extraStdlibPackages/);
  });
});

describe('PackageDetector.detect — scan mode (full fixture pipeline)', () => {
  it('reports scannedBytes and matches expected packages', async () => {
    const expected = await loadExpected();
    const detector = new PackageDetector();
    const report = await detector.detect({ filePath: FIXTURE_BIN });

    expect(report.scannedBytes).toBe(expected.fixtureSize);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    // Default filter: only third-party packages remain.
    const names = report.packages.map((p) => p.name).toSorted();
    expect(names).toEqual([...expected.thirdPartyPackages].toSorted());

    // Each third-party package has correct files.
    for (const expectedPkg of expected.packages) {
      if (expectedPkg.isFlutterStdlib) continue;
      const actual = report.packages.find((p) => p.name === expectedPkg.name);
      expect(actual, `package ${expectedPkg.name} missing`).toBeDefined();
      expect(actual?.occurrenceCount).toBe(expectedPkg.occurrenceCount);
      expect(actual?.files?.toSorted()).toEqual([...expectedPkg.files].toSorted());
      expect(actual?.isFlutterStdlib).toBe(false);
    }

    // Stdlib counts match the fixture.
    expect(report.flutterStdlibCount).toBe(expected.flutterStdlibPackages.length);
    expect(report.thirdPartyCount).toBe(expected.thirdPartyPackages.length);
  });

  it('surfaces stdlib packages when includeFlutterStdlib=true', async () => {
    const expected = await loadExpected();
    const detector = new PackageDetector();
    const report = await detector.detect({
      filePath: FIXTURE_BIN,
      includeFlutterStdlib: true,
    });
    const names = report.packages.map((p) => p.name).toSorted();
    expect(names).toEqual(
      [...expected.thirdPartyPackages, ...expected.flutterStdlibPackages].toSorted(),
    );
    const flutter = report.packages.find((p) => p.name === 'flutter');
    expect(flutter?.isFlutterStdlib).toBe(true);
  });

  it('emits NOT_FOUND error for missing files', async () => {
    const detector = new PackageDetector();
    await expect(
      detector.detect({ filePath: 'D:/definitely/not/here/libapp.so' }),
    ).rejects.toBeInstanceOf(ToolError);
  });
});

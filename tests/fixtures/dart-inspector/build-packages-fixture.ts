#!/usr/bin/env tsx
/**
 * Build the packages fixture used by PackageDetector tests.
 *
 * Outputs:
 *   tests/fixtures/dart-inspector/packages-libapp.so      (8 KB synthetic binary)
 *   tests/fixtures/dart-inspector/expected-packages.json  (deterministic report)
 *
 * Regenerate with:
 *   pnpm tsx tests/fixtures/dart-inspector/build-packages-fixture.ts
 *
 * Design constraints (see openspec/changes/add-flutter-packages-detect/tasks.md):
 *   - ≥ 3 Flutter SDK stdlib packages (flutter, flutter_test, sky_engine, …)
 *   - ≥ 5 third-party packages (dio, http, provider, riverpod, sqflite, …)
 *   - Every package has ≥ 2 distinct file references so dedup is exercised
 *   - Buffer pre-filled with 0xFF non-printable padding so noise stays invisible.
 *
 * Pure synthetic data — no real APK bytes are reused, this is a one-shot
 * generator that hand-pins every offset for deterministic tests.
 */

import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const BIN_PATH = join(FIXTURE_DIR, 'packages-libapp.so');
const JSON_PATH = join(FIXTURE_DIR, 'expected-packages.json');

const FIXTURE_SIZE = 8192;
const FILL_BYTE = 0xff;

interface PlannedRef {
  /** Full `package:foo/bar.dart` string. */
  value: string;
  /** Absolute byte offset to write the ASCII bytes at. */
  offset: number;
}

// Three stdlib packages (with multiple files each) + five third-party packages.
// Offsets pinned by hand to leave ≥ 4 padding bytes between strings.
const PLAN: readonly PlannedRef[] = [
  // dio — 3 files, one repeated to test occurrenceCount > files.length
  { value: 'package:dio/src/dio.dart', offset: 100 },
  { value: 'package:dio/src/interceptor.dart', offset: 140 },
  { value: 'package:dio/dio.dart', offset: 180 },
  { value: 'package:dio/src/dio.dart', offset: 220 }, // duplicate path

  // http — 2 files
  { value: 'package:http/http.dart', offset: 270 },
  { value: 'package:http/src/client.dart', offset: 310 },

  // provider — 2 files
  { value: 'package:provider/provider.dart', offset: 360 },
  { value: 'package:provider/src/inherited_provider.dart', offset: 410 },

  // riverpod — 2 files
  { value: 'package:riverpod/riverpod.dart', offset: 470 },
  { value: 'package:riverpod/src/framework.dart', offset: 520 },

  // sqflite — 2 files
  { value: 'package:sqflite/sqflite.dart', offset: 580 },
  { value: 'package:sqflite/src/database.dart', offset: 630 },

  // flutter (stdlib) — 3 files
  { value: 'package:flutter/material.dart', offset: 700 },
  { value: 'package:flutter/widgets.dart', offset: 750 },
  { value: 'package:flutter/foundation.dart', offset: 800 },

  // flutter_test (stdlib) — 2 files
  { value: 'package:flutter_test/flutter_test.dart', offset: 860 },
  { value: 'package:flutter_test/src/finders.dart', offset: 920 },

  // sky_engine (stdlib) — 2 files
  { value: 'package:sky_engine/ui.dart', offset: 990 },
  { value: 'package:sky_engine/dart_ui.dart', offset: 1040 },

  // Malformed strings that MUST be skipped by the parser
  { value: 'package:', offset: 1100 },
  { value: 'package://double-slash/x.dart', offset: 1130 },
  // String that isn't a package ref at all (left in to ensure the extractor's
  // packageRefs classifier rule won't even surface it — we don't include it
  // in expected output).
  { value: 'just_some_random_string_value', offset: 1170 },
];

function writeAscii(buf: Buffer, offset: number, value: string): void {
  buf.write(value, offset, 'ascii');
  // Explicit NUL terminator separates strings in the printable scan.
  buf.writeUInt8(0, offset + value.length);
}

function assertPlanFits(plan: readonly PlannedRef[], size: number): void {
  for (const entry of plan) {
    const end = entry.offset + entry.value.length + 1;
    if (end > size) {
      throw new Error(
        `PLAN entry "${entry.value}" at offset ${entry.offset} ends at ${end}, beyond fixture size ${size}`,
      );
    }
  }
}

function buildBuffer(plan: readonly PlannedRef[]): Buffer {
  const buf = Buffer.alloc(FIXTURE_SIZE, FILL_BYTE);
  for (const entry of plan) writeAscii(buf, entry.offset, entry.value);
  return buf;
}

interface ExpectedPackage {
  name: string;
  isFlutterStdlib: boolean;
  occurrenceCount: number;
  files: string[];
}

interface ExpectedReport {
  fixtureSize: number;
  /** Whole set of distinct packages — both stdlib and third-party. */
  packages: ExpectedPackage[];
  flutterStdlibPackages: string[];
  thirdPartyPackages: string[];
  /** Strings that MUST not appear as package entries (malformed refs). */
  invalid: string[];
}

const PACKAGE_REF_REGEX = /^package:([a-z_][a-z0-9_]*)\/([a-z0-9_./]+\.dart)$/i;
const STDLIB = new Set([
  'flutter',
  'flutter_test',
  'flutter_localizations',
  'flutter_driver',
  'flutter_web_plugins',
  'sky_engine',
  'fuchsia_remote_debug_protocol',
]);

function buildExpected(plan: readonly PlannedRef[]): ExpectedReport {
  const map = new Map<string, ExpectedPackage>();
  const invalid: string[] = [];

  // The runtime pipeline pipes refs through StringsExtractor which merges all
  // occurrences of the same string into ONE entry (with merged offsets[]).
  // Mirror that here so expected.occurrenceCount lines up with what
  // PackageDetector.detect() actually sees.
  const seenRef = new Set<string>();
  for (const entry of plan) {
    const m = PACKAGE_REF_REGEX.exec(entry.value);
    if (!m || !m[1]) {
      if (entry.value.startsWith('package:')) invalid.push(entry.value);
      continue;
    }
    if (seenRef.has(entry.value)) continue;
    seenRef.add(entry.value);
    const name = m[1].toLowerCase();
    let pkg = map.get(name);
    if (!pkg) {
      pkg = { name, isFlutterStdlib: STDLIB.has(name), occurrenceCount: 0, files: [] };
      map.set(name, pkg);
    }
    pkg.occurrenceCount += 1;
    if (!pkg.files.includes(entry.value)) pkg.files.push(entry.value);
  }

  const packages = Array.from(map.values()).toSorted((a, b) => (a.name < b.name ? -1 : 1));
  const flutterStdlibPackages = packages.filter((p) => p.isFlutterStdlib).map((p) => p.name);
  const thirdPartyPackages = packages.filter((p) => !p.isFlutterStdlib).map((p) => p.name);

  return {
    fixtureSize: FIXTURE_SIZE,
    packages,
    flutterStdlibPackages,
    thirdPartyPackages,
    invalid,
  };
}

async function main(): Promise<void> {
  assertPlanFits(PLAN, FIXTURE_SIZE);
  const bin = buildBuffer(PLAN);
  const expected = buildExpected(PLAN);

  await writeFile(BIN_PATH, bin);
  await writeFile(JSON_PATH, `${JSON.stringify(expected, null, 2)}\n`);

  // eslint-disable-next-line no-console
  console.log(`wrote ${BIN_PATH} (${bin.length} bytes)`);
  // eslint-disable-next-line no-console
  console.log(`wrote ${JSON_PATH}`);
}

await main();

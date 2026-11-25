/**
 * Flutter SDK first-party (stdlib) package whitelist.
 *
 * Used by {@link PackageDetector} to separate third-party dependencies from
 * packages that ship with the Flutter SDK itself. The list intentionally
 * stays small and curated — a runaway whitelist would mis-classify real
 * third-party packages as stdlib.
 *
 * Source of truth (manually maintained):
 *  - https://api.flutter.dev/flutter/packages.html — Flutter SDK packages
 *  - https://api.dart.dev/stable/dart-core/dart-core-library.html — Dart core libs
 *
 * The review marker below records the Flutter release the snapshot was taken
 * against; bump it whenever the whitelist is refreshed.
 *
 * Dart core libraries (`dart:async`, `dart:io`, …) are referenced via the
 * `dart:` scheme, never `package:`. Names such as `async`, `collection`,
 * `convert`, `ffi`, `isolate`, `js`, and `typed_data` are deliberately NOT
 * listed: they are also real pub.dev packages, and `PackageDetector` strips
 * the `package:` prefix before consulting this set, so including them would
 * silently drop genuine third-party dependencies from the report.
 */

// The Flutter SDK release this whitelist was last reviewed against.
// Exported so downstream tooling can report which SDK the curated set
// corresponds to without duplicating the literal.
export const SDK_SNAPSHOT_VERSION = '3.24.x';

// Whitelist last reviewed against Flutter SDK 3.24.x.

/**
 * Frozen set of Flutter SDK + Dart core package names (lowercase,
 * `^[a-z_][a-z0-9_]*$`). Sorted alphabetically for diff hygiene.
 */
export const FLUTTER_STDLIB_PACKAGES: ReadonlySet<string> = Object.freeze(
  new Set<string>([
    // dart:-only core libs that are not also widely used pub.dev packages.
    // (`async`, `collection`, `convert`, `ffi`, `isolate`, `js`, and
    // `typed_data` are intentionally absent — see the module header.)
    '_internal',
    'core',
    'dart',
    'developer',
    'io',
    'math',
    'mirrors',
    'ui',
    // Flutter SDK first-party packages
    'flutter',
    'flutter_driver',
    'flutter_localizations',
    'flutter_test',
    'flutter_web_plugins',
    'fuchsia_remote_debug_protocol',
    'sky_engine',
  ]),
);

/**
 * Return `true` when `name` is part of the Flutter/Dart stdlib whitelist
 * or appears in the caller-supplied `extra` overlay. `extra` lets a project
 * treat its own foundation packages (e.g. `my_corp_base`) as stdlib without
 * editing this module.
 */
export function isStdlibPackage(name: string, extra?: ReadonlySet<string>): boolean {
  if (FLUTTER_STDLIB_PACKAGES.has(name)) return true;
  if (extra && extra.has(name)) return true;
  return false;
}

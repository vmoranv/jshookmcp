/**
 * ADB Bridge domain benchmark — golden parser vectors for Android device inspection.
 *
 * Ground truth:
 *  - parseGetprop: extracts [key]: [value] pairs and handles bracketed values without truncation
 *  - buildFingerprintSummary: extracts curated model, sdk, abi, securityPatch, and bootloaderLock
 *  - parseLogcatLine: threadtime format timestamp, pid, tid, priority, tag, message extraction
 *  - parsePriorityArg & meetsMinPriority: priority filter logic (V < D < I < W < E < F < S)
 *  - encodeInputText: escapes shell characters and replaces spaces with %s for adb shell input text
 *  - parseProcMaps: parses /proc/pid/maps into structured address range, perms, and pathname records
 */
import { parseGetprop, buildFingerprintSummary } from '@server/domains/adb-bridge/getprop-parser';
import {
  parseLogcatLine,
  parsePriorityArg,
  meetsMinPriority,
} from '@server/domains/adb-bridge/logcat-parser';
import type { BenchSuite } from '../harness';

const SAMPLE_GETPROP = `
[ro.product.model]: [Pixel 7 Pro]
[ro.product.manufacturer]: [Google]
[ro.product.brand]: [google]
[ro.product.device]: [cheetah]
[ro.product.name]: [cheetah]
[ro.build.version.release]: [14]
[ro.build.version.sdk]: [34]
[ro.product.cpu.abi]: [arm64-v8a]
[ro.product.cpu.abilist]: [arm64-v8a]
[ro.build.id]: [UQ1A.240105.004]
[ro.build.fingerprint]: [google/cheetah/cheetah:14/UQ1A.240105.004/11269017:user/release-keys]
[ro.build.version.security_patch]: [2024-01-05]
[ro.boot.vbmeta.device_state]: [locked]
[custom.complex.value]: [nested [brackets] supported]
`;

const SAMPLE_LOGCAT_LINE =
  '03-14 12:34:56.789  1234  5678 W ActivityManager: Force finishing activity com.example/.MainActivity';

function encodeInputText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/\s/g, '%s')
    .replace(/(["'`$&|;<>(){}[\]*?~!])/g, '\\$1');
}

function parseProcMaps(stdout: string): Array<Record<string, string>> {
  const modules: Array<Record<string, string>> = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = line.match(
      /^([0-9a-fA-F]+)-([0-9a-fA-F]+)\s+(\S+)\s+([0-9a-fA-F]+)\s+(\S+)\s+(\d+)\s*(.*)$/,
    );
    if (!match) continue;
    const [, start, end, perms, offset, dev, inode, pathname] = match;
    modules.push({
      start: `0x${(start ?? '').toLowerCase()}`,
      end: `0x${(end ?? '').toLowerCase()}`,
      perms: perms ?? '',
      offset: `0x${(offset ?? '').toLowerCase()}`,
      dev: dev ?? '',
      inode: inode ?? '',
      pathname: pathname?.trim() ?? '',
    });
  }
  return modules;
}

export const adbBridgeSuite: BenchSuite = {
  name: 'adb-bridge-parsers',
  domain: 'adb-bridge',
  description:
    'Golden vectors for Android getprop, logcat threadtime parsing, input escaping, and proc/maps parser',
  cases: [
    {
      name: 'adb_getprop/parse-system-properties',
      tool: 'adb_getprop',
      origin: 'homemade',
      reference:
        'parses sample getprop output, preserving nested brackets in values and key-value mapping',
      run: async () => {
        const entries = parseGetprop(SAMPLE_GETPROP);
        const map = Object.fromEntries(entries.map((e) => [e.key, e.value]));
        return { count: entries.length, map };
      },
      validate: (v) => {
        const { count, map } = v as { count: number; map: Record<string, string> };
        if (count < 13) return `expected at least 13 parsed properties, got ${count}`;
        if (map['ro.product.model'] !== 'Pixel 7 Pro') {
          return `expected model Pixel 7 Pro, got: ${map['ro.product.model']}`;
        }
        if (map['custom.complex.value'] !== 'nested [brackets] supported') {
          return `nested brackets corrupted: ${map['custom.complex.value']}`;
        }
        return true;
      },
    },
    {
      name: 'adb_getprop/fingerprint-summary',
      tool: 'adb_getprop',
      origin: 'homemade',
      reference:
        'curates device fingerprint extracting SDK 34, ABI arm64-v8a, and locked bootloader',
      run: async () => {
        const entries = parseGetprop(SAMPLE_GETPROP);
        const map = Object.fromEntries(entries.map((e) => [e.key, e.value]));
        return buildFingerprintSummary(map);
      },
      validate: (v) => {
        const fp = v as ReturnType<typeof buildFingerprintSummary>;
        if (fp.model !== 'Pixel 7 Pro') return `expected model Pixel 7 Pro, got: ${fp.model}`;
        if (fp.sdk !== '34') return `expected SDK 34, got: ${fp.sdk}`;
        if (fp.abi !== 'arm64-v8a') return `expected abi arm64-v8a, got: ${fp.abi}`;
        if (fp.bootloaderLock !== 'locked')
          return `expected locked bootloader, got: ${fp.bootloaderLock}`;
        return true;
      },
    },
    {
      name: 'adb_logcat_query/threadtime-parser',
      tool: 'adb_logcat_query',
      origin: 'homemade',
      reference: 'parses threadtime format timestamp, pid, tid, priority, tag, and message',
      run: async () => {
        return parseLogcatLine(SAMPLE_LOGCAT_LINE);
      },
      validate: (v) => {
        const line = v as ReturnType<typeof parseLogcatLine>;
        if (line.priority !== 'W') return `expected priority W, got: ${line.priority}`;
        if (line.pid !== 1234) return `expected pid 1234, got: ${line.pid}`;
        if (line.tid !== 5678) return `expected tid 5678, got: ${line.tid}`;
        if (line.tag !== 'ActivityManager') return `expected tag ActivityManager, got: ${line.tag}`;
        return true;
      },
    },
    {
      name: 'adb_logcat_query/priority-filtering',
      tool: 'adb_logcat_query',
      origin: 'homemade',
      reference: 'evaluates meetsMinPriority against W line: meets I and W, rejects E',
      run: async () => {
        const parsed = parseLogcatLine(SAMPLE_LOGCAT_LINE);
        const priI = parsePriorityArg('I');
        const priW = parsePriorityArg('W');
        const priE = parsePriorityArg('E');
        return {
          meetsI: priI ? meetsMinPriority(parsed, priI) : false,
          meetsW: priW ? meetsMinPriority(parsed, priW) : false,
          meetsE: priE ? meetsMinPriority(parsed, priE) : true,
        };
      },
      validate: (v) => {
        const { meetsI, meetsW, meetsE } = v as {
          meetsI: boolean;
          meetsW: boolean;
          meetsE: boolean;
        };
        if (!meetsI) return 'warning log must meet Info priority threshold';
        if (!meetsW) return 'warning log must meet Warn priority threshold';
        if (meetsE) return 'warning log must not meet Error priority threshold';
        return true;
      },
    },
    {
      name: 'adb_input_text/shell-escaping',
      tool: 'adb_input_text',
      origin: 'homemade',
      reference: 'escapes special characters and converts whitespace to %s for input text safety',
      run: async () => {
        return {
          encoded: encodeInputText('Hello World! $PATH & "quote"'),
        };
      },
      validate: (v) => {
        const { encoded } = v as { encoded: string };
        if (!encoded.includes('Hello%sWorld')) return `spaces must be %s: ${encoded}`;
        if (!encoded.includes('\\$PATH')) return `$ must be escaped: ${encoded}`;
        if (!encoded.includes('\\"quote\\"')) return `quotes must be escaped: ${encoded}`;
        return true;
      },
    },
    {
      name: 'adb_proc_maps/maps-parser',
      tool: 'adb_proc_maps',
      origin: 'homemade',
      reference: 'parses /proc/pid/maps entry correctly into start, end, permissions, and pathname',
      run: async () => {
        const sampleMaps =
          '7000000000-7000020000 r-xp 00000000 fe:00 12345 /system/bin/app_process64';
        return parseProcMaps(sampleMaps);
      },
      validate: (v) => {
        const entries = v as ReturnType<typeof parseProcMaps>;
        if (entries.length !== 1) return `expected 1 entry, got ${entries.length}`;
        const entry = entries[0]!;
        if (entry.start !== '0x7000000000')
          return `expected start 0x7000000000, got: ${entry.start}`;
        if (entry.perms !== 'r-xp') return `expected perms r-xp, got: ${entry.perms}`;
        if (entry.pathname !== '/system/bin/app_process64') {
          return `expected pathname /system/bin/app_process64, got: ${entry.pathname}`;
        }
        return true;
      },
    },
  ],
};

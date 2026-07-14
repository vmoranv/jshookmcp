/**
 * GPU detection and classification: cloud GPU, VM GPU, local device.
 *
 * Detects GPU vendor/model via platform-specific commands and classifies
 * results with isCloudGpu / isVirtualMachine flags for VM/cloud triage.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Cloud GPU models (NVIDIA datacenter) ──

/** @internal Exported for testing. */
export const CLOUD_GPU_MODELS = new Set([
  't4',
  'a10g',
  'l4',
  'a100',
  'h100',
  'tesla t4',
  'tesla v100',
  'tesla p100',
  'tesla p40',
  'tesla p4',
  'a10',
  'a40',
]);

// ── VM graphics adapters ──

/** @internal Exported for testing. */
export const VM_GPU_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /vmware/i, name: 'VMware SVGA' },
  { pattern: /virtualbox/i, name: 'VirtualBox Graphics' },
  { pattern: /parallels/i, name: 'Parallels Display' },
  { pattern: /qxl/i, name: 'QXL (QEMU/KVM)' },
  { pattern: /hyper-v/i, name: 'Hyper-V Synthetic' },
  { pattern: /virtio/i, name: 'VirtIO GPU (KVM)' },
  { pattern: /red hat.*virtio/i, name: 'Red Hat VirtIO' },
  { pattern: /microsoft basic render/i, name: 'Microsoft Basic Render' },
  { pattern: /microsoft hyper-v/i, name: 'Microsoft Hyper-V Video' },
];

// ── Public types ──

export interface GpuInfo {
  vendor: string;
  model: string;
  driverVersion?: string;
  memoryMB?: number;
}

export interface GpuDetectResult {
  gpus: GpuInfo[];
  /** True when any GPU is a known cloud/datacenter model. */
  isCloudGpu: boolean;
  /** True when any GPU or display adapter matches known VM patterns. */
  isVirtualMachine: boolean;
  /** Per-GPU classification. */
  classifications: GpuClassification[];
  /** Raw command output for debugging. */
  rawOutput?: string;
  /** Command that produced the output (platform-dependent). */
  method: string;
}

export interface GpuClassification {
  model: string;
  isCloudGpu: boolean;
  isVirtualMachine: boolean;
  reason: string;
}

export interface GpuClassifierInput {
  webglRenderer?: string;
  webgpuDescription?: string;
  deviceName?: string;
}

// ── Detection ──

/** @internal Exported for testing — classify a GPU model string. */
export function classifyGpu(model: string): GpuClassification {
  const lower = model.toLowerCase().trim();

  const cloudMatch = [...CLOUD_GPU_MODELS].find((m) => lower.includes(m));
  const vmMatch = VM_GPU_PATTERNS.find(({ pattern }) => pattern.test(lower));

  return {
    model,
    isCloudGpu: !!cloudMatch,
    isVirtualMachine: !!vmMatch,
    reason: cloudMatch
      ? `Cloud GPU: matched "${cloudMatch}"`
      : vmMatch
        ? `VM GPU: matched "${vmMatch.name}"`
        : 'Local / physical GPU',
  };
}

export function classifyGpuInputs(input: GpuClassifierInput): GpuDetectResult {
  const supplied = [
    ['webglRenderer', input.webglRenderer],
    ['webgpuDescription', input.webgpuDescription],
    ['deviceName', input.deviceName],
  ] as const;
  const gpus: GpuInfo[] = [];
  for (const [, value] of supplied) {
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    gpus.push({ vendor: detectVendor(value), model: value });
  }
  const classifications = gpus.map((gpu) => classifyGpu(gpu.model));
  return {
    gpus,
    classifications,
    isCloudGpu: classifications.some((value) => value.isCloudGpu),
    isVirtualMachine: classifications.some((value) => value.isVirtualMachine),
    method: 'caller-supplied renderer strings',
  };
}

// ── Platform-specific collectors ──

async function detectLinux(): Promise<{ gpus: GpuInfo[]; rawOutput: string }> {
  const rawOutput = await tryCommands([
    {
      cmd: 'nvidia-smi',
      args: ['--query-gpu=name,driver_version,memory.total', '--format=csv,noheader,nounits'],
    },
    { cmd: 'lspci', args: [] },
  ]);

  return { gpus: parseLinuxOutput(rawOutput), rawOutput };
}

async function detectWindows(): Promise<{ gpus: GpuInfo[]; rawOutput: string }> {
  const rawOutput = await tryCommands([
    {
      cmd: 'wmic',
      args: [
        'path',
        'win32_videocontroller',
        'get',
        'name,driverversion,adapterram',
        '/format:csv',
      ],
    },
    {
      cmd: 'powershell',
      args: [
        '-Command',
        'Get-WmiObject Win32_VideoController | Select-Object Name,DriverVersion,AdapterRAM | ConvertTo-Csv -NoTypeInformation',
      ],
    },
  ]);

  return { gpus: parseWindowsOutput(rawOutput), rawOutput };
}

async function detectDarwin(): Promise<{ gpus: GpuInfo[]; rawOutput: string }> {
  const rawOutput = await tryCommands([{ cmd: 'system_profiler', args: ['SPDisplaysDataType'] }]);

  return { gpus: parseMacOutput(rawOutput), rawOutput };
}

// ── Command helpers ──

interface CommandAttempt {
  cmd: string;
  args: string[];
}

async function tryCommands(attempts: CommandAttempt[]): Promise<string> {
  for (const attempt of attempts) {
    try {
      const { stdout } = await execFileAsync(attempt.cmd, attempt.args, {
        timeout: 10_000,
        windowsHide: true,
        maxBuffer: 256 * 1024,
      });
      if (stdout.trim().length > 0) return stdout;
    } catch {
      // Try next command
    }
  }
  return '';
}

// ── Output parsers ──

function parseLinuxOutput(raw: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // nvidia-smi output: "name, driver_version, memory_mb"
    if (trimmed.includes(',')) {
      const parts = trimmed.split(',').map((s) => s.trim());
      gpus.push({
        vendor: detectVendor(parts[0] ?? ''),
        model: parts[0] ?? trimmed,
        driverVersion: parts[1] || undefined,
        memoryMB: parts[2] ? parseFloat(parts[2]) : undefined,
      });
      continue;
    }

    // lspci VGA output
    if (/vga|3d|display/i.test(trimmed)) {
      const model = trimmed.replace(/^[\da-f:.]+ /, '').trim();
      gpus.push({
        vendor: detectVendor(model),
        model,
      });
    }
  }

  // Fallback: treat non-empty output as single unknown GPU
  if (gpus.length === 0 && raw.trim()) {
    gpus.push({ vendor: 'unknown', model: 'Unknown (see rawOutput)' });
  }

  return gpus;
}

function parseWindowsOutput(raw: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = raw.split('\n');

  let headerSkipped = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Skip CSV header and WMIC dashes
    if (
      !headerSkipped ||
      /^-{3,}/.test(trimmed) ||
      /Node,Name/.test(trimmed) ||
      trimmed.startsWith('"#TYPE') ||
      trimmed.startsWith('"Node"')
    ) {
      headerSkipped = true;
      continue;
    }

    const parts = trimmed.split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
    const name = parts[1] ?? parts[0] ?? trimmed;
    if (!name || name === 'Name') continue;

    gpus.push({
      vendor: detectVendor(name),
      model: name,
      driverVersion: parts[2] || undefined,
      memoryMB: parts[3] ? Math.round(parseFloat(parts[3]) / (1024 * 1024)) : undefined,
    });
  }

  if (gpus.length === 0 && raw.trim()) {
    gpus.push({ vendor: 'unknown', model: 'Unknown (see rawOutput)' });
  }

  return gpus;
}

function parseMacOutput(raw: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = raw.split('\n');
  let currentModel = '';
  let currentVendor = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const chipsetMatch = trimmed.match(/Chipset Model:\s*(.+)/i);
    if (chipsetMatch) {
      currentModel = chipsetMatch[1]!.trim();
      currentVendor = detectVendor(currentModel);
      gpus.push({ vendor: currentVendor, model: currentModel });
      continue;
    }

    const vendorMatch = trimmed.match(/Vendor:\s*(.+)/i);
    if (vendorMatch && gpus.length > 0) {
      gpus[gpus.length - 1]!.vendor = vendorMatch[1]!.trim();
      continue;
    }

    const vramMatch = trimmed.match(/VRAM \(Total\):\s*(\d+)\s*MB/i);
    if (vramMatch && gpus.length > 0) {
      gpus[gpus.length - 1]!.memoryMB = parseInt(vramMatch[1]!, 10);
    }
  }

  if (gpus.length === 0 && raw.trim()) {
    gpus.push({ vendor: 'unknown', model: 'Unknown (see rawOutput)' });
  }

  return gpus;
}

function detectVendor(model: string): string {
  const lower = model.toLowerCase();
  if (/nvidia|geforce|quadro|tesla|rtx|gtx/.test(lower)) return 'NVIDIA';
  if (/amd|radeon|firepro|vega|rx\s*\d/.test(lower)) return 'AMD';
  if (/intel|hd graphics|uhd|iris|arc/.test(lower)) return 'Intel';
  if (/apple|m1|m2|m3|m4/.test(lower)) return 'Apple';
  if (/vmware|virtualbox|parallels|qxl|hyper-v|virtio|red hat/.test(lower)) return 'VM';
  return 'unknown';
}

// ── Public API ──

export async function detectGpu(): Promise<GpuDetectResult> {
  let raw: { gpus: GpuInfo[]; rawOutput: string };
  let method: string;

  switch (process.platform) {
    case 'linux':
      raw = await detectLinux();
      method = 'nvidia-smi / lspci';
      break;
    case 'win32':
      raw = await detectWindows();
      method = 'wmic / powershell';
      break;
    case 'darwin':
      raw = await detectDarwin();
      method = 'system_profiler SPDisplaysDataType';
      break;
    default:
      return {
        gpus: [],
        isCloudGpu: false,
        isVirtualMachine: false,
        classifications: [],
        method: `unsupported platform: ${process.platform}`,
      };
  }

  const classifications = raw.gpus.map((g) => classifyGpu(g.model));
  const isCloudGpu = classifications.some((c) => c.isCloudGpu);
  const isVirtualMachine = classifications.some((c) => c.isVirtualMachine);

  return {
    gpus: raw.gpus,
    isCloudGpu,
    isVirtualMachine,
    classifications,
    rawOutput: raw.rawOutput || undefined,
    method,
  };
}

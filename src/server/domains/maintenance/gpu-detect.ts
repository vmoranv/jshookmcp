/**
 * GPU detection and classification: cloud GPU, VM GPU, local device.
 *
 * Detects GPU vendor/model via platform-specific commands and classifies
 * results with isCloudGpu / isVirtualMachine flags for VM/cloud triage.
 */

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

  // Word-boundary match so 'a40' does not match 'RTX A4000' nor 'a100' match 'A1000'.
  let cloudMatch: string | undefined;
  for (const m of CLOUD_GPU_MODELS) {
    if (new RegExp(`\\b${m}\\b`).test(lower)) {
      cloudMatch = m;
      break;
    }
  }
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

export function parseLinuxOutput(raw: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = raw.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // nvidia-smi output: "name, driver_version, memory_mb".
    // lspci lines start with a bus address (01:00.0 by default, 0000:01:00.0
    // with -v) and may contain commas in device names — never treat those as
    // nvidia-smi rows.
    if (trimmed.includes(',') && !/^(?:[\da-f]{4}:)?[\da-f]{2}:[\da-f]{2}\.\d/.test(trimmed)) {
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

/** @internal Exported for testing — parse system_profiler SPDisplaysDataType output. */
export function parseMacOutput(raw: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = raw.split('\n');
  let currentModel = '';
  let pendingVendor = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const chipsetMatch = trimmed.match(/Chipset Model:\s*(.+)/i);
    if (chipsetMatch) {
      currentModel = chipsetMatch[1]!.trim();
      gpus.push({ vendor: pendingVendor || detectVendor(currentModel), model: currentModel });
      pendingVendor = '';
      continue;
    }

    const vendorMatch = trimmed.match(/Vendor:\s*(.+)/i);
    if (vendorMatch) {
      if (gpus.length > 0) {
        // Normal order: Vendor follows Chipset Model — apply to the most recent
        // entry so dual-GPU Macs keep per-GPU vendors.
        gpus[gpus.length - 1]!.vendor = vendorMatch[1]!.trim();
      } else {
        // Some macOS versions print Vendor before any Chipset Model — buffer it
        // for the first entry.
        pendingVendor = vendorMatch[1]!.trim();
      }
      continue;
    }

    // Apple Silicon reports VRAM in GB, Intel Macs in MB.
    const vramMatch = trimmed.match(/VRAM \(Total\):\s*(\d+)\s*(MB|GB)/i);
    if (vramMatch && gpus.length > 0) {
      const vram = parseInt(vramMatch[1]!, 10);
      gpus[gpus.length - 1]!.memoryMB = vramMatch[2]!.toUpperCase() === 'GB' ? vram * 1024 : vram;
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

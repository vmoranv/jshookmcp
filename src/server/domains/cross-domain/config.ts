export interface CrossDomainConfig {
  fridaEnabled: boolean;
  fridaServerHost: string;
  fridaServerPort: number;
  ghidraEnabled: boolean;
  ghidraHeadlessPath: string | null;
  unidbgEnabled: boolean;
  unidbgJarPath: string | null;
  etwEnabled: boolean;
  etwSessionName: string;
  mojoEnabled: boolean;
  mojoInterfaceRegistryPath: string | null;
  boringsslEnabled: boolean;
  boringsslCertPath: string | null;
  platform: string;
}

let cachedConfig: CrossDomainConfig | null = null;

function readBool(envKey: string, defaultValue: boolean): boolean {
  const raw = process.env[envKey];
  if (raw === undefined) {
    return defaultValue;
  }
  return raw.toLowerCase() !== 'false' && raw !== '0';
}

function readString(envKey: string, defaultValue: string): string {
  return process.env[envKey] ?? defaultValue;
}

function readInt(envKey: string, defaultValue: number): number {
  const raw = process.env[envKey];
  if (raw === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readPath(envKey: string): string | null {
  const raw = process.env[envKey];
  if (raw === undefined || raw.trim() === '') {
    return null;
  }
  return raw.trim();
}

function buildConfig(): CrossDomainConfig {
  const ghidraHeadlessPath = readPath('GHIDRA_HEADLESS_PATH');
  const unidbgJarPath = readPath('UNIDBG_JAR_PATH');
  const mojoInterfaceRegistryPath = readPath('MOJO_INTERFACE_REGISTRY_PATH');
  const boringsslCertPath = readPath('BORINGSSL_CERT_PATH');
  const platform = process.platform;

  return {
    fridaEnabled: readBool('FRIDA_ENABLED', true),
    fridaServerHost: readString('FRIDA_SERVER_HOST', '127.0.0.1'),
    fridaServerPort: readInt('FRIDA_SERVER_PORT', 27042),
    ghidraEnabled: ghidraHeadlessPath !== null,
    ghidraHeadlessPath,
    unidbgEnabled: unidbgJarPath !== null,
    unidbgJarPath,
    etwEnabled: platform === 'win32',
    etwSessionName: readString('ETW_SESSION_NAME', 'jshookmcp_etw'),
    mojoEnabled: readBool('MOJO_ENABLED', true),
    mojoInterfaceRegistryPath,
    boringsslEnabled: readBool('BORINGSSL_ENABLED', true),
    boringsslCertPath,
    platform,
  };
}

export function getCrossDomainConfig(): CrossDomainConfig {
  if (cachedConfig !== null) {
    return cachedConfig;
  }
  cachedConfig = buildConfig();
  return cachedConfig;
}

/** Reset cached config — for testing only. */
export function resetConfigCache(): void {
  cachedConfig = null;
}

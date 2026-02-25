export interface Config {
  llm: LLMConfig;
  puppeteer: PuppeteerConfig;
  mcp: MCPConfig;
  cache: CacheConfig;
  performance: PerformanceConfig;
}

export interface LLMConfig {
  provider: 'openai' | 'anthropic';
  openai?: {
    apiKey: string;
    model: string;
    baseURL?: string;
  };
  anthropic?: {
    apiKey: string;
    model: string;
    baseURL?: string;
  };
}

export interface PuppeteerConfig {
  headless: boolean;
  timeout: number;
  executablePath?: string;
  args?: string[];
  viewport?: { width: number; height: number };
  userAgent?: string;
  maxCollectedUrls?: number;
  maxFilesPerCollect?: number;
  maxTotalContentSize?: number;
  maxSingleFileSize?: number;
}

export interface MCPConfig {
  name: string;
  version: string;
}

export interface CacheConfig {
  enabled: boolean;
  dir: string;
  ttl: number;
}

export interface PerformanceConfig {
  maxConcurrentAnalysis: number;
  maxCodeSizeMB: number;
}

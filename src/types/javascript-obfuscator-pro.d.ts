declare module 'javascript-obfuscator' {
  export function obfuscatePro(
    sourceCode: string,
    options: {
      vmObfuscation?: boolean;
      parseHtml?: boolean;
      compact?: boolean;
    },
    config: {
      apiToken: string;
      version?: string;
      timeout?: number;
    },
  ): Promise<{
    getObfuscatedCode(): string;
    getSourceMap?(): string;
  }>;
}

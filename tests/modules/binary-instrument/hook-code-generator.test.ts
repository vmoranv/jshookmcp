import { describe, expect, it } from 'vitest';
import { HookCodeGenerator } from '@modules/binary-instrument/HookCodeGenerator';
import type { GhidraAnalysisOutput, HookTemplate } from '@modules/binary-instrument/types';

function makeGhidraOutput(overrides: Partial<GhidraAnalysisOutput> = {}): GhidraAnalysisOutput {
  return {
    functions: [],
    callGraph: [],
    strings: [],
    imports: [],
    decompilations: [],
    ...overrides,
  };
}

describe('HookCodeGenerator', () => {
  const generator = new HookCodeGenerator();

  describe('generateHooks', () => {
    it('returns empty array when no functions match patterns', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'someRandomFunc',
            address: '0x1000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toEqual([]);
    });

    it('generates JNI hooks for Java_ prefixed functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'Java_com_example_Native_nativeMethod',
            address: '0x1000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'Java_com_example_Native_nativeMethod',
        description: expect.stringContaining('JNI'),
      });
      const t0 = templates[0]!;
      expect(t0.hookCode).toContain('Java.perform');
      expect(t0.hookCode).toContain('Interceptor.attach');
    });

    it('generates crypto hooks for AES functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'AES_encrypt',
            address: '0x2000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        imports: [],
        strings: ['AES encryption'],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'AES_encrypt',
        description: expect.stringContaining('AES'),
      });
      expect(templates[0]!.hookCode).toContain('hexdump');
    });

    it('generates crypto hooks for MD5 functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'md5_update',
            address: '0x3000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'md5_update',
        description: expect.stringContaining('MD5'),
      });
    });

    it('generates crypto hooks for SHA functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'sha256_compute',
            address: '0x4000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'sha256_compute',
        description: expect.stringContaining('SHA'),
      });
    });

    it('generates crypto hooks for RSA functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'RSA_private_decrypt',
            address: '0x5000',
            signature: 'int()',
            returnType: 'int',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'RSA_private_decrypt',
        description: expect.stringContaining('RSA'),
      });
    });

    it('generates crypto hooks for Base64 functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'base64_decode',
            address: '0x6000',
            signature: 'char*()',
            returnType: 'char*',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'base64_decode',
        description: expect.stringContaining('Base64'),
      });
    });

    it('generates network hooks for send/recv functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'socket_send',
            address: '0x7000',
            signature: 'int()',
            returnType: 'int',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'socket_send',
        description: expect.stringContaining('Network'),
      });
    });

    it('generates network hooks for http functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'http_request_send',
            address: '0x8000',
            signature: 'int()',
            returnType: 'int',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'http_request_send',
        description: expect.stringContaining('Network'),
      });
    });

    it('generates file I/O hooks for open/read/write functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'fopen_secure',
            address: '0x9000',
            signature: 'FILE*()',
            returnType: 'FILE*',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'fopen_secure',
        description: expect.stringContaining('File I/O'),
      });
    });

    it('generates string operation hooks for memcpy functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'safe_memcpy',
            address: '0xA000',
            signature: 'void*()',
            returnType: 'void*',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'safe_memcpy',
        description: expect.stringContaining('String'),
      });
    });

    it('detects obfuscation from string hints', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'decrypt_string',
            address: '0xB000',
            signature: 'char*()',
            returnType: 'char*',
            parameters: [],
          },
        ],
        imports: [],
        strings: ['string encryption', 'obfuscation layer'],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'decrypt_string',
        description: expect.stringContaining('obfuscation'),
      });
    });

    it('classifies based on imports when function name is ambiguous', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'process_data',
            address: '0xC000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        imports: ['AES_set_encrypt_key', 'AES_cbc_encrypt'],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(1);
      expect(templates[0]).toMatchObject({
        functionName: 'process_data',
        description: expect.stringContaining('AES'),
      });
    });

    it('generates generic hooks for unclassified functions', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'sub_1000',
            address: '0x1000',
            signature: 'int()',
            returnType: 'int',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(0); // unclassified functions are skipped
    });

    it('handles multiple functions of different categories', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'Java_com_example_init',
            address: '0x1000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
          {
            name: 'AES_encrypt',
            address: '0x2000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
          {
            name: 'send_packet',
            address: '0x3000',
            signature: 'int()',
            returnType: 'int',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates).toHaveLength(3);
      expect(templates.map((t) => t.functionName)).toEqual([
        'Java_com_example_init',
        'AES_encrypt',
        'send_packet',
      ]);
    });

    it('includes parameters in hook templates', () => {
      const input = makeGhidraOutput({
        functions: [
          {
            name: 'Java_com_example_test',
            address: '0x1000',
            signature: 'void()',
            returnType: 'void',
            parameters: [],
          },
        ],
        imports: [],
        strings: [],
      });

      const templates = generator.generateHooks(input);

      expect(templates[0]!.parameters.length).toBeGreaterThan(0);
      expect(templates[0]!.parameters[0]).toHaveProperty('name');
      expect(templates[0]!.parameters[0]).toHaveProperty('type');
      expect(templates[0]!.parameters[0]).toHaveProperty('description');
    });
  });

  describe('exportScript', () => {
    it('generates a valid Frida script with header', () => {
      const templates: HookTemplate[] = [
        {
          functionName: 'test_func',
          hookCode: 'Java.perform(function() { console.log("hook"); });',
          description: 'Test hook',
          parameters: [],
        },
      ];

      const script = generator.exportScript(templates, 'frida');

      expect(script).toContain('Frida hook script');
      expect(script).toContain('auto-generated');
      expect(script).toContain('console.log("hook")');
    });

    it('includes all hook codes in the output', () => {
      const templates: HookTemplate[] = [
        {
          functionName: 'func1',
          hookCode: '// hook 1',
          description: 'Hook 1',
          parameters: [],
        },
        {
          functionName: 'func2',
          hookCode: '// hook 2',
          description: 'Hook 2',
          parameters: [],
        },
      ];

      const script = generator.exportScript(templates, 'frida');

      expect(script).toContain('// hook 1');
      expect(script).toContain('// hook 2');
    });

    it('throws for unsupported format', () => {
      const templates: HookTemplate[] = [];

      expect(() => generator.exportScript(templates, 'python')).toThrow(
        'Unsupported export format',
      );
    });

    it('handles empty templates array', () => {
      const script = generator.exportScript([], 'frida');

      expect(script).toContain('Frida hook script');
      expect(script).toContain('Hook count: 0');
    });
  });
});

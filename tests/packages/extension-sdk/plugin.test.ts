import { describe, it, expect, vi } from 'vitest';
import {
  createExtension,
  ExtensionBuilder,
  jsonResponse,
  errorResponse,
} from '../../../packages/extension-sdk/src/plugin';

describe('plugin', () => {
  describe('Response helpers', () => {
    it('should create a JSON response', () => {
      const res = jsonResponse({ hello: 'world' });
      expect(res).toEqual({
        content: [{ type: 'text', text: JSON.stringify({ hello: 'world' }, null, 2) }],
      });
    });

    it('should create an error response', () => {
      const err = new Error('Test error');
      const res = errorResponse('test-tool', err, { extraField: 123 });
      expect(res.isError).toBeUndefined(); // It doesn't set isError
      expect(res.content[0].type).toBe('text');
      const payload = JSON.parse((res.content[0] as any).text);
      expect(payload.success).toBe(false);
      expect(payload.tool).toBe('test-tool');
      expect(payload.error).toBe('Test error');
      expect(payload.extraField).toBe(123);
    });
  });

  describe('ExtensionBuilder', () => {
    it('should initialize with id and version', () => {
      const ext = createExtension('test-id', '1.0.0');
      expect(ext.id).toBe('test-id');
      expect(ext.version).toBe('1.0.0');
      expect(ext.profiles).toEqual(['full']); // default
      expect(ext.compatibleCoreRange).toBe('>=0.1.0');
    });

    it('should allow setting metadata and options', () => {
      const ext = new ExtensionBuilder('id', 'ver')
        .name('custom-name')
        .description('desc')
        .author('author')
        .sourceRepo('https://repo')
        .compatibleCore('>=1.0.0')
        .profile(['search', 'workflow'])
        .allowCommand('npm')
        .allowCommand(['git', 'npx'])
        .allowHost('localhost')
        .allowHost(['api.example.com'])
        .allowTool('tool1')
        .allowTool(['tool2'])
        .metric('metric1')
        .metric(['metric2'])
        .configDefault('k', 'v');

      expect(ext.pluginName).toBe('custom-name');
      expect(ext.pluginDescription).toBe('desc');
      expect(ext.pluginAuthor).toBe('author');
      expect(ext.pluginSourceRepo).toBe('https://repo');
      expect(ext.compatibleCoreRange).toBe('>=1.0.0');
      expect(ext.profiles).toEqual(['search', 'workflow']);
      expect(ext.allowedCommands).toEqual(['npm', 'git', 'npx']);
      expect(ext.allowedHosts).toEqual(['localhost', 'api.example.com']);
      expect(ext.allowedTools).toEqual(['tool1', 'tool2']);
      expect(ext.declaredMetrics).toEqual(['metric1', 'metric2']);
      expect(ext.configDefaults).toEqual({ k: 'v' });
    });

    it('should merge metatada correctly', () => {
      const ext = createExtension('id', 'ver');

      ext.mergeMetadata({
        name: 'meta-name',
        description: 'meta-desc',
        author: 'meta-author',
        source_repo: 'meta-repo',
      });

      expect(ext.pluginName).toBe('meta-name');
      expect(ext.pluginDescription).toBe('meta-desc');
      expect(ext.pluginAuthor).toBe('meta-author');
      expect(ext.pluginSourceRepo).toBe('meta-repo');

      // Merge should not override explicitly set fields
      ext.name('explicit-name');
      ext.mergeMetadata({ name: 'meta-name-2' });
      expect(ext.pluginName).toBe('explicit-name');
    });

    it('should add tools', () => {
      const ext = createExtension('id', 'ver');
      const handler = vi.fn();
      ext.tool('toolName', 'toolDesc', { prop: { type: 'string' } }, handler, ['search']);

      expect(ext.tools).toHaveLength(1);
      const tool = ext.tools[0];
      expect(tool.name).toBe('toolName');
      expect(tool.description).toBe('toolDesc');
      expect(tool.schema).toEqual({ type: 'object', properties: { prop: { type: 'string' } } });
      expect(tool.handler).toBe(handler);
      expect(tool.profiles).toEqual(['search']);
    });

    it('should add workflows', () => {
      const ext = createExtension('id', 'ver');
      const wf1: any = { id: 'wf1' };
      const wf2: any = { id: 'wf2' };
      ext.workflow(wf1);
      ext.workflow([wf2]);

      expect(ext.workflows).toEqual([wf1, wf2]);
    });

    it('should set lifecycle handlers', () => {
      const ext = createExtension('id', 'ver');

      const onLoad = vi.fn();
      const onValidate = vi.fn();
      const onActivate = vi.fn();
      const onDeactivate = vi.fn();

      ext.onLoad(onLoad);
      ext.onValidate(onValidate);
      ext.onActivate(onActivate);
      ext.onDeactivate(onDeactivate);

      expect(ext.onLoadHandler).toBe(onLoad);
      expect(ext.onValidateHandler).toBe(onValidate);
      expect(ext.onActivateHandler).toBe(onActivate);
      expect(ext.onDeactivateHandler).toBe(onDeactivate);
    });
  });
});

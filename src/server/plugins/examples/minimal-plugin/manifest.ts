// @ts-ignore
import { createExtension } from '@jshookmcp/extension-sdk';

export default createExtension('example.minimal', '1.0.0')
  .name('Minimal Example Plugin')
  .description('A super basic plugin with a fluent builder')
  .allowCommand(['echo', 'ping'])
  .tool(
    'echo',
    'Echoes back the input',
    {
      type: 'object',
      properties: { text: { type: 'string' } },
      required: ['text']
    },
    async (args: unknown) => {
      return {
        content: [{ type: 'text', text: `Echo: ${(args as { text: string }).text}` }]
      };
    }
  )
  .onLoad(async (ctx: any) => {
    ctx.setRuntimeData('loaded', true);
  });


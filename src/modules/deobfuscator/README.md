# JSHook MCP Deobfuscator Module

Multi-chain JavaScript deobfuscator/packer with Pro API support, Anti-LLM detection, and comprehensive code analysis.

## Features

### Core Capabilities
- **Multi-chain bundle unpacking** via Webcrack
- **Obfuscation type detection** (35+ patterns)
- **AST transformation** (4 optimization passes)
- **Control flow restoration**
- **String array reconstruction**
- **Anti-debug removal**
- **Constant propagation**
- **Dead code elimination**

### Advanced Features
1. **Pro API Integration** - Obfuscator.io VM obfuscation
   - Cloud-based VM bytecode obfuscation
   - HTML parsing support
   - Large file support (>4.4MB)
   - Specific version control

2. **Anti-LLM Detection** - Protection against AI-based deobfuscation
   - Poisoned identifier detection
   - String table poisoning analysis
   - LLM deobfuscation risk assessment
   - Semantic verification

### Build Tool Integrations
- Webpack@5 plugin (skeleton ready)
- Vite plugin (skeleton ready)
- Rollup plugin (skeleton ready)
- Gulp plugin (skeleton ready)

## Installation

```bash
# For development
pnpm add --save-dev jshook-mcp

# Environment configuration
cp .env.example .env
# Edit .env with your Pro API token if needed
```

## Usage

### Basic Deobfuscation

```typescript
import { Deobfuscator } from '@modules/deobfuscator';

const deobfuscator = new Deobfuscator();
const result = await deobfuscator.deobfuscate({
  code: 'var _0xabc123 = 123; function test() { return _0xabc123; }'
});

console.log(result.code); // Deobfuscated code
console.log(result.obfuscationType); // Detected types
console.log(result.readabilityScore); // 0-100
console.log(result.confidence); // 0-1
```

### With Pro API

```typescript
// Via CLI
jshook --pro-api-token your-token-here input.js

// Via environment variable
export OBFUSCATOR_IO_API_TOKEN=your-token-here
jshook input.js

// In code
const result = await deobfuscator.deobfuscate({
  code: inputCode,
  proApiToken: 'your-token-here',
  vmObfuscation: true
});
```

### CLI Commands

```bash
# Basic deobfuscation
jshook input.js

# With Pro API
jshook --pro-api-token abcdefghij1234567890 input.js

# With specific version
jshook --pro-api-token abcdefghij1234567890 --pro-api-version 5.4.1 input.js

# Output to specific file
jshook --pro-api-token abcdefghij1234567890 input.js --output output.js
```

## Configuration

### Environment Variables

```bash
OBFUSCATOR_IO_API_TOKEN=your-api-token-here      # Pro API access
OBFUSCATOR_IO_VERSION=5.4.1                       # Specific Obfuscator version
```

### Options Reference

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `code` | string | - | JavaScript code to deobfuscate |
| `proApiToken` | string | `OBFUSCATOR_IO_API_TOKEN` | Pro API token |
| `proApiVersion` | string | latest | Obfuscator version |
| `vmObfuscation` | boolean | false | Use Pro VM obfuscation |
| `parseHtml` | boolean | false | Parse HTML with inline JS |
| `unpack` | boolean | true | Bundle unpacking |
| `unminify` | boolean | true | Code unminification |
| `jsx` | boolean | false | JSX support |
| `mangle` | boolean | false | Variable renaming |

## API Reference

### Deobfuscator

```typescript
class Deobfuscator {
  async deobfuscate(options: DeobfuscateOptions): Promise<DeobfuscateResult>
}
```

### DeobfuscateResult

```typescript
interface DeobfuscateResult {
  code: string;                    // Deobfuscated code
  readabilityScore: number;        // 0-100 score
  confidence: number;              // 0-1 confidence
  obfuscationType: string[];       // Detected types
  transformations: Transformation[]; // Applied transformations
  analysis: string;                // Analysis summary
  bundle?: BundleSummary;          // Bundle info (if unpacked)
  savedTo?: string;                // Output path
  savedArtifacts?: SavedArtifact[]; // Saved files
  warnings?: string[];             // Warnings
  engine?: string;                 // Engine used
  proApiUsed?: boolean;            // Pro API used
  cached?: boolean;                // From cache
}
```

## Anti-LLM Detection

### Detect Poisoned Identifiers

```typescript
import { detectPoisonedIdentifiers } from '@modules/deobfuscator/AntiLlmDeobfuscation';

const result = detectPoisonedIdentifiers(obfuscatedCode);

if (result.detected) {
  console.log(`Found ${result.poisonedCount} poisoned identifiers`);
  console.log(result.poisonedIdentifiers);
}
```

### Risk Assessment

```typescript
import { assessLlmDeobfuscationRisk } from '@modules/deobfuscator/AntiLlmDeobfuscation';

const risk = assessLlmDeobfuscationRisk(obfuscatedCode);

if (risk.severity === 'high') {
  console.log('High LLM deobfuscation resistance detected');
  console.log(risk.factors);
}
```

## Build Tool Usage

### Webpack

```javascript
// webpack.config.js
const JSHookWebpackPlugin = require('jshook-mcp-webpack-plugin');

module.exports = {
  plugins: [
    new JSHookWebpackPlugin({
      enabled: true,
      proApiToken: process.env.JSHOOK_PRO_API_TOKEN,
      verbose: true
    })
  ]
};
```

### Vite

```javascript
// vite.config.ts
import JSHookVitePlugin from 'jshook-mcp-vite-plugin';

export default defineConfig({
  plugins: [JSHookVitePlugin()]
});
```

## Performance

- **Caching**: LRU cache (100 entries, 30s TTL)
- **Timeout**: 30s maximum per deobfuscation
- **Input Size**: 5MB maximum
- **Memory**: <500MB peak usage

## Testing

```bash
# Run all tests
pnpm test

# Run specific module tests
pnpm test -- tests/modules/deobfuscator/ProApiClient.test.ts
pnpm test -- tests/modules/deobfuscator/AntiLlmDeobfuscation.test.ts

# Type check
pnpm run typecheck

# Lint
pnpm run lint

# Format
pnpm run format
```

## Troubleshooting

### Pro API Errors

```bash
# Check token is set
echo $OBFUSCATOR_IO_API_TOKEN

# Check token length (must be at least 10 chars)
# Use CLI validation
jshook --pro-api-token short  # Should fail
```

### Build Tool Issues

1. Check `package.json` dependencies are installed
2. Verify TypeScript compilation: `pnpm run build`
3. Check for missing environment variables

## Contributing

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for details.

## License

AGPL-3.0 - See [LICENSE](../../LICENSE) for details.

## Support

For issues and feature requests, see the main repository issues page.

---

*Internal use only - JSHook MCP Security Lab*

import type { DomainManifest } from '@server/registry/contracts';
import { DeobfuscationHandler } from './DeobfuscationHandler';
import jscodeshiftDeobfuscationWorkflow from './workflows/jscodeshift-deobfuscation.workflow';
import shiftRefactorDeobfuscationWorkflow from './workflows/shift-refactor-deobfuscation.workflow';
import javascriptObfuscatorProWorkflow from './workflows/javascript-obfuscator-pro.workflow';
import aiAssistedDeobfuscationWorkflow from './workflows/ai-assisted-deobfuscation.workflow';

const deobfuscationManifest: DomainManifest<'deobfuscationHandler', DeobfuscationHandler> = {
  kind: 'domain-manifest',
  version: 1,
  domain: 'deobfuscation',
  depKey: 'deobfuscationHandler',
  profiles: ['full', 'workflow'],
  registrations: [
    // Tools
    {
      tool: {
        name: 'deobfuscation.parse_ast',
        description: 'Parse JavaScript code into an AST using recast or shift-parser.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            parser: { type: 'string', enum: ['recast', 'shift'] },
          },
          required: ['code', 'parser'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ast: { type: 'object' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.parseAST.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.apply_transform',
        description: 'Apply a transformation to an AST (e.g., control flow normalization).',
        inputSchema: {
          type: 'object',
          properties: {
            transform: { type: 'string' },
            ast: { type: 'object' },
          },
          required: ['transform', 'ast'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ast: { type: 'object' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.applyTransform.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.generate_code',
        description: 'Generate JavaScript code from an AST using escodegen or shift.',
        inputSchema: {
          type: 'object',
          properties: {
            ast: { type: 'object' },
            generator: { type: 'string', enum: ['escodegen', 'shift'] },
          },
          required: ['ast', 'generator'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.generateCode.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.analyze_vm_bytecode',
        description: 'Analyze VM-obfuscated bytecode using JavaScript Obfuscator Pro API.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            bytecode: { type: 'string' },
            vmMetadata: { type: 'object' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.analyzeVMBytecode,
    },
    {
      tool: {
        name: 'deobfuscation.emulate_vm',
        description: 'Emulate VM bytecode to recover original logic.',
        inputSchema: {
          type: 'object',
          properties: {
            bytecode: { type: 'string' },
          },
          required: ['bytecode'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            state: { type: 'object' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.emulateVM,
    },
    {
      tool: {
        name: 'deobfuscation.reconstruct_control_flow',
        description: 'Reconstruct control flow from VM state.',
        inputSchema: {
          type: 'object',
          properties: {
            vmState: { type: 'object' },
          },
          required: ['vmState'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ast: { type: 'object' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.reconstructControlFlow,
    },
    {
      tool: {
        name: 'deobfuscation.detect_obfuscation_patterns',
        description: 'Detect obfuscation patterns using HuggingFace Transformers.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            patterns: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.detectObfuscationPatterns.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.explain_code_openai',
        description: 'Explain obfuscated code using OpenAI GPT.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            patterns: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['code', 'patterns'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            explanation: { type: 'string' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.explainCodeOpenAI.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.explain_code_huggingface',
        description: 'Explain obfuscated code using HuggingFace Transformers.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            patterns: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['code', 'patterns'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            explanation: { type: 'string' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.explainCodeGroq.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.suggest_transformations',
        description: 'Suggest deobfuscation transformations based on detected patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            patterns: {
              type: 'array',
              items: { type: 'string' },
            },
            explanation: { type: 'string' },
          },
          required: ['patterns', 'explanation'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            transformations: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.suggestTransformations.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.run_pipeline',
        description:
          'Run the full deobfuscation pipeline: Unicode normalization, escape decoding, universal unpacker (Packer/AAEncode/URLEncode/Hex/Base64), webcrack bundle unpacking, string array derotation, dead code removal, opaque predicate removal, string decoding, and AST optimization.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to deobfuscate' },
            unpack: { type: 'boolean', default: true },
            unminify: { type: 'boolean', default: true },
            jsx: { type: 'boolean', default: true },
            mangle: { type: 'boolean', default: false },
            timeout: { type: 'number', default: 30000 },
            skipWebcrack: { type: 'boolean', default: false },
            skipAST: { type: 'boolean', default: false },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            originalCode: { type: 'string' },
            readabilityScore: { type: 'number' },
            readabilityScoreBefore: { type: 'number' },
            confidence: { type: 'number' },
            obfuscationTypes: { type: 'array', items: { type: 'string' } },
            steps: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  stage: { type: 'string' },
                  applied: { type: 'boolean' },
                  codeLength: { type: 'number' },
                  readabilityDelta: { type: 'number' },
                  warnings: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.runPipeline.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.humanizeCode',
        description: '🤖 AI-Powered Code Humanization: Transform deobfuscated code into readable, commented, and idiomatic JavaScript using OpenAI, HuggingFace, or Grok. Perfect for post-deobfuscation cleanup or pre-analysis optimization!',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            models: {
              type: 'array',
              items: { type: 'string' },
              default: ['openai'],
            },
            aggressiveness: {
              type: 'number',
              minimum: 1,
              maximum: 10,
              default: 5,
            },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            humanizedCode: { type: 'string' },
            suggestions: {
              type: 'array',
              items: { type: 'string' },
            },
            modelConsensus: {
              type: 'object',
              additionalProperties: {
                type: 'object',
                properties: {
                  code: { type: 'string' },
                  suggestions: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  model: { type: 'string' },
                },
              },
            },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.humanizeCode,
    },
    {
      tool: {
        name: 'deobfuscation.runtime_tracer',
        description: 'Execute JavaScript code in a sandboxed environment (Puppeteer/QuickJS) and log runtime behavior including function calls, variable mutations, network requests, DOM manipulations, and anti-debugging tricks. Returns a structured JSON report with execution timeline and suspicious patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to trace' },
            sandboxMode: { type: 'string', enum: ['browser', 'quickjs'], default: 'browser', description: 'Execution environment' },
            antiDebugging: {
              type: 'object',
              properties: {
                detectDebugger: { type: 'boolean', default: true },
                detectTimingAttacks: { type: 'boolean', default: true },
                detectEnvironmentChecks: { type: 'boolean', default: true },
              },
            },
            captureScreenshots: { type: 'boolean', default: false, description: 'Capture screenshots during execution' },
            timeout: { type: 'number', default: 30000, description: 'Execution timeout in milliseconds' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            executionTimeline: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  timestamp: { type: 'string' },
                  data: { type: 'object' },
                  context: {
                    type: 'object',
                    properties: {
                      file: { type: 'string' },
                      line: { type: 'number' },
                      column: { type: 'number' },
                    },
                  },
                },
              },
            },
            suspiciousPatterns: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  description: { type: 'string' },
                  events: { type: 'array', items: { type: 'object' } },
                },
              },
            },
            screenshots: {
              type: 'array',
              items: { type: 'string' },
              description: 'Base64-encoded screenshot images',
            },
            error: { type: 'string' },
          },
        },
      },
      bind: (deps) => new RuntimeTracer().trace.bind(new RuntimeTracer()),
    },

    // ── New SOTA Deobfuscation Tools ──

    {
      tool: {
        name: 'deobfuscation.run_unified_pipeline',
        description: 'Run the production-grade, strategy-routed deobfuscation pipeline. Automatically selects the best lane (bundle-first, exotic-encoding-first, jsdefender-first, vm-first, wasm-first, runtime-first, generic) based on fingerprint analysis. Includes runtime harvesting, prelude carving, poisoned-name quarantine, equivalence validation, and behavioral reconstruction.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to deobfuscate' },
            strategy: { type: 'string', enum: ['bundle-first', 'exotic-encoding-first', 'jsdefender-first', 'vm-first', 'wasm-first', 'runtime-first', 'generic'], description: 'Override auto-detected strategy lane' },
            sandboxMode: { type: 'string', enum: ['observe', 'emulate', 'strict'], default: 'strict', description: 'Sandbox mode for runtime harvesting' },
            maxRounds: { type: 'number', default: 3, description: 'Maximum optimization rounds' },
            skipWebcrack: { type: 'boolean', default: false },
            skipExotic: { type: 'boolean', default: false },
            skipPrelude: { type: 'boolean', default: false },
            skipQuarantine: { type: 'boolean', default: false },
            skipEquivalence: { type: 'boolean', default: false },
            skipBehavioral: { type: 'boolean', default: false },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            originalCode: { type: 'string' },
            readabilityScore: { type: 'number' },
            readabilityScoreBefore: { type: 'number' },
            confidence: { type: 'number' },
            obfuscationTypes: { type: 'array', items: { type: 'string' } },
            strategyDecision: { type: 'object' },
            harvestCaptures: { type: 'array' },
            steps: { type: 'array' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.runUnifiedPipeline.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.canonicalize_vm_handlers',
        description: 'Extract and canonicalize VM handler functions from obfuscated code. Builds an opcode genome for cross-build comparison, classifies handlers into semantic categories (stack-op, arithmetic, control-flow, etc.), and detects the obfuscation tool used.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'VM-obfuscated JavaScript code' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            genome: { type: 'object' },
            classifiedCount: { type: 'number' },
            unknownCount: { type: 'number' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.canonicalizeVMHandlers.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.compare_vm_genomes',
        description: 'Compare two VM opcode genomes to determine if they represent the same obfuscation tool/build. Useful for clustering samples by VM fingerprint.',
        inputSchema: {
          type: 'object',
          properties: {
            genomeA: { type: 'object', description: 'First opcode genome' },
            genomeB: { type: 'object', description: 'Second opcode genome' },
          },
          required: ['genomeA', 'genomeB'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            similarity: { type: 'number' },
            sameVM: { type: 'boolean' },
            sharedCategories: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.compareVMGenomes.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.harvest_wasm',
        description: 'Extract and analyze WebAssembly modules from JS+WASM hybrid obfuscation. Detects boundaries, parses WASM headers, traces JS↔WASM interfaces, extracts strings from data sections, and identifies WASMixer/WASM Cloak patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code with embedded WASM' },
            maxModuleSize: { type: 'number', default: 52428800, description: 'Max WASM module size in bytes (default 50MB)' },
            extractStrings: { type: 'boolean', default: true, description: 'Extract strings from WASM data sections' },
            decodeBase64: { type: 'boolean', default: true, description: 'Decode base64-encoded WASM' },
            traceInterfaces: { type: 'boolean', default: true, description: 'Trace JS↔WASM interfaces' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            moduleCount: { type: 'number' },
            boundaries: { type: 'array' },
            headers: { type: 'array' },
            interfaces: { type: 'array' },
            decodedStrings: { type: 'array' },
            isWASMixer: { type: 'boolean' },
            isWASMClOak: { type: 'boolean' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.harvestWASM.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.analyze_with_ir',
        description: 'Analyze code using reversible IR (TSHIR/JSIR-style). Performs constant folding, dead code elimination, flow-sensitive propagation, and prelude resolution. Returns analysis metrics and reconstructed code.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to analyze' },
            constantFolding: { type: 'boolean', default: true },
            deadCodeElimination: { type: 'boolean', default: true },
            flowSensitivePropagation: { type: 'boolean', default: true },
            preludeResolution: { type: 'boolean', default: true },
            maxIterations: { type: 'number', default: 50 },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            analysis: { type: 'object' },
            reconstructedCode: { type: 'string' },
            transformLog: { type: 'array' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.analyzeWithIR.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.ir_round_trip',
        description: 'Test IR round-trip fidelity: code → IR → code. Returns fidelity score and reconstructed code.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to test' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            fidelity: { type: 'number' },
            error: { type: 'string' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.irRoundTrip.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.quarantine_poisoned_names',
        description: 'Detect and quarantine anti-LLM poisoned identifiers from obfuscator string tables. Replaces them with behaviorally-derived safe names and assesses LLM deobfuscation risk.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Obfuscated JavaScript code' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            quarantinedNames: { type: 'array' },
            code: { type: 'string' },
            replacedCount: { type: 'number' },
            llmRisk: { type: 'object' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.quarantinePoisonedNames.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.validate_equivalence',
        description: 'Validate semantic equivalence between original and deobfuscated code. Checks syntax validity, literal preservation, function signatures, exports, and dynamic behavior.',
        inputSchema: {
          type: 'object',
          properties: {
            originalCode: { type: 'string', description: 'Original obfuscated code' },
            deobfuscatedCode: { type: 'string', description: 'Deobfuscated code to validate' },
          },
          required: ['originalCode', 'deobfuscatedCode'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            equivalent: { type: 'boolean' },
            checks: { type: 'array' },
            confidence: { type: 'number' },
            shouldRollback: { type: 'boolean' },
            warnings: { type: 'array', items: { type: 'string' } },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.validateEquivalence.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.carve_prelude',
        description: 'Detect and isolate obfuscation machinery (prelude) from business logic. Identifies decoders, rotators, VM bootstrap, integrity checks, and string tables. Separates prelude from payload and replaces prelude calls with resolved values.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Obfuscated JavaScript code' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            preludeFunctions: { type: 'array' },
            code: { type: 'string' },
            preludeCode: { type: 'string' },
            payloadCode: { type: 'string' },
            replaced: { type: 'number' },
            warnings: { type: 'array', items: { type: 'string' } },
            success: { type: 'boolean' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.carvePrelude.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.prepare_runtime_harvest',
        description: 'Prepare a runtime harvest harness for capturing plaintext payloads, string tables, opcode maps, and WASM bytes during execution. Returns the instrumented harness code ready for sandbox execution.',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to instrument' },
            mode: { type: 'string', enum: ['observe', 'emulate', 'strict'], default: 'emulate' },
            preserveToString: { type: 'boolean', default: true },
            fakeEnvironment: { type: 'boolean', default: true },
            captureWASM: { type: 'boolean', default: true },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            harnessCode: { type: 'string' },
            options: { type: 'object' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.prepareRuntimeHarvest.bind(deps.deobfuscationHandler),
    },
    {
      tool: {
        name: 'deobfuscation.reconstruct_behavior',
        description: 'Last-chance behavioral reconstruction for stalled static deobfuscation. Produces a behavioral shadow describing what the code does when source recovery is impossible (VM-obfuscated, WASM-mixed, self-defending).',
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Obfuscated JavaScript code' },
          },
          required: ['code'],
        },
        outputSchema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            code: { type: 'string' },
            summary: { type: 'string' },
            capabilities: { type: 'array' },
            confidence: { type: 'number' },
            warnings: { type: 'array', items: { type: 'string' } },
            method: { type: 'string' },
          },
        },
      },
      bind: (deps) => deps.deobfuscationHandler.reconstructBehavior.bind(deps.deobfuscationHandler),
    },

    // Workflows
    {
      tool: {
        name: 'workflow.deobfuscation.jscodeshift.v1',
        description: 'AST-Based Deobfuscation (jscodeshift + recast)',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
      domain: 'deobfuscation',
      bind: () => ({}),
    },
    {
      tool: {
        name: 'workflow.deobfuscation.shift-refactor.v1',
        description: 'Shift-Refactor Deobfuscation',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
      domain: 'deobfuscation',
      bind: () => ({}),
    },
    {
      tool: {
        name: 'workflow.deobfuscation.javascript-obfuscator-pro.v1',
        description: 'JavaScript Obfuscator Pro VM Deobfuscation',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
      domain: 'deobfuscation',
      bind: () => ({}),
    },
    {
      tool: {
        name: 'workflow.deobfuscation.ai-assisted.v1',
        description: 'AI-Assisted Deobfuscation',
        inputSchema: { type: 'object', properties: {} },
        outputSchema: { type: 'object', properties: {} },
      },
      domain: 'deobfuscation',
      bind: () => ({}),
    },
  ],
  ensure: async () => new DeobfuscationHandler(),
};

export default deobfuscationManifest;
"use strict";

import { Tool } from "@mcp/mcp-server";
import { jscodeshiftDeobfuscationWorkflow } from "./workflows/jscodeshift-deobfuscation.workflow";
import { shiftRefactorDeobfuscationWorkflow } from "./workflows/shift-refactor-deobfuscation.workflow";
import { javascriptObfuscatorProWorkflow } from "./workflows/javascript-obfuscator-pro.workflow";
import { aiAssistedDeobfuscationWorkflow } from "./workflows/ai-assisted-deobfuscation.workflow";

// Define tools for the deobfuscation domain
const DeobfuscationTools: Tool[] = [
  {
    name: "jscodeshift-deobfuscation",
    description: "AST-based deobfuscation using jscodeshift, recast, and escodegen.",
    workflow: jscodeshiftDeobfuscationWorkflow,
  },
  {
    name: "shift-refactor-deobfuscation",
    description: "String decoding and control flow analysis using shift-refactor.",
    workflow: shiftRefactorDeobfuscationWorkflow,
  },
  {
    name: "javascript-obfuscator-pro",
    description: "VM/bytecode deobfuscation using the javascript-obfuscator Pro API.",
    workflow: javascriptObfuscatorProWorkflow,
  },
  {
    name: "ai-assisted-deobfuscation",
    description: "AI-assisted pattern recognition and code explanation using @huggingface/transformers and OpenAI.",
    workflow: aiAssistedDeobfuscationWorkflow,
  },
];

export { DeobfuscationTools };
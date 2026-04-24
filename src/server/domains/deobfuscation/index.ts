"use strict";

import { Logger } from "@mcp/logger";
import { DeobfuscationManifest, DeobfuscationHandler } from "./manifest";
import { jscodeshiftDeobfuscationWorkflow } from "./workflows/jscodeshift-deobfuscation.workflow";
import { shiftRefactorDeobfuscationWorkflow } from "./workflows/shift-refactor-deobfuscation.workflow";
import { javascriptObfuscatorProWorkflow } from "./workflows/javascript-obfuscator-pro.workflow";
import { aiAssistedDeobfuscationWorkflow } from "./workflows/ai-assisted-deobfuscation.workflow";

// Logger instance
const logger = new Logger("deobfuscation-handler");

// Register the domain and workflows
export function initializeDeobfuscationDomain() {
  try {
    // Register the domain
    logger.info("Initializing deobfuscation domain...");

    // Register workflows
    jscodeshiftDeobfuscationWorkflow;
    shiftRefactorDeobfuscationWorkflow;
    javascriptObfuscatorProWorkflow;
    aiAssistedDeobfuscationWorkflow;

    logger.info("Deobfuscation domain initialized successfully.");
  } catch (error) {
    logger.error(`Failed to initialize deobfuscation domain: ${error}`);
    throw error;
  }
}

// Export the manifest and handler for dependency injection
export { DeobfuscationManifest, DeobfuscationHandler };

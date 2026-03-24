import { deobfuscateAstFlow } from './deobfuscate-ast-flow';
import { unpackerFlow } from './unpacker-flow';
import type { MacroDefinition } from '../types';

export const BUILTIN_MACROS: MacroDefinition[] = [deobfuscateAstFlow, unpackerFlow];

export { deobfuscateAstFlow, unpackerFlow };

#!/usr/bin/env node
/**
 * Disassemble the unsupported opcode 0x00000012
 */
import { disassembleInstruction } from '../../src/modules/native-emulator/disasm.ts';

console.log('=== Disassembling opcode 0x00000012 ===\n');

const result = disassembleInstruction({ opcode: 0x00000012, arch: 'arm64' });

console.log('Result:', result);

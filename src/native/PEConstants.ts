/**
 * PE (Portable Executable) format constants.
 *
 * Single source of truth for PE header magic numbers, offsets, and machine
 * identifiers. Import from here instead of defining locally — fixes to these
 * constants propagate to all PE parsers (PEAnalyzer, ManualMapInjector, etc.).
 *
 * @module PEConstants
 */

/** IMAGE_DOS_SIGNATURE — "MZ" in little-endian. */
export const MZ_MAGIC = 0x5a4d;
/** IMAGE_NT_SIGNATURE — "PE\0\0" in little-endian. */
export const PE_SIGNATURE = 0x00004550;
/** sizeof(IMAGE_DOS_HEADER). */
export const DOS_HEADER_SIZE = 64;
/** e_lfanew offset within IMAGE_DOS_HEADER. */
export const E_LFANEW_OFFSET = 60;

/** IMAGE_NT_OPTIONAL_HDR64_MAGIC (PE32+). */
export const IMAGE_NT_OPTIONAL_HDR64_MAGIC = 0x020b;

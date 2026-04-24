/**
 * Secure file operations utilities.
 * Ensures files and directories are created with appropriate permissions.
 */

import { writeFile as fsWriteFile, mkdir as fsMkdir, chmod } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Write file with secure permissions (0600).
 * Creates parent directories with 0755 permissions if they don't exist.
 */
export async function writeFileSecure(
  filePath: string,
  data: string | Buffer,
  options?: { encoding?: BufferEncoding; mode?: number },
): Promise<void> {
  const dir = dirname(filePath);

  // Ensure directory exists with secure permissions
  await fsMkdir(dir, { recursive: true, mode: 0o755 });

  // Write file
  await fsWriteFile(filePath, data, options);

  // Set restrictive permissions on the file (0600)
  await chmod(filePath, 0o600);
}

/**
 * Create directory with secure permissions (0755).
 */
export async function mkdirSecure(dirPath: string): Promise<void> {
  await fsMkdir(dirPath, { recursive: true, mode: 0o755 });
}

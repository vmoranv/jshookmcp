/**
 * Resolve the process state directory.
 *
 * Lives in `utils` so leaf consumers (`InstanceRegistry`, CLI helpers) no
 * longer import `server/persistence/RuntimeSnapshotScheduler` just to discover
 * where state files belong. The scheduler re-exports this function for
 * backward compatibility.
 */
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readEnvNullableString } from '@src/config/environment';

export function getStateDir(): string {
  const overridden = readEnvNullableString('JSHOOK_STATE_DIR', { trim: true });
  if (overridden) {
    return resolve(homedir(), overridden);
  }
  return resolve(homedir(), '.jshookmcp', 'state');
}

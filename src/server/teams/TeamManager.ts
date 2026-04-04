/**
 * TeamManager — Manages Codex team sessions with force deletion support.
 *
 * Provides centralized management for team lifecycle, including:
 * - Track active teams and their associated sessions
 * - Force delete teams with proper cleanup
 * - Path safety validation
 * - Timeout-handled operations
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

// ── Types ──

export interface TeamSession {
  id: string;
  name: string;
  createdAt: number;
  lastActivityAt: number;
  status: 'active' | 'closing' | 'closed';
  sessionIds: string[];
}

export interface ForceDeleteOptions {
  timeoutMs?: number;
  skipSessionCleanup?: boolean;
}

export interface ForceDeleteResult {
  success: boolean;
  teamName: string;
  sessionsClosed: number;
  error?: string;
}

// ── Constants ──

const DEFAULT_TIMEOUT_MS = 30_000;

// ── Helper Functions ──

/**
 * Validate team name for path safety
 * Prevents path traversal and invalid characters
 */
function validateTeamName(name: string): { valid: boolean; error?: string } {
  if (!name || typeof name !== 'string') {
    return { valid: false, error: 'Team name must be a non-empty string' };
  }

  // Check length
  if (name.length > 64) {
    return { valid: false, error: 'Team name must not exceed 64 characters' };
  }

  // Only allow alphanumeric, dots, underscores, and dashes
  const safePattern = /^[a-zA-Z0-9._-]+$/;
  if (!safePattern.test(name)) {
    return {
      valid: false,
      error: 'Team name can only contain letters, numbers, dots, underscores, and dashes',
    };
  }

  // Prevent path traversal
  if (name.includes('..') || name.includes('/') || name.includes('\\')) {
    return { valid: false, error: 'Path traversal detected in team name' };
  }

  return { valid: true };
}

/**
 * Execute codex CLI command with timeout
 */
async function execCodexCommand(
  args: string[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timeoutId = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
      reject(new Error(`Codex command timed out after ${timeoutMs}ms: codex ${args.join(' ')}`));
    }, timeoutMs);

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      if (!timedOut) {
        clearTimeout(timeoutId);
        resolve({ stdout, stderr, code: code ?? 1 });
      }
    });

    child.on('error', (err) => {
      if (!timedOut) {
        clearTimeout(timeoutId);
        reject(err);
      }
    });
  });
}

// ── TeamManager Class ──

export class TeamManager extends EventEmitter {
  private readonly teams = new Map<string, TeamSession>();
  private readonly cleanupTimeouts = new Map<string, NodeJS.Timeout>();

  /**
   * Register a new team session
   */
  registerTeam(name: string, sessionId?: string): TeamSession {
    const validation = validateTeamName(name);
    if (!validation.valid) {
      throw new Error(`Invalid team name: ${validation.error}`);
    }

    const existing = this.teams.get(name);
    if (existing) {
      return existing;
    }

    const team: TeamSession = {
      id: name,
      name,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: 'active',
      sessionIds: sessionId ? [sessionId] : [],
    };

    this.teams.set(name, team);
    this.emit('team:registered', { name, sessionId });

    return team;
  }

  /**
   * Add a session to an existing team
   */
  addSessionToTeam(teamName: string, sessionId: string): void {
    const team = this.teams.get(teamName);
    if (!team) {
      throw new Error(`Team "${teamName}" not found`);
    }

    if (!team.sessionIds.includes(sessionId)) {
      team.sessionIds.push(sessionId);
      team.lastActivityAt = Date.now();
      this.emit('session:added', { teamName, sessionId });
    }
  }

  /**
   * Remove a session from a team
   */
  removeSessionFromTeam(teamName: string, sessionId: string): void {
    const team = this.teams.get(teamName);
    if (!team) {
      return;
    }

    const index = team.sessionIds.indexOf(sessionId);
    if (index !== -1) {
      team.sessionIds.splice(index, 1);
      team.lastActivityAt = Date.now();
      this.emit('session:removed', { teamName, sessionId });
    }
  }

  /**
   * Get a team by name
   */
  getTeam(teamName: string): TeamSession | undefined {
    return this.teams.get(teamName);
  }

  /**
   * List all active teams
   */
  listTeams(): TeamSession[] {
    return [...this.teams.values()].filter((t) => t.status === 'active');
  }

  /**
   * Get team statistics
   */
  getStats(): { totalTeams: number; activeTeams: number; totalSessions: number } {
    const values = [...this.teams.values()];
    return {
      totalTeams: values.length,
      activeTeams: values.filter((t) => t.status === 'active').length,
      totalSessions: values.reduce((sum, t) => sum + t.sessionIds.length, 0),
    };
  }

  /**
   * Force delete a team with full cleanup
   *
   * This method:
   * 1. Validates the team name for path safety
   * 2. Marks team as closing
   * 3. Cancels any pending close timeouts
   * 4. Executes codex CLI to close agent sessions
   * 5. Removes team from registry
   * 6. Emits cleanup events
   */
  async forceDeleteTeam(
    teamName: string,
    options: ForceDeleteOptions = {},
  ): Promise<ForceDeleteResult> {
    const { timeoutMs = DEFAULT_TIMEOUT_MS, skipSessionCleanup = false } = options;

    // Step 1: Validate team name
    const validation = validateTeamName(teamName);
    if (!validation.valid) {
      return {
        success: false,
        teamName,
        sessionsClosed: 0,
        error: `Invalid team name: ${validation.error}`,
      };
    }

    const team = this.teams.get(teamName);
    if (!team) {
      return {
        success: false,
        teamName,
        sessionsClosed: 0,
        error: `Team "${teamName}" not found`,
      };
    }

    // Step 2: Mark as closing
    team.status = 'closing';
    this.emit('team:closing', { teamName });

    // Step 3: Cancel pending cleanup timeout
    const pendingTimeout = this.cleanupTimeouts.get(teamName);
    if (pendingTimeout) {
      clearTimeout(pendingTimeout);
      this.cleanupTimeouts.delete(teamName);
    }

    let sessionsClosed = 0;
    let error: string | undefined;

    try {
      // Step 4: Close all associated sessions via codex CLI
      if (!skipSessionCleanup && team.sessionIds.length > 0) {
        const closePromises = team.sessionIds.map((sessionId) =>
          this.closeSession(sessionId, timeoutMs),
        );

        const results = await Promise.allSettled(closePromises);
        sessionsClosed = results.filter((r) => r.status === 'fulfilled').length;

        const failures = results
          .filter((r) => r.status === 'rejected')
          .map((r) => (r as PromiseRejectedResult).reason)
          .filter((e) => e instanceof Error)
          .map((e) => e.message);

        if (failures.length > 0) {
          error = `Failed to close ${failures.length} session(s): ${failures.join('; ')}`;
        }
      }

      // Step 5: Remove from registry
      this.teams.delete(teamName);
      team.status = 'closed';

      // Step 6: Emit cleanup complete
      this.emit('team:deleted', { teamName, sessionsClosed });

      return {
        success: !error,
        teamName,
        sessionsClosed,
        error,
      };
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      return {
        success: false,
        teamName,
        sessionsClosed,
        error: errorMessage,
      };
    }
  }

  /**
   * Close a single codex session
   */
  private async closeSession(sessionId: string, timeoutMs: number): Promise<void> {
    try {
      await execCodexCommand(['cancel-session', sessionId], timeoutMs);
    } catch (e) {
      // Log but don't fail the entire operation
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Failed to close session ${sessionId}: ${msg}`, { cause: e });
    }
  }

  /**
   * Schedule automatic cleanup of a team after inactivity
   */
  scheduleAutoCleanup(teamName: string, delayMs: number = 300_000): void {
    const existing = this.cleanupTimeouts.get(teamName);
    if (existing) {
      clearTimeout(existing);
    }

    const timeoutId = setTimeout(() => {
      this.forceDeleteTeam(teamName).catch(() => {
        // Ignore cleanup errors
      });
      this.cleanupTimeouts.delete(teamName);
    }, delayMs);

    this.cleanupTimeouts.set(teamName, timeoutId);
  }

  /**
   * Cancel scheduled cleanup for a team
   */
  cancelScheduledCleanup(teamName: string): void {
    const timeout = this.cleanupTimeouts.get(teamName);
    if (timeout) {
      clearTimeout(timeout);
      this.cleanupTimeouts.delete(teamName);
    }
  }

  /**
   * Shutdown manager and cleanup all teams
   */
  async shutdown(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<{
    closed: number;
    failed: number;
  }> {
    const teams = [...this.teams.keys()];
    let closed = 0;
    let failed = 0;

    const results = await Promise.allSettled(
      teams.map((name) => this.forceDeleteTeam(name, { timeoutMs })),
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.success) {
        closed++;
      } else {
        failed++;
      }
    }

    // Clear all pending timeouts
    for (const [name, timeout] of this.cleanupTimeouts.entries()) {
      clearTimeout(timeout);
      this.cleanupTimeouts.delete(name);
    }

    return { closed, failed };
  }
}

// ── Singleton Instance ──

let globalTeamManager: TeamManager | undefined;

export function getTeamManager(): TeamManager {
  if (!globalTeamManager) {
    globalTeamManager = new TeamManager();
  }
  return globalTeamManager;
}

export function resetTeamManager(): void {
  globalTeamManager = undefined;
}

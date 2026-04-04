/**
 * TeamManager tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TeamManager, resetTeamManager, getTeamManager } from '@server/teams/TeamManager';

describe('TeamManager', () => {
  let manager: TeamManager;

  beforeEach(() => {
    resetTeamManager();
    manager = getTeamManager();
  });

  afterEach(() => {
    resetTeamManager();
  });

  describe('validateTeamName', () => {
    it('should accept valid team names', async () => {
      const result = await manager.forceDeleteTeam('test-team');
      expect(result.teamName).toBe('test-team');
      // Should fail because team doesn't exist, not because of validation
      expect(result.error).toContain('not found');
    });

    it('should reject team names with path traversal (..)', async () => {
      const result = await manager.forceDeleteTeam('../etc/passwd');
      expect(result.success).toBe(false);
      // Validation fails at character check first (.. contains invalid chars)
      expect(result.error).toMatch(/(only contain|Path traversal)/);
    });

    it('should reject team names with slashes', async () => {
      const result = await manager.forceDeleteTeam('team/subteam');
      expect(result.success).toBe(false);
      // Validation fails at character check first (/ is invalid char)
      expect(result.error).toMatch(/(only contain|Path traversal)/);
    });

    it('should explicitly reject path traversal patterns', () => {
      // Direct test of the validation logic
      expect(() => manager.registerTeam('..')).toThrow('Invalid team name');
    });

    it('should reject team names longer than 64 characters', async () => {
      const longName = 'a'.repeat(65);
      const result = await manager.forceDeleteTeam(longName);
      expect(result.success).toBe(false);
      expect(result.error).toContain('64 characters');
    });

    it('should reject empty team names', async () => {
      const result = await manager.forceDeleteTeam('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('non-empty string');
    });

    it('should reject team names with invalid characters', async () => {
      const result = await manager.forceDeleteTeam('team@name!');
      expect(result.success).toBe(false);
      expect(result.error).toContain(
        'only contain letters, numbers, dots, underscores, and dashes',
      );
    });
  });

  describe('registerTeam', () => {
    it('should register a new team', () => {
      const team = manager.registerTeam('test-team', 'session-123');
      expect(team.name).toBe('test-team');
      expect(team.status).toBe('active');
      expect(team.sessionIds).toEqual(['session-123']);
    });

    it('should return existing team if already registered', () => {
      const team1 = manager.registerTeam('test-team');
      const team2 = manager.registerTeam('test-team');
      expect(team1).toBe(team2);
    });

    it('should throw on invalid team name', () => {
      expect(() => manager.registerTeam('../invalid')).toThrow('Invalid team name');
    });
  });

  describe('addSessionToTeam', () => {
    it('should add a session to an existing team', () => {
      manager.registerTeam('test-team');
      manager.addSessionToTeam('test-team', 'session-1');
      const team = manager.getTeam('test-team');
      expect(team?.sessionIds).toContain('session-1');
    });

    it('should throw if team does not exist', () => {
      expect(() => manager.addSessionToTeam('nonexistent', 'session-1')).toThrow('not found');
    });

    it('should not add duplicate sessions', () => {
      manager.registerTeam('test-team', 'session-1');
      manager.addSessionToTeam('test-team', 'session-1');
      const team = manager.getTeam('test-team');
      expect(team?.sessionIds.length).toBe(1);
    });
  });

  describe('removeSessionFromTeam', () => {
    it('should remove a session from a team', () => {
      manager.registerTeam('test-team', 'session-1');
      manager.removeSessionFromTeam('test-team', 'session-1');
      const team = manager.getTeam('test-team');
      expect(team?.sessionIds).not.toContain('session-1');
    });

    it('should not throw if team does not exist', () => {
      expect(() => manager.removeSessionFromTeam('nonexistent', 'session-1')).not.toThrow();
    });

    it('should not throw if session does not exist', () => {
      manager.registerTeam('test-team', 'session-1');
      expect(() => manager.removeSessionFromTeam('test-team', 'session-999')).not.toThrow();
    });
  });

  describe('listTeams', () => {
    it('should list only active teams', () => {
      manager.registerTeam('team-1');
      manager.registerTeam('team-2');
      const teams = manager.listTeams();
      expect(teams.length).toBe(2);
      expect(teams.map((t) => t.name)).toEqual(['team-1', 'team-2']);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      manager.registerTeam('team-1', 'session-1');
      manager.registerTeam('team-2', 'session-2');
      manager.addSessionToTeam('team-1', 'session-3');

      const stats = manager.getStats();
      expect(stats.totalTeams).toBe(2);
      expect(stats.activeTeams).toBe(2);
      expect(stats.totalSessions).toBe(3);
    });
  });

  describe('forceDeleteTeam', () => {
    it('should successfully delete a team', async () => {
      manager.registerTeam('test-team', 'session-1');
      const result = await manager.forceDeleteTeam('test-team', { skipSessionCleanup: true });
      expect(result.success).toBe(true);
      expect(result.teamName).toBe('test-team');
      expect(manager.getTeam('test-team')).toBeUndefined();
    });

    it('should fail for non-existent team', async () => {
      const result = await manager.forceDeleteTeam('nonexistent');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should emit team:deleted event', async () => {
      let eventEmitted = false;
      let eventData: unknown;

      manager.on('team:deleted', (data) => {
        eventEmitted = true;
        eventData = data;
      });

      manager.registerTeam('test-team');
      await manager.forceDeleteTeam('test-team', { skipSessionCleanup: true });

      expect(eventEmitted).toBe(true);
      expect(eventData).toEqual({ teamName: 'test-team', sessionsClosed: 0 });
    });
  });

  describe('scheduleAutoCleanup', () => {
    it('should schedule cleanup after delay', async () => {
      manager.registerTeam('test-team');
      manager.scheduleAutoCleanup('test-team', 50);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(manager.getTeam('test-team')).toBeUndefined();
    });

    it('should cancel scheduled cleanup', async () => {
      manager.registerTeam('test-team');
      manager.scheduleAutoCleanup('test-team', 50);
      manager.cancelScheduledCleanup('test-team');

      await new Promise((resolve) => setTimeout(resolve, 100));

      // Team should still exist since cleanup was cancelled
      expect(manager.getTeam('test-team')).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should shutdown all teams', async () => {
      manager.registerTeam('team-1');
      manager.registerTeam('team-2');

      const result = await manager.shutdown(1000);

      expect(result.closed).toBe(2);
      expect(result.failed).toBe(0);
      expect(manager.listTeams().length).toBe(0);
    });
  });

  describe('singleton', () => {
    it('should return same instance from getTeamManager', () => {
      const manager1 = getTeamManager();
      const manager2 = getTeamManager();
      expect(manager1).toBe(manager2);
    });

    it('should reset singleton with resetTeamManager', () => {
      const manager1 = getTeamManager();
      resetTeamManager();
      const manager2 = getTeamManager();
      expect(manager1).not.toBe(manager2);
    });
  });
});

/**
 * Tests for IPC parameter validation (zod schemas).
 *
 * Validates that IpcParamSchemas correctly accept valid params
 * and reject invalid params for each IPC channel.
 */

import { describe, it, expect } from 'vitest';
import { validateIpcParams, IpcParamSchemas, IpcSendParamSchemas } from '../src/shared/schemas/ipc-params';
import { Ch, ChSend } from '../src/shared/ipc-schema';

describe('IPC Parameter Validation', () => {
  // ─── Schema coverage ───

  describe('schema coverage', () => {
    it('should have schemas for parameterized handle channels', () => {
      // All channels in IpcParamSchemas should be valid Ch values
      const chValues = new Set(Object.values(Ch));
      for (const channel of Object.keys(IpcParamSchemas)) {
        expect(chValues.has(channel as any)).toBe(true);
      }
    });

    it('should have schemas for send channels', () => {
      const sendValues = new Set(Object.values(ChSend));
      for (const channel of Object.keys(IpcSendParamSchemas)) {
        expect(sendValues.has(channel as any)).toBe(true);
      }
    });

    it('should return null for channels without schemas', () => {
      expect(validateIpcParams('unknown:channel', [])).toBeNull();
      expect(validateIpcParams(Ch.CONFIG_GET, [])).toBeNull();
      expect(validateIpcParams(Ch.SCREEN_CAPTURE, [])).toBeNull();
    });
  });

  // ─── AI channels ───

  describe('AI channels', () => {
    it('AI_SEND_MESSAGE: accepts (message) and (message, context)', () => {
      expect(validateIpcParams(Ch.AI_SEND_MESSAGE, ['Cześć!'])).toBeNull();
      expect(validateIpcParams(Ch.AI_SEND_MESSAGE, ['Cześć!', 'kontekst'])).toBeNull();
    });

    it('AI_SEND_MESSAGE: rejects empty message', () => {
      expect(validateIpcParams(Ch.AI_SEND_MESSAGE, [''])).not.toBeNull();
    });

    it('AI_SEND_MESSAGE: rejects non-string', () => {
      expect(validateIpcParams(Ch.AI_SEND_MESSAGE, [123])).not.toBeNull();
    });

    it('AI_STREAM_MESSAGE: accepts valid params', () => {
      expect(validateIpcParams(Ch.AI_STREAM_MESSAGE, ['test msg'])).toBeNull();
      expect(validateIpcParams(Ch.AI_STREAM_MESSAGE, ['test msg', 'ctx'])).toBeNull();
    });

    it('AI_STREAM_WITH_SCREEN: accepts message string', () => {
      expect(validateIpcParams(Ch.AI_STREAM_WITH_SCREEN, ['Co widzisz?'])).toBeNull();
    });

    it('AI_STREAM_WITH_SCREEN: rejects empty', () => {
      expect(validateIpcParams(Ch.AI_STREAM_WITH_SCREEN, [''])).not.toBeNull();
    });
  });

  // ─── Agent ───

  describe('Agent channels', () => {
    it('AGENT_SET_ACTIVE_HOURS: accepts valid hours', () => {
      expect(validateIpcParams(Ch.AGENT_SET_ACTIVE_HOURS, [9, 17])).toBeNull();
      expect(validateIpcParams(Ch.AGENT_SET_ACTIVE_HOURS, [0, 23])).toBeNull();
    });

    it('AGENT_SET_ACTIVE_HOURS: accepts null (disable)', () => {
      expect(validateIpcParams(Ch.AGENT_SET_ACTIVE_HOURS, [null, null])).toBeNull();
    });

    it('AGENT_SET_ACTIVE_HOURS: rejects out of range', () => {
      expect(validateIpcParams(Ch.AGENT_SET_ACTIVE_HOURS, [-1, 17])).not.toBeNull();
      expect(validateIpcParams(Ch.AGENT_SET_ACTIVE_HOURS, [9, 24])).not.toBeNull();
    });
  });

  // ─── Memory ───

  describe('Memory channels', () => {
    it('MEMORY_GET: accepts key string', () => {
      expect(validateIpcParams(Ch.MEMORY_GET, ['SOUL.md'])).toBeNull();
    });

    it('MEMORY_GET: rejects empty key', () => {
      expect(validateIpcParams(Ch.MEMORY_GET, [''])).not.toBeNull();
    });

    it('MEMORY_SET: accepts key + value', () => {
      expect(validateIpcParams(Ch.MEMORY_SET, ['SOUL.md', 'treść'])).toBeNull();
    });

    it('MEMORY_SET: accepts empty value (clear)', () => {
      expect(validateIpcParams(Ch.MEMORY_SET, ['key', ''])).toBeNull();
    });
  });

  // ─── Config ───

  describe('Config channels', () => {
    it('CONFIG_SET: accepts key + any value', () => {
      expect(validateIpcParams(Ch.CONFIG_SET, ['theme', 'dark'])).toBeNull();
      expect(validateIpcParams(Ch.CONFIG_SET, ['fontSize', 14])).toBeNull();
      expect(validateIpcParams(Ch.CONFIG_SET, ['features', { a: 1 }])).toBeNull();
    });

    it('CONFIG_SET: rejects empty key', () => {
      expect(validateIpcParams(Ch.CONFIG_SET, ['', 'val'])).not.toBeNull();
    });

    it('CONFIG_COMPLETE_ONBOARDING: accepts valid onboarding data', () => {
      expect(
        validateIpcParams(Ch.CONFIG_COMPLETE_ONBOARDING, [
          {
            userName: 'Jan',
            userRole: 'Developer',
            userDescription: 'Full-stack dev',
            aiProvider: 'openai',
            aiModel: 'gpt-4.1',
          },
        ]),
      ).toBeNull();
    });

    it('CONFIG_COMPLETE_ONBOARDING: rejects invalid provider', () => {
      const result = validateIpcParams(Ch.CONFIG_COMPLETE_ONBOARDING, [
        {
          userName: 'Jan',
          userRole: 'Developer',
          userDescription: '',
          aiProvider: 'google',
          aiModel: 'gemini',
        },
      ]);
      expect(result).not.toBeNull();
    });

    it('CONFIG_COMPLETE_ONBOARDING: rejects missing required fields', () => {
      expect(
        validateIpcParams(Ch.CONFIG_COMPLETE_ONBOARDING, [
          { userName: 'Jan' }, // missing userRole, userDescription, aiProvider, aiModel
        ]),
      ).not.toBeNull();
    });
  });

  // ─── Security ───

  describe('Security channels', () => {
    it('SECURITY_SET_API_KEY: accepts valid provider + key', () => {
      expect(validateIpcParams(Ch.SECURITY_SET_API_KEY, ['openai', 'sk-abc123'])).toBeNull();
      expect(validateIpcParams(Ch.SECURITY_SET_API_KEY, ['anthropic', 'key'])).toBeNull();
    });

    it('SECURITY_SET_API_KEY: rejects unknown provider', () => {
      expect(validateIpcParams(Ch.SECURITY_SET_API_KEY, ['google', 'key'])).not.toBeNull();
    });

    it('SECURITY_SET_API_KEY: rejects empty key', () => {
      expect(validateIpcParams(Ch.SECURITY_SET_API_KEY, ['openai', ''])).not.toBeNull();
    });

    it('SECURITY_HAS_API_KEY: accepts valid provider', () => {
      expect(validateIpcParams(Ch.SECURITY_HAS_API_KEY, ['openai'])).toBeNull();
      expect(validateIpcParams(Ch.SECURITY_HAS_API_KEY, ['deepgram'])).toBeNull();
    });

    it('SECURITY_HAS_API_KEY: rejects unknown provider', () => {
      expect(validateIpcParams(Ch.SECURITY_HAS_API_KEY, ['aws'])).not.toBeNull();
    });

    it('SECURITY_AUDIT_LOG: accepts optional limit', () => {
      expect(validateIpcParams(Ch.SECURITY_AUDIT_LOG, [100])).toBeNull();
      expect(validateIpcParams(Ch.SECURITY_AUDIT_LOG, [undefined])).toBeNull();
    });

    it('SECURITY_AUDIT_LOG: rejects negative limit', () => {
      expect(validateIpcParams(Ch.SECURITY_AUDIT_LOG, [-5])).not.toBeNull();
    });
  });

  // ─── Window ───

  describe('Window channels', () => {
    it('WINDOW_SET_POSITION: accepts integer coords', () => {
      expect(validateIpcParams(Ch.WINDOW_SET_POSITION, [100, 200])).toBeNull();
      expect(validateIpcParams(Ch.WINDOW_SET_POSITION, [0, 0])).toBeNull();
      expect(validateIpcParams(Ch.WINDOW_SET_POSITION, [-100, -200])).toBeNull(); // negative coords valid for multi-monitor
    });

    it('WINDOW_SET_SIZE: accepts valid dimensions', () => {
      expect(validateIpcParams(Ch.WINDOW_SET_SIZE, [800, 600])).toBeNull();
      expect(validateIpcParams(Ch.WINDOW_SET_SIZE, [100, 100])).toBeNull();
    });

    it('WINDOW_SET_SIZE: rejects too small/large', () => {
      expect(validateIpcParams(Ch.WINDOW_SET_SIZE, [50, 600])).not.toBeNull();
      expect(validateIpcParams(Ch.WINDOW_SET_SIZE, [800, 20000])).not.toBeNull();
    });

    it('WINDOW_SET_CLICKTHROUGH: accepts boolean', () => {
      expect(validateIpcParams(Ch.WINDOW_SET_CLICKTHROUGH, [true])).toBeNull();
      expect(validateIpcParams(Ch.WINDOW_SET_CLICKTHROUGH, [false])).toBeNull();
    });

    it('WINDOW_SET_CLICKTHROUGH: rejects non-boolean', () => {
      expect(validateIpcParams(Ch.WINDOW_SET_CLICKTHROUGH, [1])).not.toBeNull();
      expect(validateIpcParams(Ch.WINDOW_SET_CLICKTHROUGH, ['true'])).not.toBeNull();
    });
  });

  // ─── Cron ───

  describe('Cron channels', () => {
    it('CRON_ADD_JOB: accepts valid job', () => {
      expect(
        validateIpcParams(Ch.CRON_ADD_JOB, [
          {
            name: 'Raport dzienny',
            schedule: '0 9 * * 1-5',
            action: 'Wygeneruj raport',
            category: 'routine',
          },
        ]),
      ).toBeNull();
    });

    it('CRON_ADD_JOB: accepts minimal job (only required fields)', () => {
      expect(
        validateIpcParams(Ch.CRON_ADD_JOB, [
          {
            name: 'Test',
            schedule: '* * * * *',
            action: 'echo test',
          },
        ]),
      ).toBeNull();
    });

    it('CRON_ADD_JOB: rejects invalid category', () => {
      expect(
        validateIpcParams(Ch.CRON_ADD_JOB, [
          {
            name: 'Test',
            schedule: '* * * * *',
            action: 'echo test',
            category: 'invalid-cat',
          },
        ]),
      ).not.toBeNull();
    });

    it('CRON_ADD_JOB: rejects empty name', () => {
      expect(
        validateIpcParams(Ch.CRON_ADD_JOB, [
          { name: '', schedule: '* * * * *', action: 'test' },
        ]),
      ).not.toBeNull();
    });

    it('CRON_UPDATE_JOB: accepts id + partial updates', () => {
      expect(
        validateIpcParams(Ch.CRON_UPDATE_JOB, ['job-123', { enabled: false }]),
      ).toBeNull();
    });

    it('CRON_REMOVE_JOB: accepts id', () => {
      expect(validateIpcParams(Ch.CRON_REMOVE_JOB, ['job-123'])).toBeNull();
    });

    it('CRON_GET_HISTORY: accepts optional jobId', () => {
      expect(validateIpcParams(Ch.CRON_GET_HISTORY, [undefined])).toBeNull();
      expect(validateIpcParams(Ch.CRON_GET_HISTORY, ['job-123'])).toBeNull();
    });
  });

  // ─── RAG ───

  describe('RAG channels', () => {
    it('RAG_SEARCH: accepts query and optional topK', () => {
      expect(validateIpcParams(Ch.RAG_SEARCH, ['szukam czegoś'])).toBeNull();
      expect(validateIpcParams(Ch.RAG_SEARCH, ['query', 10])).toBeNull();
    });

    it('RAG_SEARCH: rejects empty query', () => {
      expect(validateIpcParams(Ch.RAG_SEARCH, [''])).not.toBeNull();
    });

    it('RAG_ADD_FOLDER: accepts path', () => {
      expect(validateIpcParams(Ch.RAG_ADD_FOLDER, ['C:\\Users\\test\\docs'])).toBeNull();
    });

    it('RAG_REMOVE_FOLDER: accepts path', () => {
      expect(validateIpcParams(Ch.RAG_REMOVE_FOLDER, ['/home/user/docs'])).toBeNull();
    });
  });

  // ─── Tools ───

  describe('Tools channels', () => {
    it('TOOLS_EXECUTE: accepts name + params object', () => {
      expect(
        validateIpcParams(Ch.TOOLS_EXECUTE, ['read_file', { path: '/test.txt' }]),
      ).toBeNull();
    });

    it('TOOLS_EXECUTE: rejects empty name', () => {
      expect(validateIpcParams(Ch.TOOLS_EXECUTE, ['', {}])).not.toBeNull();
    });
  });

  // ─── Automation ───

  describe('Automation channels', () => {
    it('AUTOMATION_TAKE_CONTROL: accepts task string', () => {
      expect(
        validateIpcParams(Ch.AUTOMATION_TAKE_CONTROL, ['Otwórz przeglądarkę']),
      ).toBeNull();
    });

    it('AUTOMATION_TAKE_CONTROL: rejects empty task', () => {
      expect(validateIpcParams(Ch.AUTOMATION_TAKE_CONTROL, [''])).not.toBeNull();
    });
  });

  // ─── MCP ───

  describe('MCP channels', () => {
    it('MCP_ADD_SERVER: accepts valid HTTP server config', () => {
      expect(
        validateIpcParams(Ch.MCP_ADD_SERVER, [
          {
            name: 'Test Server',
            transport: 'streamable-http',
            url: 'http://localhost:3000',
            autoConnect: true,
            enabled: true,
          },
        ]),
      ).toBeNull();
    });

    it('MCP_ADD_SERVER: accepts valid stdio server config', () => {
      expect(
        validateIpcParams(Ch.MCP_ADD_SERVER, [
          {
            name: 'Local MCP',
            transport: 'stdio',
            command: 'npx',
            args: ['-y', 'mcp-server'],
            env: { API_KEY: 'test' },
          },
        ]),
      ).toBeNull();
    });

    it('MCP_ADD_SERVER: rejects invalid transport', () => {
      expect(
        validateIpcParams(Ch.MCP_ADD_SERVER, [
          {
            name: 'Test',
            transport: 'websocket',
          },
        ]),
      ).not.toBeNull();
    });

    it('MCP_ADD_SERVER: rejects empty name', () => {
      expect(
        validateIpcParams(Ch.MCP_ADD_SERVER, [
          { name: '', transport: 'sse' },
        ]),
      ).not.toBeNull();
    });

    it('MCP_CONNECT/DISCONNECT/RECONNECT: accepts server id', () => {
      expect(validateIpcParams(Ch.MCP_CONNECT, ['srv-1'])).toBeNull();
      expect(validateIpcParams(Ch.MCP_DISCONNECT, ['srv-1'])).toBeNull();
      expect(validateIpcParams(Ch.MCP_RECONNECT, ['srv-1'])).toBeNull();
    });

    it('MCP_CALL_TOOL: accepts serverId + toolName + args', () => {
      expect(
        validateIpcParams(Ch.MCP_CALL_TOOL, ['srv-1', 'search', { query: 'test' }]),
      ).toBeNull();
    });
  });

  // ─── Sub-agents ───

  describe('Sub-agent channels', () => {
    it('SUBAGENT_SPAWN: accepts task + optional tools', () => {
      expect(validateIpcParams(Ch.SUBAGENT_SPAWN, ['Zbadaj problem'])).toBeNull();
      expect(
        validateIpcParams(Ch.SUBAGENT_SPAWN, ['Zbadaj', ['read_file', 'search']]),
      ).toBeNull();
    });

    it('SUBAGENT_SPAWN: rejects empty task', () => {
      expect(validateIpcParams(Ch.SUBAGENT_SPAWN, [''])).not.toBeNull();
    });

    it('SUBAGENT_KILL: accepts agent id', () => {
      expect(validateIpcParams(Ch.SUBAGENT_KILL, ['agent-1'])).toBeNull();
    });

    it('SUBAGENT_STEER: accepts agentId + instruction', () => {
      expect(
        validateIpcParams(Ch.SUBAGENT_STEER, ['agent-1', 'Zmień kierunek']),
      ).toBeNull();
    });
  });

  // ─── Send channels ───

  describe('Send channels', () => {
    it('MEETING_MAP_SPEAKER: accepts speakerId + name', () => {
      expect(
        validateIpcParams(ChSend.MEETING_MAP_SPEAKER, ['speaker-0', 'Jan Kowalski']),
      ).toBeNull();
    });

    it('MEETING_MAP_SPEAKER: rejects empty values', () => {
      expect(
        validateIpcParams(ChSend.MEETING_MAP_SPEAKER, ['', 'Jan']),
      ).not.toBeNull();
    });
  });

  // ─── Edge cases ───

  describe('edge cases', () => {
    it('returns null for no-param channels', () => {
      expect(validateIpcParams(Ch.AGENT_STOP, [])).toBeNull();
      expect(validateIpcParams(Ch.CONFIG_GET, [])).toBeNull();
      expect(validateIpcParams(Ch.BROWSER_STATUS, [])).toBeNull();
    });

    it('validation error contains channel name', () => {
      const error = validateIpcParams(Ch.AI_SEND_MESSAGE, [123]);
      expect(error).not.toBeNull();
      expect(error!.channel).toBe(Ch.AI_SEND_MESSAGE);
    });

    it('validation error contains issues array', () => {
      const error = validateIpcParams(Ch.WINDOW_SET_SIZE, [50, 600]);
      expect(error).not.toBeNull();
      expect(error!.issues.length).toBeGreaterThan(0);
    });
  });
});

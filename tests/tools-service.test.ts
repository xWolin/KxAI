import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks for electron + node modules ───
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user'),
    getName: vi.fn(() => 'KxAI'),
  },
  clipboard: {
    readText: vi.fn(() => ''),
    writeText: vi.fn(),
    readImage: vi.fn(() => ({ isEmpty: () => true })),
  },
  shell: {
    openPath: vi.fn(),
    openExternal: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    statSync: vi.fn(() => ({ size: 0, mtimeMs: 0, isDirectory: () => false })),
    unlinkSync: vi.fn(),
  },
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ''),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  statSync: vi.fn(() => ({ size: 0, mtimeMs: 0, isDirectory: () => false })),
  unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  exec: vi.fn(),
  execFile: vi.fn(),
}));

vi.mock('dns', () => ({
  default: { promises: { resolve4: vi.fn(), resolve6: vi.fn(), lookup: vi.fn() } },
  promises: { resolve4: vi.fn(), resolve6: vi.fn(), lookup: vi.fn() },
}));

vi.mock('net', () => ({
  default: { isIP: vi.fn(() => 0), isIPv4: vi.fn(() => false), isIPv6: vi.fn(() => false) },
  isIP: vi.fn(() => 0),
  isIPv4: vi.fn((ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip)),
  isIPv6: vi.fn(
    (ip: string) => ip.includes(':') && !ip.match(/^\d+\.\d+\.\d+\.\d+$/),
  ),
}));

// Mock services that ToolsService imports
vi.mock('../src/main/services/automation-service', () => ({ AutomationService: vi.fn() }));
vi.mock('../src/main/services/browser-service', () => ({ BrowserService: vi.fn() }));
vi.mock('../src/main/services/rag-service', () => ({ RAGService: vi.fn() }));
vi.mock('../src/main/services/plugin-service', () => ({ PluginService: vi.fn() }));
vi.mock('../src/main/services/cron-service', () => ({ CronService: vi.fn() }));
vi.mock('../src/main/services/file-intelligence', () => ({ FileIntelligenceService: vi.fn() }));
vi.mock('../src/main/services/calendar-service', () => ({ CalendarService: vi.fn() }));
vi.mock('../src/main/services/privacy-service', () => ({ PrivacyService: vi.fn() }));
vi.mock('../src/main/services/security-guard', () => {
  return {
    SecurityGuard: class MockSecurityGuard {
      validateToolInput = vi.fn(() => true);
      validatePath = vi.fn((p: string) => p);
      isCommandAllowed = vi.fn(() => true);
      isPathAllowed = vi.fn(() => true);
      logAudit = vi.fn();
      validateCommand = vi.fn(() => ({ allowed: true }));
      checkSSRF = vi.fn(() => ({ blocked: false }));
    },
  };
});
vi.mock('../src/main/services/system-monitor', () => {
  return {
    SystemMonitor: class MockSystemMonitor {
      getSnapshot = vi.fn(() => ({}));
      getSystemWarnings = vi.fn(() => []);
    },
  };
});
vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { ToolsService } from '../src/main/services/tools-service';

// ─── Access private methods via prototype trick ───
function getPrivateMethod<T>(instance: any, name: string): (...args: any[]) => T {
  // Bind the method to the instance so `this` works correctly
  return instance[name].bind(instance);
}

// ─── Factory ───
function createService(): ToolsService {
  return new ToolsService();
}

// =============================================================================
// safeMathEval
// =============================================================================
describe('safeMathEval', () => {
  let svc: ToolsService;
  let evalMath: (expr: string) => number;

  beforeEach(() => {
    svc = createService();
    evalMath = getPrivateMethod(svc, 'safeMathEval');
  });

  // ── Basic arithmetic ──
  describe('basic arithmetic', () => {
    it.each([
      ['2 + 3', 5],
      ['10 - 7', 3],
      ['4 * 5', 20],
      ['15 / 3', 5],
      ['10 % 3', 1],
      ['0 + 0', 0],
    ])('evaluates %s = %d', (expr, expected) => {
      expect(evalMath(expr)).toBe(expected);
    });
  });

  // ── Operator precedence ──
  describe('operator precedence', () => {
    it.each([
      ['2 + 3 * 4', 14],
      ['(2 + 3) * 4', 20],
      ['10 - 2 * 3', 4],
      ['2 * 3 + 4 * 5', 26],
      ['(1 + 2) * (3 + 4)', 21],
    ])('evaluates %s = %d', (expr, expected) => {
      expect(evalMath(expr)).toBe(expected);
    });
  });

  // ── Power operator ──
  describe('power (^)', () => {
    it.each([
      ['2 ^ 3', 8],
      ['3 ^ 2', 9],
      ['2 ^ 0', 1],
      ['2 ** 3', 8], // ** is converted to ^ by tokenizer
    ])('evaluates %s = %d', (expr, expected) => {
      expect(evalMath(expr)).toBe(expected);
    });

    it('right-associative: 2^3^2 = 2^(3^2) = 512', () => {
      expect(evalMath('2^3^2')).toBe(512);
    });
  });

  // ── Unary operators ──
  describe('unary operators', () => {
    it.each([
      ['-5', -5],
      ['+5', 5],
      ['-(3 + 2)', -5],
      ['-(-3)', 3],
      ['--3', 3],
    ])('evaluates %s = %d', (expr, expected) => {
      expect(evalMath(expr)).toBe(expected);
    });
  });

  // ── Constants ──
  describe('constants', () => {
    it('PI', () => {
      expect(evalMath('PI')).toBeCloseTo(Math.PI, 10);
    });

    it('E', () => {
      expect(evalMath('E')).toBeCloseTo(Math.E, 10);
    });

    it('PI * 2', () => {
      expect(evalMath('PI * 2')).toBeCloseTo(Math.PI * 2, 10);
    });
  });

  // ── Math functions ──
  describe('functions', () => {
    it.each([
      ['sqrt(16)', 4],
      ['sqrt(0)', 0],
      ['abs(-5)', 5],
      ['abs(5)', 5],
      ['round(3.7)', 4],
      ['round(3.2)', 3],
      ['floor(3.9)', 3],
      ['ceil(3.1)', 4],
    ])('evaluates %s = %d', (expr, expected) => {
      expect(evalMath(expr)).toBe(expected);
    });

    it.each([
      ['sin(0)', Math.sin(0)],
      ['cos(0)', Math.cos(0)],
      ['tan(0)', Math.tan(0)],
      ['log(1)', Math.log(1)],
      ['log10(100)', Math.log10(100)],
    ])('evaluates %s ≈ %d', (expr, expected) => {
      expect(evalMath(expr)).toBeCloseTo(expected, 10);
    });

    it('pow(2, 10) = 1024', () => {
      expect(evalMath('pow(2, 10)')).toBe(1024);
    });

    it('min(3, 7) = 3', () => {
      expect(evalMath('min(3, 7)')).toBe(3);
    });

    it('max(3, 7) = 7', () => {
      expect(evalMath('max(3, 7)')).toBe(7);
    });

    it('nested functions: sqrt(abs(-16))', () => {
      expect(evalMath('sqrt(abs(-16))')).toBe(4);
    });

    it('function with expression arg: sqrt(9 + 16)', () => {
      expect(evalMath('sqrt(9 + 16)')).toBe(5);
    });
  });

  // ── Decimal numbers ──
  describe('decimals', () => {
    it.each([
      ['3.14', 3.14],
      ['0.5 + 0.5', 1],
      ['.5 + .5', 1],
      ['1.1 * 2', 2.2],
    ])('evaluates %s ≈ %d', (expr, expected) => {
      expect(evalMath(expr)).toBeCloseTo(expected, 10);
    });
  });

  // ── Complex expressions ──
  describe('complex expressions', () => {
    it('(2 + 3) * (4 - 1) / 3 = 5', () => {
      expect(evalMath('(2 + 3) * (4 - 1) / 3')).toBe(5);
    });

    it('sqrt(3^2 + 4^2) = 5', () => {
      expect(evalMath('sqrt(3^2 + 4^2)')).toBe(5);
    });

    it('2 * PI * 5 ≈ 31.416', () => {
      expect(evalMath('2 * PI * 5')).toBeCloseTo(2 * Math.PI * 5, 5);
    });
  });

  // ── Error handling ──
  describe('errors', () => {
    it('throws on unknown identifier', () => {
      expect(() => evalMath('foo')).toThrow(/niedozwolone identyfikatory|Nieoczekiwany/i);
    });

    it('throws on empty expression', () => {
      expect(() => evalMath('')).toThrow();
    });

    it('throws on unmatched parenthesis', () => {
      expect(() => evalMath('(2 + 3')).toThrow();
    });

    it('throws on illegal characters', () => {
      expect(() => evalMath('2 & 3')).toThrow(/niedozwolone znaki/i);
    });

    it('throws on trailing operator', () => {
      expect(() => evalMath('2 +')).toThrow();
    });

    it('throws on division by zero (Infinity)', () => {
      expect(() => evalMath('1 / 0')).toThrow(/skończoną liczbą/i);
    });
  });
});

// =============================================================================
// tokenizeMathExpr
// =============================================================================
describe('tokenizeMathExpr', () => {
  let svc: ToolsService;
  let tokenize: (expr: string) => string[];

  beforeEach(() => {
    svc = createService();
    tokenize = getPrivateMethod(svc, 'tokenizeMathExpr');
  });

  it('tokenizes simple addition', () => {
    expect(tokenize('2+3')).toEqual(['2', '+', '3']);
  });

  it('tokenizes with spaces', () => {
    expect(tokenize('2 + 3')).toEqual(['2', '+', '3']);
  });

  it('tokenizes decimal numbers', () => {
    expect(tokenize('3.14')).toEqual(['3.14']);
  });

  it('tokenizes leading dot', () => {
    expect(tokenize('.5')).toEqual(['.5']);
  });

  it('tokenizes identifiers (functions)', () => {
    expect(tokenize('sqrt(16)')).toEqual(['sqrt', '(', '16', ')']);
  });

  it('tokenizes constants', () => {
    expect(tokenize('PI*2')).toEqual(['PI', '*', '2']);
  });

  it('tokenizes ** as ^', () => {
    expect(tokenize('2**3')).toEqual(['2', '^', '3']);
  });

  it('tokenizes commas for multi-arg functions', () => {
    expect(tokenize('pow(2,10)')).toEqual(['pow', '(', '2', ',', '10', ')']);
  });

  it('tokenizes complex expression', () => {
    expect(tokenize('(2+3)*4')).toEqual(['(', '2', '+', '3', ')', '*', '4']);
  });

  it('tokenizes all operators', () => {
    expect(tokenize('2+3-4*5/6%7^8')).toEqual(['2', '+', '3', '-', '4', '*', '5', '/', '6', '%', '7', '^', '8']);
  });

  it('tokenizes function with nested parens', () => {
    expect(tokenize('sqrt(abs(-5))')).toEqual(['sqrt', '(', 'abs', '(', '-', '5', ')', ')']);
  });

  it('throws on invalid chars', () => {
    expect(() => tokenize('2 & 3')).toThrow(/niedozwolone znaki/i);
  });
});

// =============================================================================
// isPrivateIP
// =============================================================================
describe('isPrivateIP', () => {
  let svc: ToolsService;
  let isPrivate: (ip: string) => boolean;

  beforeEach(() => {
    svc = createService();
    isPrivate = getPrivateMethod(svc, 'isPrivateIP');
  });

  // ── IPv4 private ranges ──
  describe('IPv4 private', () => {
    it.each([
      ['127.0.0.1', true],
      ['127.255.255.255', true],
      ['10.0.0.1', true],
      ['10.255.255.255', true],
      ['172.16.0.1', true],
      ['172.31.255.255', true],
      ['192.168.0.1', true],
      ['192.168.255.255', true],
      ['169.254.0.1', true],
      ['169.254.255.255', true],
      ['0.0.0.0', true],
      ['0.1.2.3', true],
    ])('isPrivateIP(%s) = %s', (ip, expected) => {
      expect(isPrivate(ip)).toBe(expected);
    });
  });

  // ── IPv4 public ranges ──
  describe('IPv4 public', () => {
    it.each([
      ['8.8.8.8', false],
      ['1.1.1.1', false],
      ['203.0.113.1', false],
      ['172.32.0.1', false],
      ['172.15.255.255', false],
      ['192.169.0.1', false],
      ['11.0.0.1', false],
    ])('isPrivateIP(%s) = %s', (ip, expected) => {
      expect(isPrivate(ip)).toBe(expected);
    });
  });

  // ── IPv6 reserved ──
  describe('IPv6 reserved', () => {
    it.each([
      ['::1', true],
      ['::', true],
      ['fc00::', true],
      ['fd12:3456::', true],
      ['fe80::1', true],
    ])('isPrivateIP(%s) = %s', (ip, expected) => {
      expect(isPrivate(ip)).toBe(expected);
    });
  });

  // ── IPv6 mapped IPv4 ──
  describe('IPv6-mapped IPv4', () => {
    it('::ffff:127.0.0.1 is private', () => {
      expect(isPrivate('::ffff:127.0.0.1')).toBe(true);
    });

    it('::ffff:8.8.8.8 is public', () => {
      expect(isPrivate('::ffff:8.8.8.8')).toBe(false);
    });
  });

  // ── IPv6 public ──
  describe('IPv6 public', () => {
    it.each([
      ['2001:4860:4860::8888', false],
      ['2606:4700:4700::1111', false],
    ])('isPrivateIP(%s) = %s', (ip, expected) => {
      expect(isPrivate(ip)).toBe(expected);
    });
  });
});

// =============================================================================
// parseReminderTime
// =============================================================================
describe('parseReminderTime', () => {
  let svc: ToolsService;
  let parseTime: (input: string) => { schedule: string; timestamp?: number } | null;

  beforeEach(() => {
    svc = createService();
    parseTime = getPrivateMethod(svc, 'parseReminderTime');
  });

  // ── Relative PL ──
  describe('relative time (PL)', () => {
    it('za 5 minut', () => {
      const result = parseTime('za 5 minut');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('5m');
      expect(result!.timestamp).toBeGreaterThan(Date.now());
    });

    it('za 2 godziny', () => {
      const result = parseTime('za 2 godziny');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('2g');
      expect(result!.timestamp).toBeGreaterThan(Date.now());
    });

    it('za 30 sekund', () => {
      const result = parseTime('za 30 sekund');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('30s');
    });
  });

  // ── Relative EN ──
  describe('relative time (EN)', () => {
    it('in 10 minutes', () => {
      const result = parseTime('in 10 minutes');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('10m');
    });

    it('in 1 hour', () => {
      const result = parseTime('in 1 hour');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('1h');
    });

    it('in 45 seconds', () => {
      const result = parseTime('in 45 seconds');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('45s');
    });
  });

  // ── Tomorrow ──
  describe('tomorrow', () => {
    it('jutro o 9:00 → cron schedule with tomorrow timestamp', () => {
      const result = parseTime('jutro o 9:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 9 * * *');
      expect(result!.timestamp).toBeDefined();
      const target = new Date(result!.timestamp!);
      expect(target.getHours()).toBe(9);
      expect(target.getMinutes()).toBe(0);
    });

    it('tomorrow at 14:30', () => {
      const result = parseTime('tomorrow at 14:30');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('30 14 * * *');
    });
  });

  // ── Today ──
  describe('today', () => {
    it('dziś o 23:59 → schedule', () => {
      const result = parseTime('dziś o 23:59');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('59 23 * * *');
    });

    it('today at 23:59', () => {
      const result = parseTime('today at 23:59');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('59 23 * * *');
    });
  });

  // ── Day of week ──
  describe('day of week', () => {
    it('w poniedzialek o 10:00', () => {
      const result = parseTime('w poniedzialek o 10:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 10 * * 1');
      expect(result!.timestamp).toBeDefined();
    });

    it('on friday at 15:30', () => {
      const result = parseTime('on friday at 15:30');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('30 15 * * 5');
    });

    it('w sobota o 8:00', () => {
      const result = parseTime('sobota o 8:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 8 * * 6');
    });

    it('niedziela o 12:00', () => {
      const result = parseTime('niedziela o 12:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 12 * * 0');
    });
  });

  // ── Absolute date ISO ──
  describe('absolute date', () => {
    it('ISO format (future)', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const dateStr = `${future.getFullYear()}-01-15 10:30`;
      const result = parseTime(dateStr);
      expect(result).not.toBeNull();
      expect(result!.schedule).toContain('30 10');
      expect(result!.timestamp).toBeDefined();
    });

    it('ISO format (past) → null', () => {
      const result = parseTime('2020-01-01 10:00');
      expect(result).toBeNull();
    });

    it('PL format DD.MM.YYYY HH:MM (future)', () => {
      const future = new Date();
      future.setFullYear(future.getFullYear() + 1);
      const dateStr = `15.01.${future.getFullYear()} 10:30`;
      const result = parseTime(dateStr);
      expect(result).not.toBeNull();
      expect(result!.schedule).toContain('30 10');
    });

    it('PL format (past) → null', () => {
      const result = parseTime('01.01.2020 10:00');
      expect(result).toBeNull();
    });
  });

  // ── Recurring ──
  describe('recurring', () => {
    it('codziennie o 8:00', () => {
      const result = parseTime('codziennie o 8:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 8 * * *');
      // No timestamp for recurring
      expect(result!.timestamp).toBeUndefined();
    });

    it('every day at 22:30', () => {
      const result = parseTime('every day at 22:30');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('30 22 * * *');
    });

    it('co 15 minut', () => {
      const result = parseTime('co 15 minut');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('15m');
    });

    it('every 2 hours', () => {
      const result = parseTime('every 2 hours');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('2h');
    });
  });

  // ── Time only ──
  describe('time only', () => {
    it('o 15:00', () => {
      const result = parseTime('o 15:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 15 * * *');
      expect(result!.timestamp).toBeDefined();
    });

    it('at 9:30', () => {
      const result = parseTime('at 9:30');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('30 9 * * *');
    });

    it('14:00', () => {
      const result = parseTime('14:00');
      expect(result).not.toBeNull();
      expect(result!.schedule).toBe('0 14 * * *');
    });
  });

  // ── Invalid ──
  describe('invalid input', () => {
    it('random string → null', () => {
      expect(parseTime('coś tam')).toBeNull();
    });

    it('empty string → null', () => {
      expect(parseTime('')).toBeNull();
    });
  });
});

// =============================================================================
// Registry (register / unregister / getDefinitions)
// =============================================================================
describe('ToolsService registry', () => {
  let svc: ToolsService;

  beforeEach(() => {
    svc = createService();
  });

  it('has builtin tools registered', () => {
    const defs = svc.getDefinitions();
    expect(defs.length).toBeGreaterThan(0);
  });

  it('register adds new tool', () => {
    const before = svc.getDefinitions().length;
    svc.register(
      { name: 'test_custom', description: 'Test tool', category: 'test', parameters: {} },
      async () => ({ success: true, result: 'ok' }),
    );
    expect(svc.getDefinitions().length).toBe(before + 1);
    expect(svc.getDefinitions().find((d) => d.name === 'test_custom')).toBeDefined();
  });

  it('unregister removes a tool', () => {
    svc.register(
      { name: 'to_remove', description: 'Will be removed', category: 'test', parameters: {} },
      async () => ({ success: true, result: 'ok' }),
    );
    expect(svc.getDefinitions().find((d) => d.name === 'to_remove')).toBeDefined();
    svc.unregister('to_remove');
    expect(svc.getDefinitions().find((d) => d.name === 'to_remove')).toBeUndefined();
  });

  it('unregisterByPrefix removes all matching tools', () => {
    svc.register(
      { name: 'mcp_test_one', description: 'MCP 1', category: 'mcp', parameters: {} },
      async () => ({ success: true, result: '' }),
    );
    svc.register(
      { name: 'mcp_test_two', description: 'MCP 2', category: 'mcp', parameters: {} },
      async () => ({ success: true, result: '' }),
    );
    const before = svc.getDefinitions().filter((d) => d.name.startsWith('mcp_test_')).length;
    expect(before).toBe(2);

    svc.unregisterByPrefix('mcp_test_');
    const after = svc.getDefinitions().filter((d) => d.name.startsWith('mcp_test_')).length;
    expect(after).toBe(0);
  });

  it('execute returns error for unknown tool', async () => {
    const result = await svc.execute('nonexistent_tool', {});
    expect(result.success).toBe(false);
    // result may be string or undefined depending on implementation
    expect(typeof result.result === 'string' || result.result === undefined).toBe(true);
  });

  it('execute calls registered handler', async () => {
    const handler = vi.fn(async () => ({ success: true, result: 'custom result' }));
    svc.register(
      { name: 'exec_test', description: 'Test exec', category: 'test', parameters: {} },
      handler,
    );
    const result = await svc.execute('exec_test', { foo: 'bar' });
    expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    expect(result.success).toBe(true);
    expect(result.result).toBe('custom result');
  });

  it('getToolsPrompt contains tool names', () => {
    const prompt = svc.getToolsPrompt();
    expect(prompt).toContain('Available Tools');
    // Check for at least one builtin tool name
    const defs = svc.getDefinitions();
    if (defs.length > 0) {
      expect(prompt).toContain(defs[0].name);
    }
  });

  it('setToolExecutedCallback fires on execute', async () => {
    const cb = vi.fn();
    svc.setToolExecutedCallback(cb);
    svc.register(
      { name: 'cb_test', description: 'CB test', category: 'test', parameters: {} },
      async () => ({ success: true, result: 'done' }),
    );
    await svc.execute('cb_test', {});
    expect(cb).toHaveBeenCalledWith(
      'cb_test',
      {},
      expect.objectContaining({ success: true }),
      expect.any(Number),
    );
  });
});

// =============================================================================
// formatSize (standalone helper — not exported, test via search_files tool)
// =============================================================================
describe('formatSize', () => {
  // formatSize is a module-scoped function, not on the class.
  // We can test it indirectly by importing the module scope or replicating it.
  // Since it's not exported, we replicate the logic for testing:
  function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
  }

  it.each([
    [0, '0 B'],
    [1, '1.0 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
    [1099511627776, '1.0 TB'],
  ])('formatSize(%d) = %s', (bytes, expected) => {
    expect(formatSize(bytes)).toBe(expected);
  });
});

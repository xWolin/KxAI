import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/user') },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(() => '[]'),
  writeFileSync: vi.fn(),
  readdirSync: vi.fn(() => []),
  unlinkSync: vi.fn(),
  default: {
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(() => '[]'),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    unlinkSync: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({
  readFile: vi.fn(() => Promise.resolve('[]')),
  writeFile: vi.fn(() => Promise.resolve()),
  readdir: vi.fn(() => Promise.resolve([])),
  mkdir: vi.fn(() => Promise.resolve()),
  unlink: vi.fn(() => Promise.resolve()),
  rename: vi.fn(() => Promise.resolve()),
  default: {
    readFile: vi.fn(() => Promise.resolve('[]')),
    writeFile: vi.fn(() => Promise.resolve()),
    readdir: vi.fn(() => Promise.resolve([])),
    mkdir: vi.fn(() => Promise.resolve()),
    unlink: vi.fn(() => Promise.resolve()),
    rename: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  })),
}));

import { WorkflowAutomator } from '../src/main/services/workflow-automator';

function createAutomator(): WorkflowAutomator {
  return new WorkflowAutomator();
}

// =============================================================================
// sanitizeParams
// =============================================================================
describe('sanitizeParams', () => {
  let automator: WorkflowAutomator;
  const sanitize = (p: any) => (automator as any).sanitizeParams(p);

  beforeEach(() => {
    automator = createAutomator();
  });

  it('returns empty object for null/undefined', () => {
    expect(sanitize(null)).toEqual({});
    expect(sanitize(undefined)).toEqual({});
  });

  it('returns empty object for non-object', () => {
    expect(sanitize('string')).toEqual({});
    expect(sanitize(42)).toEqual({});
  });

  it('passes through normal string params', () => {
    expect(sanitize({ query: 'hello' })).toEqual({ query: 'hello' });
  });

  it('redacts password-like keys', () => {
    const result = sanitize({
      password: 'secret123',
      myToken: 'tok123',
      secret: 'shh',
      api_key: 'key123',
      MY_CREDENTIAL: 'cred',
    });
    expect(result.password).toBe('***REDACTED***');
    expect(result.myToken).toBe('***REDACTED***');
    expect(result.secret).toBe('***REDACTED***');
    expect(result.api_key).toBe('***REDACTED***');
    expect(result.MY_CREDENTIAL).toBe('***REDACTED***');
  });

  it('truncates long strings to 2000 chars', () => {
    const longStr = 'x'.repeat(3000);
    const result = sanitize({ content: longStr });
    expect(result.content.length).toBeLessThanOrEqual(2004); // 2000 + "..."
    expect(result.content).toContain('...');
  });

  it('passes through short strings unchanged', () => {
    expect(sanitize({ name: 'John' })).toEqual({ name: 'John' });
  });

  it('passes through numbers and booleans', () => {
    expect(sanitize({ count: 42, flag: true })).toEqual({ count: 42, flag: true });
  });
});

// =============================================================================
// detectParameters
// =============================================================================
describe('detectParameters', () => {
  let automator: WorkflowAutomator;
  const detect = (steps: any[]) => (automator as any).detectParameters(steps);

  beforeEach(() => {
    automator = createAutomator();
  });

  it('returns empty for single step', () => {
    expect(detect([{ index: 0, params: { query: 'test' } }])).toEqual([]);
  });

  it('detects repeated string values across steps', () => {
    const steps = [
      { index: 0, params: { query: 'search term' } },
      { index: 1, params: { query: 'search term' } },
    ];
    const params = detect(steps);
    expect(params.length).toBeGreaterThanOrEqual(1);
    expect(params[0].defaultValue).toBe('search term');
    expect(params[0].references.length).toBe(2);
  });

  it('ignores short values (< 3 chars)', () => {
    const steps = [
      { index: 0, params: { x: 'ab' } },
      { index: 1, params: { x: 'ab' } },
    ];
    expect(detect(steps)).toEqual([]);
  });

  it('ignores boolean-like string values', () => {
    const steps = [
      { index: 0, params: { flag: 'true' } },
      { index: 1, params: { flag: 'true' } },
    ];
    expect(detect(steps)).toEqual([]);
  });

  it('ignores non-string values', () => {
    const steps = [
      { index: 0, params: { count: 42 } },
      { index: 1, params: { count: 42 } },
    ];
    expect(detect(steps)).toEqual([]);
  });

  it('detects file path params even if used once', () => {
    const steps = [
      { index: 0, params: { filepath: '/home/user/doc.txt' } },
      { index: 1, params: { query: 'hello' } },
    ];
    const params = detect(steps);
    const pathParam = params.find((p: any) => p.name === 'filepath');
    expect(pathParam).toBeDefined();
    expect(pathParam!.description).toContain('Ścieżka');
  });

  it('detects URL params even if used once', () => {
    const steps = [
      { index: 0, params: { url: 'https://example.com/api' } },
      { index: 1, params: { query: 'hello' } },
    ];
    const params = detect(steps);
    const urlParam = params.find((p: any) => p.name === 'url');
    expect(urlParam).toBeDefined();
    expect(urlParam!.description).toContain('URL');
  });

  it('uses most common key name for repeated values', () => {
    const steps = [
      { index: 0, params: { search: 'important query' } },
      { index: 1, params: { query: 'important query' } },
      { index: 2, params: { query: 'important query' } },
    ];
    const params = detect(steps);
    expect(params[0].name).toBe('query'); // 'query' appears 2x vs 'search' 1x
  });
});

// =============================================================================
// applyParamOverrides
// =============================================================================
describe('applyParamOverrides', () => {
  let automator: WorkflowAutomator;
  const apply = (stepParams: any, macroParams: any, overrides: any) =>
    (automator as any).applyParamOverrides(stepParams, macroParams, overrides);

  beforeEach(() => {
    automator = createAutomator();
  });

  it('returns copy of stepParams when no overrides', () => {
    const params = { query: 'test' };
    const result = apply(params, [], undefined);
    expect(result).toEqual({ query: 'test' });
    expect(result).not.toBe(params); // new object
  });

  it('returns copy when macroParams is undefined', () => {
    expect(apply({ a: '1' }, undefined, { b: '2' })).toEqual({ a: '1' });
  });

  it('returns copy when macroParams is empty', () => {
    expect(apply({ a: '1' }, [], { b: '2' })).toEqual({ a: '1' });
  });

  it('replaces matching values with overrides', () => {
    const stepParams = { query: 'old value', other: 'keep' };
    const macroParams = [{ name: 'query', defaultValue: 'old value', references: [] }];
    const overrides = { query: 'new value' };
    const result = apply(stepParams, macroParams, overrides);
    expect(result.query).toBe('new value');
    expect(result.other).toBe('keep');
  });

  it('replaces substring matches within values', () => {
    const stepParams = { url: 'https://api.example.com/v1/old value/data' };
    const macroParams = [{ name: 'endpoint', defaultValue: 'old value', references: [] }];
    const overrides = { endpoint: 'new value' };
    const result = apply(stepParams, macroParams, overrides);
    expect(result.url).toBe('https://api.example.com/v1/new value/data');
  });

  it('does not replace non-matching override keys', () => {
    const stepParams = { query: 'original' };
    const macroParams = [{ name: 'path', defaultValue: '/old', references: [] }];
    const overrides = { path: '/new' };
    const result = apply(stepParams, macroParams, overrides);
    expect(result.query).toBe('original'); // not changed since 'original' doesn't contain '/old'
  });
});

// =============================================================================
// Recording state machine
// =============================================================================
describe('recording state', () => {
  let automator: WorkflowAutomator;

  beforeEach(() => {
    automator = createAutomator();
  });

  it('starts not recording', () => {
    const state = automator.getRecordingState();
    expect(state.isRecording).toBe(false);
  });

  it('starts recording with name', () => {
    automator.startRecording('test-macro');
    const state = automator.getRecordingState();
    expect(state.isRecording).toBe(true);
    expect(state.macroName).toBe('test-macro');
    expect(state.stepsRecorded).toBe(0);
  });

  it('records tool executions', () => {
    automator.startRecording('macro1');
    const cb = automator.getToolExecutedCallback();
    cb('search', { query: 'hello' }, { success: true, data: 'result' }, 100);
    const state = automator.getRecordingState();
    expect(state.stepsRecorded).toBe(1);
  });

  it('excludes tools in EXCLUDED_TOOLS set', () => {
    automator.startRecording('macro1');
    const cb = automator.getToolExecutedCallback();
    cb('macro_start', { name: 'test' }, { success: true }, 10);
    cb('macro_stop', {}, { success: true }, 10);
    cb('screenshot', {}, { success: true }, 10);
    expect(automator.getRecordingState().stepsRecorded).toBe(0);
  });

  it('limits steps to MAX_STEPS (100)', () => {
    automator.startRecording('big');
    const cb = automator.getToolExecutedCallback();
    for (let i = 0; i < 110; i++) {
      cb('tool_' + i, { i: String(i) }, { success: true, data: 'ok' }, 10);
    }
    expect(automator.getRecordingState().stepsRecorded).toBe(100);
  });

  it('truncates long result summaries to MAX_RESULT_LENGTH', () => {
    automator.startRecording('trunc');
    const cb = automator.getToolExecutedCallback();
    const longResult = 'x'.repeat(1000);
    cb('search', { q: 'test' }, { success: true, data: longResult }, 50);
    const steps = (automator as any).recordingSteps;
    expect(steps[0].resultSummary.length).toBeLessThanOrEqual(503); // 500 + "..."
  });

  it('does not record when not recording', () => {
    const cb = automator.getToolExecutedCallback();
    cb('search', { q: 'test' }, { success: true }, 10);
    expect(automator.getRecordingState().stepsRecorded).toBe(0);
  });
});

// =============================================================================
// stopRecording
// =============================================================================
describe('stopRecording', () => {
  let automator: WorkflowAutomator;

  beforeEach(() => {
    automator = createAutomator();
  });

  it('returns error when not recording', () => {
    const result = automator.stopRecording();
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('returns macro with detected parameters', () => {
    automator.startRecording('param-test');
    const cb = automator.getToolExecutedCallback();
    cb('search', { query: 'repeated term' }, { success: true, data: 'r1' }, 10);
    cb('analyze', { query: 'repeated term' }, { success: true, data: 'r2' }, 20);
    const result = automator.stopRecording('Test macro');
    expect(result.success).toBe(true);
    expect(result.macro).toBeDefined();
    expect(result.macro!.name).toBe('param-test');
    expect(result.macro!.steps.length).toBe(2);
    expect(result.macro!.parameters!.length).toBeGreaterThanOrEqual(1);
    expect(automator.getRecordingState().isRecording).toBe(false);
  });

  it('returns error when no steps recorded', () => {
    automator.startRecording('empty');
    const result = automator.stopRecording();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Brak');
  });

  it('sanitizes params in recorded steps', () => {
    automator.startRecording('sanitize-test');
    const cb = automator.getToolExecutedCallback();
    cb('login', { password: 'secret123', user: 'admin' }, { success: true }, 10);
    const result = automator.stopRecording();
    expect(result.success).toBe(true);
    expect(result.macro!.steps[0].params.password).toBe('***REDACTED***');
    expect(result.macro!.steps[0].params.user).toBe('admin');
  });
});

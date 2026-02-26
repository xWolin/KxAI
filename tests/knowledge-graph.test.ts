import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───
vi.mock('crypto', () => ({
  default: { randomUUID: vi.fn(() => 'test-uuid-1') },
  randomUUID: vi.fn(() => 'test-uuid-1'),
}));

vi.mock('../src/main/services/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

import { KnowledgeGraphService } from '../src/main/services/knowledge-graph-service';

// Helper to access private methods
function priv<T>(instance: any, name: string): (...args: any[]) => T {
  return instance[name].bind(instance);
}

// Mock database builder
function createMockDb() {
  const stmtMock = {
    run: vi.fn(() => ({ changes: 1 })),
    get: vi.fn(() => null),
    all: vi.fn(() => []),
  };
  const db = {
    prepare: vi.fn(() => stmtMock),
    exec: vi.fn(),
    pragma: vi.fn(),
  };
  return { db, stmtMock };
}

function createService() {
  const svc = new KnowledgeGraphService();
  return svc;
}

function wireService(svc: KnowledgeGraphService, mockDb: any) {
  // Set up internal db reference
  (svc as any).db = { db: mockDb };
  // Set up prepared statements as simple mocks
  (svc as any).stmtInsertEntity = { run: vi.fn(), get: vi.fn() };
  (svc as any).stmtUpdateEntity = { run: vi.fn(), get: vi.fn() };
  (svc as any).stmtGetEntity = { run: vi.fn(), get: vi.fn(() => null) };
  (svc as any).stmtDeleteEntity = { run: vi.fn(() => ({ changes: 1 })) };
  (svc as any).stmtInsertRelation = { run: vi.fn() };
  (svc as any).stmtDeleteRelation = { run: vi.fn(() => ({ changes: 1 })) };
  (svc as any).stmtBumpMention = { run: vi.fn() };
}

// =============================================================================
// rowToEntity
// =============================================================================
describe('rowToEntity', () => {
  let svc: KnowledgeGraphService;
  let rowToEntity: (row: any) => any;

  beforeEach(() => {
    svc = createService();
    rowToEntity = priv(svc, 'rowToEntity');
  });

  it('maps DB row to KGEntity with camelCase fields', () => {
    const row = {
      id: 'abc',
      name: 'Alice',
      type: 'person',
      properties: '{"role":"dev"}',
      confidence: 0.9,
      source: 'conversation',
      first_seen: '2024-01-01',
      last_seen: '2024-06-01',
      mention_count: 5,
      active: 1,
    };
    const entity = rowToEntity(row);
    expect(entity.id).toBe('abc');
    expect(entity.name).toBe('Alice');
    expect(entity.type).toBe('person');
    expect(entity.properties).toEqual({ role: 'dev' });
    expect(entity.confidence).toBe(0.9);
    expect(entity.source).toBe('conversation');
    expect(entity.firstSeen).toBe('2024-01-01');
    expect(entity.lastSeen).toBe('2024-06-01');
    expect(entity.mentionCount).toBe(5);
    expect(entity.active).toBe(true);
  });

  it('active=0 maps to false', () => {
    const row = {
      id: 'x', name: 'Bob', type: 'person', properties: '{}',
      confidence: 0.5, source: 'manual', first_seen: '', last_seen: '',
      mention_count: 1, active: 0,
    };
    expect(rowToEntity(row).active).toBe(false);
  });

  it('parses empty properties as {}', () => {
    const row = {
      id: 'x', name: 'Z', type: 'topic', properties: '',
      confidence: 0.8, source: 'auto', first_seen: '', last_seen: '',
      mention_count: 0, active: 1,
    };
    expect(rowToEntity(row).properties).toEqual({});
  });
});

// =============================================================================
// rowToRelation
// =============================================================================
describe('rowToRelation', () => {
  let svc: KnowledgeGraphService;
  let rowToRelation: (row: any) => any;

  beforeEach(() => {
    svc = createService();
    rowToRelation = priv(svc, 'rowToRelation');
  });

  it('maps DB row to KGRelation with camelCase fields', () => {
    const row = {
      id: 'rel1',
      source_id: 'src1',
      target_id: 'tgt1',
      relation: 'works_at',
      properties: '{"since":"2020"}',
      strength: 0.7,
      created_at: '2024-01-01',
      updated_at: '2024-06-01',
    };
    const rel = rowToRelation(row);
    expect(rel.id).toBe('rel1');
    expect(rel.sourceId).toBe('src1');
    expect(rel.targetId).toBe('tgt1');
    expect(rel.relation).toBe('works_at');
    expect(rel.properties).toEqual({ since: '2020' });
    expect(rel.strength).toBe(0.7);
    expect(rel.createdAt).toBe('2024-01-01');
    expect(rel.updatedAt).toBe('2024-06-01');
  });

  it('parses empty properties as {}', () => {
    const row = {
      id: 'r', source_id: 'a', target_id: 'b', relation: 'knows',
      properties: '', strength: 0.5, created_at: '', updated_at: '',
    };
    expect(rowToRelation(row).properties).toEqual({});
  });
});

// =============================================================================
// getDb
// =============================================================================
describe('getDb', () => {
  it('throws when db not available', () => {
    const svc = createService();
    (svc as any).db = null;
    expect(() => priv(svc, 'getDb')()).toThrow('database not available');
  });

  it('throws when db.db is falsy', () => {
    const svc = createService();
    (svc as any).db = { db: null };
    expect(() => priv(svc, 'getDb')()).toThrow('database not available');
  });

  it('returns db.db when available', () => {
    const svc = createService();
    const mockDb = { prepare: vi.fn() };
    (svc as any).db = { db: mockDb };
    expect(priv(svc, 'getDb')()).toBe(mockDb);
  });
});

// =============================================================================
// addEntity
// =============================================================================
describe('addEntity', () => {
  let svc: KnowledgeGraphService;
  let mockDb: any;

  beforeEach(() => {
    svc = createService();
    const mock = createMockDb();
    mockDb = mock.db;
    wireService(svc, mockDb);
  });

  it('inserts new entity when no existing match', () => {
    // No existing entity found
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => undefined) });
    // After insert, getEntity returns created entity
    (svc as any).stmtGetEntity.get = vi.fn(() => ({
      id: 'test-uuid-1', name: 'Alice', type: 'person', properties: '{}',
      confidence: 0.8, source: 'conversation', first_seen: '2024-01-01',
      last_seen: '2024-01-01', mention_count: 1, active: 1,
    }));

    const result = svc.addEntity({ name: 'Alice', type: 'person' as any });
    expect(result.name).toBe('Alice');
    expect(result.type).toBe('person');
    expect((svc as any).stmtInsertEntity.run).toHaveBeenCalled();
  });

  it('merges properties when entity already exists', () => {
    const existing = {
      id: 'existing-id', name: 'Alice', type: 'person',
      properties: '{"role":"dev"}', confidence: 0.7, source: 'conversation',
      first_seen: '2024-01-01', last_seen: '2024-01-01',
      mention_count: 3, active: 1,
    };
    // Existing found
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => existing) });
    // Update statement
    mockDb.prepare.mockReturnValueOnce({ run: vi.fn() });

    const result = svc.addEntity({
      name: 'Alice', type: 'person' as any,
      properties: { team: 'core' }, confidence: 0.9,
    });
    expect(result.properties).toEqual({ role: 'dev', team: 'core' });
    expect(result.mentionCount).toBe(4);
    expect(result.confidence).toBe(0.9); // Math.max(0.7, 0.9)
  });

  it('trims entity name', () => {
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => undefined) });
    (svc as any).stmtGetEntity.get = vi.fn(() => ({
      id: 'test-uuid-1', name: 'Bob', type: 'person', properties: '{}',
      confidence: 0.8, source: 'conversation', first_seen: '', last_seen: '',
      mention_count: 1, active: 1,
    }));

    svc.addEntity({ name: '  Bob  ', type: 'person' as any });
    const insertCall = (svc as any).stmtInsertEntity.run.mock.calls[0];
    expect(insertCall[1]).toBe('Bob'); // name arg
  });

  it('uses default confidence 0.8', () => {
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => undefined) });
    (svc as any).stmtGetEntity.get = vi.fn(() => ({
      id: 'test-uuid-1', name: 'X', type: 'topic', properties: '{}',
      confidence: 0.8, source: 'conversation', first_seen: '', last_seen: '',
      mention_count: 1, active: 1,
    }));

    svc.addEntity({ name: 'X', type: 'topic' as any });
    const insertCall = (svc as any).stmtInsertEntity.run.mock.calls[0];
    expect(insertCall[4]).toBe(0.8); // confidence arg (index 4)
  });
});

// =============================================================================
// addRelation
// =============================================================================
describe('addRelation', () => {
  let svc: KnowledgeGraphService;
  let mockDb: any;

  beforeEach(() => {
    svc = createService();
    const mock = createMockDb();
    mockDb = mock.db;
    wireService(svc, mockDb);
  });

  it('returns null if source entity does not exist', () => {
    (svc as any).stmtGetEntity.get = vi.fn(() => null);

    const result = svc.addRelation({
      sourceId: 'bad-id', targetId: 'tgt', relation: 'knows',
    });
    expect(result).toBeNull();
  });

  it('returns null if target entity does not exist', () => {
    // First call (source) returns entity, second call (target) returns null
    (svc as any).stmtGetEntity.get = vi.fn()
      .mockReturnValueOnce({
        id: 'src', name: 'A', type: 'person', properties: '{}',
        confidence: 0.8, source: 'conversation', first_seen: '', last_seen: '',
        mention_count: 1, active: 1,
      })
      .mockReturnValueOnce(null);

    const result = svc.addRelation({
      sourceId: 'src', targetId: 'bad', relation: 'knows',
    });
    expect(result).toBeNull();
  });

  it('inserts new relation when no existing match', () => {
    const entityRow = {
      id: 'e1', name: 'A', type: 'person', properties: '{}',
      confidence: 0.8, source: 'conversation', first_seen: '', last_seen: '',
      mention_count: 1, active: 1,
    };
    // getEntity returns source and target
    (svc as any).stmtGetEntity.get = vi.fn(() => entityRow);
    // No existing relation
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => undefined) });
    // getRelation after insert
    const relRow = {
      id: 'test-uuid-1', source_id: 'e1', target_id: 'e1', relation: 'knows',
      properties: '{}', strength: 0.8, created_at: '', updated_at: '',
    };
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => relRow) });

    const result = svc.addRelation({
      sourceId: 'e1', targetId: 'e1', relation: 'knows',
    });
    expect(result).not.toBeNull();
    expect(result!.relation).toBe('knows');
    expect((svc as any).stmtInsertRelation.run).toHaveBeenCalled();
  });

  it('upserts existing relation with averaged strength', () => {
    const entityRow = {
      id: 'e1', name: 'A', type: 'person', properties: '{}',
      confidence: 0.8, source: 'conversation', first_seen: '', last_seen: '',
      mention_count: 1, active: 1,
    };
    (svc as any).stmtGetEntity.get = vi.fn(() => entityRow);
    // Existing relation found
    const existingRel = {
      id: 'rel1', source_id: 'e1', target_id: 'e1', relation: 'knows',
      properties: '{"context":"work"}', strength: 0.6, created_at: '', updated_at: '',
    };
    mockDb.prepare.mockReturnValueOnce({ get: vi.fn(() => existingRel) });
    // Update statement
    const updateRun = vi.fn();
    mockDb.prepare.mockReturnValueOnce({ run: updateRun });

    const result = svc.addRelation({
      sourceId: 'e1', targetId: 'e1', relation: 'knows',
      strength: 0.8, properties: { extra: 'val' },
    });

    expect(result).not.toBeNull();
    // Strength averaged: Math.min(1, (0.6 + 0.8) / 2) = 0.7
    expect(result!.strength).toBe(0.7);
    // Properties merged
    expect(result!.properties).toEqual({ context: 'work', extra: 'val' });
  });
});

// =============================================================================
// deleteEntity / deleteRelation
// =============================================================================
describe('deleteEntity', () => {
  it('returns true when entity deleted', () => {
    const svc = createService();
    (svc as any).stmtDeleteEntity = { run: vi.fn(() => ({ changes: 1 })) };
    expect(svc.deleteEntity('abc')).toBe(true);
  });

  it('returns false when entity not found', () => {
    const svc = createService();
    (svc as any).stmtDeleteEntity = { run: vi.fn(() => ({ changes: 0 })) };
    expect(svc.deleteEntity('bad')).toBe(false);
  });

  it('returns false when statement is null', () => {
    const svc = createService();
    (svc as any).stmtDeleteEntity = null;
    expect(svc.deleteEntity('x')).toBe(false);
  });
});

describe('deleteRelation', () => {
  it('returns true when relation deleted', () => {
    const svc = createService();
    (svc as any).stmtDeleteRelation = { run: vi.fn(() => ({ changes: 1 })) };
    expect(svc.deleteRelation('r1')).toBe(true);
  });

  it('returns false when not found', () => {
    const svc = createService();
    (svc as any).stmtDeleteRelation = { run: vi.fn(() => ({ changes: 0 })) };
    expect(svc.deleteRelation('bad')).toBe(false);
  });
});

// =============================================================================
// getEntity
// =============================================================================
describe('getEntity', () => {
  it('returns entity when found', () => {
    const svc = createService();
    (svc as any).stmtGetEntity = {
      get: vi.fn(() => ({
        id: 'e1', name: 'Test', type: 'topic', properties: '{}',
        confidence: 0.8, source: 'auto', first_seen: '2024-01-01',
        last_seen: '2024-01-01', mention_count: 1, active: 1,
      })),
    };
    const result = svc.getEntity('e1');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Test');
  });

  it('returns null when not found', () => {
    const svc = createService();
    (svc as any).stmtGetEntity = { get: vi.fn(() => null) };
    expect(svc.getEntity('bad')).toBeNull();
  });
});

// =============================================================================
// updateEntity
// =============================================================================
describe('updateEntity', () => {
  let svc: KnowledgeGraphService;

  beforeEach(() => {
    svc = createService();
    const { db } = createMockDb();
    wireService(svc, db);
  });

  it('returns null when entity does not exist', () => {
    (svc as any).stmtGetEntity.get = vi.fn(() => null);
    expect(svc.updateEntity('bad', { name: 'New' })).toBeNull();
  });

  it('merges properties on update', () => {
    const entityRow = {
      id: 'e1', name: 'Alice', type: 'person', properties: '{"a":1}',
      confidence: 0.8, source: 'conversation', first_seen: '', last_seen: '',
      mention_count: 1, active: 1,
    };
    (svc as any).stmtGetEntity.get = vi.fn(() => entityRow);

    svc.updateEntity('e1', { properties: { b: 2 } });
    expect((svc as any).stmtUpdateEntity.run).toHaveBeenCalled();
    const call = (svc as any).stmtUpdateEntity.run.mock.calls[0];
    // First arg is name, second is merged properties JSON
    const props = JSON.parse(call[1]);
    expect(props).toEqual({ a: 1, b: 2 });
  });

  it('updates name and confidence', () => {
    const entityRow = {
      id: 'e1', name: 'Old', type: 'person', properties: '{}',
      confidence: 0.5, source: 'conversation', first_seen: '', last_seen: '',
      mention_count: 1, active: 1,
    };
    (svc as any).stmtGetEntity.get = vi.fn(() => entityRow);

    svc.updateEntity('e1', { name: 'New', confidence: 0.95 });
    const call = (svc as any).stmtUpdateEntity.run.mock.calls[0];
    expect(call[0]).toBe('New'); // name
    expect(call[2]).toBe(0.95); // confidence
  });
});

// =============================================================================
// getStats
// =============================================================================
describe('getStats', () => {
  it('returns aggregated statistics', () => {
    const svc = createService();
    const { db } = createMockDb();
    wireService(svc, db);

    // Count entities
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 10 })) });
    // Count relations
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 5 })) });
    // Type distribution
    db.prepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { type: 'person', c: 6 },
        { type: 'technology', c: 4 },
      ]),
    });
    // Top entities
    db.prepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { name: 'Alice', type: 'person', mention_count: 20 },
        { name: 'React', type: 'technology', mention_count: 15 },
      ]),
    });

    const stats = svc.getStats();
    expect(stats.totalEntities).toBe(10);
    expect(stats.totalRelations).toBe(5);
    expect(stats.entityTypes).toEqual({ person: 6, technology: 4 });
    expect(stats.topEntities).toHaveLength(2);
    expect(stats.topEntities[0].name).toBe('Alice');
    expect(stats.topEntities[0].mentionCount).toBe(20);
  });
});

// =============================================================================
// getContextSummary
// =============================================================================
describe('getContextSummary', () => {
  it('returns empty string when no entities', () => {
    const svc = createService();
    const { db } = createMockDb();
    wireService(svc, db);

    db.prepare.mockReturnValueOnce({ all: vi.fn(() => []) });

    expect(svc.getContextSummary()).toBe('');
  });

  it('builds markdown summary with entities and relations', () => {
    const svc = createService();
    const { db } = createMockDb();
    wireService(svc, db);

    // Entities
    db.prepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { name: 'Alice', type: 'person', properties: '{"role":"CTO"}', mention_count: 10 },
        { name: 'React', type: 'technology', properties: '{}', mention_count: 5 },
      ]),
    });
    // Relations
    db.prepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { relation: 'uses', source_name: 'Alice', target_name: 'React' },
      ]),
    });

    const summary = svc.getContextSummary();
    expect(summary).toContain('Knowledge Graph');
    expect(summary).toContain('**Alice** (person)');
    expect(summary).toContain('role: CTO');
    expect(summary).toContain('**React** (technology)');
    expect(summary).toContain('Alice → uses → React');
  });

  it('filters empty properties', () => {
    const svc = createService();
    const { db } = createMockDb();
    wireService(svc, db);

    db.prepare.mockReturnValueOnce({
      all: vi.fn(() => [
        { name: 'Bob', type: 'person', properties: '{"empty":"","null":null}', mention_count: 1 },
      ]),
    });
    db.prepare.mockReturnValueOnce({ all: vi.fn(() => []) });

    const summary = svc.getContextSummary();
    expect(summary).not.toContain('empty');
    expect(summary).not.toContain('null');
  });
});

// =============================================================================
// search
// =============================================================================
describe('search', () => {
  let svc: KnowledgeGraphService;
  let db: any;

  beforeEach(() => {
    svc = createService();
    const mock = createMockDb();
    db = mock.db;
    wireService(svc, db);
  });

  it('returns entities ordered by mention count by default', () => {
    // Main query
    db.prepare.mockReturnValueOnce({
      all: vi.fn(() => [
        {
          id: 'e1', name: 'Top', type: 'person', properties: '{}',
          confidence: 0.8, source: 'auto', first_seen: '', last_seen: '',
          mention_count: 10, active: 1,
        },
      ]),
    });
    // Count query
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 1 })) });

    const result = svc.search();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0].name).toBe('Top');
    expect(result.totalCount).toBe(1);
  });

  it('filters by type', () => {
    db.prepare.mockReturnValueOnce({ all: vi.fn(() => []) });
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 0 })) });

    svc.search({ type: 'technology' as any });

    // The SQL should contain type filter
    const sqlCall = db.prepare.mock.calls[0][0];
    expect(sqlCall).toContain('e.type = ?');
  });

  it('uses FTS5 when query provided', () => {
    db.prepare.mockReturnValueOnce({ all: vi.fn(() => []) });
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 0 })) });

    svc.search({ query: 'alice' });

    const sqlCall = db.prepare.mock.calls[0][0];
    expect(sqlCall).toContain('kg_entities_fts MATCH');
  });

  it('sanitizes FTS query — removes quotes', () => {
    db.prepare.mockReturnValueOnce({
      all: vi.fn((...args: any[]) => {
        // First param after SQL is the FTS query
        expect(args[0]).not.toContain('"');
        expect(args[0]).not.toContain("'");
        return [];
      }),
    });
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 0 })) });

    svc.search({ query: '"alice\'s" project' });
  });

  it('limits to 100 max', () => {
    db.prepare.mockReturnValueOnce({ all: vi.fn(() => []) });
    db.prepare.mockReturnValueOnce({ get: vi.fn(() => ({ c: 0 })) });

    svc.search({ limit: 999 });
    // Last param should be 100
    const allCall = db.prepare.mock.results[0].value.all.mock.calls[0];
    expect(allCall[allCall.length - 1]).toBe(100);
  });
});

// =============================================================================
// shutdown
// =============================================================================
describe('shutdown', () => {
  it('does not throw', () => {
    const svc = createService();
    const { db } = createMockDb();
    wireService(svc, db);

    expect(() => svc.shutdown()).not.toThrow();
  });
});

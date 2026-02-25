/**
 * KnowledgeGraphService — structured knowledge about the user's world.
 *
 * Stores entities (people, projects, technologies, companies…) and relations
 * between them in SQLite. Provides FTS5 search, graph traversal, and AI tools
 * for the agent to build an ever-growing understanding of the user.
 *
 * Complements the flat markdown memory (SOUL.md, USER.md, MEMORY.md) with
 * structured, queryable data.
 *
 * @phase 6.3
 */

import crypto from 'crypto';
import { createLogger } from './logger';
import type { ToolDefinition, ToolResult } from '../../shared/types/tools';
import type {
  KGEntity,
  KGEntityType,
  KGRelation,
  KGSearchOptions,
  KGSearchResult,
  KGGraphResult,
  KGStats,
  KGSource,
} from '../../shared/types/knowledge-graph';

const log = createLogger('KnowledgeGraph');

// ─── Service ───

export class KnowledgeGraphService {
  private db: any = null;
  private toolsService: any = null;

  // Prepared statements cache
  private stmtInsertEntity: any = null;
  private stmtUpdateEntity: any = null;
  private stmtGetEntity: any = null;
  private stmtDeleteEntity: any = null;
  private stmtInsertRelation: any = null;
  private stmtDeleteRelation: any = null;
  private stmtBumpMention: any = null;

  /**
   * Set dependencies (called during ServiceContainer Phase 5 wiring).
   */
  setDependencies(opts: { database?: any; toolsService?: any }): void {
    if (opts.database) this.db = opts.database;
    if (opts.toolsService) this.toolsService = opts.toolsService;
  }

  /**
   * Initialize — ensure tables exist + prepare statements + register AI tools.
   */
  async initialize(): Promise<void> {
    log.info('Initializing Knowledge Graph...');
    this.ensureTables();
    this.prepareStatements();
    this.registerTools();
    log.info('Knowledge Graph initialized');
  }

  /**
   * Shutdown — cleanup.
   */
  shutdown(): void {
    log.info('Knowledge Graph shut down');
  }

  // ═══════════════════════════════════════════════════
  //  Public API
  // ═══════════════════════════════════════════════════

  /**
   * Add or merge an entity. If an entity with the same name+type exists,
   * bump its mention count and merge properties.
   */
  addEntity(opts: {
    name: string;
    type: KGEntityType;
    properties?: Record<string, unknown>;
    confidence?: number;
    source?: KGSource;
  }): KGEntity {
    const db = this.getDb();

    // Check for existing entity with same name + type (case-insensitive)
    const existing = db
      .prepare('SELECT * FROM kg_entities WHERE LOWER(name) = LOWER(?) AND type = ? AND active = 1')
      .get(opts.name.trim(), opts.type) as any | undefined;

    if (existing) {
      // Merge: bump mention count, merge properties, update last_seen
      const mergedProps = {
        ...JSON.parse(existing.properties || '{}'),
        ...(opts.properties || {}),
      };
      const newConfidence = Math.min(1, Math.max(existing.confidence, opts.confidence ?? existing.confidence));

      db.prepare(
        `
        UPDATE kg_entities
        SET properties = ?, confidence = ?, last_seen = datetime('now'), mention_count = mention_count + 1
        WHERE id = ?
      `,
      ).run(JSON.stringify(mergedProps), newConfidence, existing.id);

      return this.rowToEntity({
        ...existing,
        properties: JSON.stringify(mergedProps),
        confidence: newConfidence,
        mention_count: existing.mention_count + 1,
      });
    }

    // Insert new
    const id = crypto.randomUUID();
    const props = JSON.stringify(opts.properties || {});
    const confidence = opts.confidence ?? 0.8;
    const source = opts.source ?? 'conversation';

    this.stmtInsertEntity.run(id, opts.name.trim(), opts.type, props, confidence, source);
    log.info(`Added entity: ${opts.type}/${opts.name}`);

    return this.getEntity(id)!;
  }

  /**
   * Update entity properties (partial merge).
   */
  updateEntity(
    id: string,
    updates: { name?: string; properties?: Record<string, unknown>; confidence?: number; active?: boolean },
  ): KGEntity | null {
    const entity = this.getEntity(id);
    if (!entity) return null;

    const newProps = updates.properties
      ? JSON.stringify({ ...entity.properties, ...updates.properties })
      : JSON.stringify(entity.properties);
    const name = updates.name ?? entity.name;
    const confidence = updates.confidence ?? entity.confidence;
    const active = updates.active !== undefined ? (updates.active ? 1 : 0) : entity.active ? 1 : 0;

    this.stmtUpdateEntity.run(name, newProps, confidence, active, id);
    return this.getEntity(id);
  }

  /**
   * Get entity by ID.
   */
  getEntity(id: string): KGEntity | null {
    const row = this.stmtGetEntity?.get(id);
    return row ? this.rowToEntity(row) : null;
  }

  /**
   * Delete entity (cascade removes relations).
   */
  deleteEntity(id: string): boolean {
    const changes = this.stmtDeleteEntity?.run(id);
    return (changes?.changes ?? 0) > 0;
  }

  /**
   * Add a relation between two entities. If it already exists, update strength.
   */
  addRelation(opts: {
    sourceId: string;
    targetId: string;
    relation: string;
    properties?: Record<string, unknown>;
    strength?: number;
  }): KGRelation | null {
    const db = this.getDb();

    // Validate both entities exist
    const src = this.getEntity(opts.sourceId);
    const tgt = this.getEntity(opts.targetId);
    if (!src || !tgt) {
      log.warn(`Cannot create relation: entity not found (source=${opts.sourceId}, target=${opts.targetId})`);
      return null;
    }

    // Upsert: if relation exists, update strength
    const existing = db
      .prepare('SELECT * FROM kg_relations WHERE source_id = ? AND target_id = ? AND relation = ?')
      .get(opts.sourceId, opts.targetId, opts.relation) as any | undefined;

    if (existing) {
      const newStrength = Math.min(1, (existing.strength + (opts.strength ?? 0.8)) / 2);
      const mergedProps = {
        ...JSON.parse(existing.properties || '{}'),
        ...(opts.properties || {}),
      };
      db.prepare(
        `
        UPDATE kg_relations SET strength = ?, properties = ?, updated_at = datetime('now') WHERE id = ?
      `,
      ).run(newStrength, JSON.stringify(mergedProps), existing.id);

      return this.rowToRelation({ ...existing, strength: newStrength, properties: JSON.stringify(mergedProps) });
    }

    const id = crypto.randomUUID();
    const props = JSON.stringify(opts.properties || {});
    const strength = opts.strength ?? 0.8;

    this.stmtInsertRelation.run(id, opts.sourceId, opts.targetId, opts.relation, props, strength);
    log.info(`Added relation: ${src.name} —[${opts.relation}]→ ${tgt.name}`);

    return this.getRelation(id);
  }

  /**
   * Delete a relation.
   */
  deleteRelation(id: string): boolean {
    const changes = this.stmtDeleteRelation?.run(id);
    return (changes?.changes ?? 0) > 0;
  }

  /**
   * Search entities (FTS5 + type filter).
   */
  search(options: KGSearchOptions = {}): KGSearchResult {
    const db = this.getDb();
    const limit = Math.min(options.limit ?? 20, 100);
    const conditions: string[] = [];
    const params: any[] = [];

    if (!options.includeInactive) {
      conditions.push('e.active = 1');
    }
    if (options.type) {
      conditions.push('e.type = ?');
      params.push(options.type);
    }

    let rows: any[];

    if (options.query && options.query.trim().length > 0) {
      // FTS5 search
      const ftsQuery = options.query.trim().replace(/['"]/g, '').split(/\s+/).join(' OR ');
      const where = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

      rows = db
        .prepare(
          `
          SELECT e.*, rank
          FROM kg_entities_fts f
          JOIN kg_entities e ON e.rowid = f.rowid
          WHERE kg_entities_fts MATCH ? ${where}
          ORDER BY rank
          LIMIT ?
        `,
        )
        .all(ftsQuery, ...params, limit);
    } else {
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      rows = db
        .prepare(
          `
          SELECT * FROM kg_entities ${where}
          ORDER BY mention_count DESC, last_seen DESC
          LIMIT ?
        `,
        )
        .all(...params, limit);
    }

    const totalCount = db.prepare(`SELECT COUNT(*) as c FROM kg_entities WHERE active = 1`).get() as { c: number };

    return {
      entities: rows.map((r: any) => this.rowToEntity(r)),
      totalCount: totalCount.c,
    };
  }

  /**
   * Get the graph around an entity: entity + its connections up to `depth` levels.
   */
  getGraph(entityId?: string, depth: number = 1): KGGraphResult {
    const db = this.getDb();

    if (!entityId) {
      // Return full graph (limited to top entities by mention count)
      const entities = db
        .prepare('SELECT * FROM kg_entities WHERE active = 1 ORDER BY mention_count DESC LIMIT 50')
        .all()
        .map((r: any) => this.rowToEntity(r));

      const entityIds = new Set(entities.map((e: KGEntity) => e.id));
      const relations = db
        .prepare(
          'SELECT * FROM kg_relations WHERE source_id IN (SELECT id FROM kg_entities WHERE active = 1) ORDER BY strength DESC LIMIT 200',
        )
        .all()
        .map((r: any) => this.rowToRelation(r))
        .filter((r: KGRelation) => entityIds.has(r.sourceId) && entityIds.has(r.targetId));

      return { entities, relations };
    }

    // BFS traversal from root entity
    const visited = new Set<string>();
    const queue: { id: string; level: number }[] = [{ id: entityId, level: 0 }];
    const allRelations: KGRelation[] = [];

    while (queue.length > 0) {
      const { id, level } = queue.shift()!;
      if (visited.has(id) || level > depth) continue;
      visited.add(id);

      if (level < depth) {
        // Find neighboring relations
        const rels = db.prepare('SELECT * FROM kg_relations WHERE source_id = ? OR target_id = ?').all(id, id) as any[];

        for (const rel of rels) {
          allRelations.push(this.rowToRelation(rel));
          const neighborId = rel.source_id === id ? rel.target_id : rel.source_id;
          if (!visited.has(neighborId)) {
            queue.push({ id: neighborId, level: level + 1 });
          }
        }
      }
    }

    // Fetch all visited entities
    const entities = [...visited].map((id) => this.getEntity(id)).filter((e): e is KGEntity => e !== null);

    // Deduplicate relations
    const uniqueRelations = [...new Map(allRelations.map((r) => [r.id, r])).values()];

    return { entities, relations: uniqueRelations };
  }

  /**
   * Bump mention count + update last_seen (called by agent when entity is referenced).
   */
  touchEntity(id: string): void {
    this.stmtBumpMention?.run(id);
  }

  /**
   * Get stats for dashboard/diagnostics.
   */
  getStats(): KGStats {
    const db = this.getDb();

    const totalEntities = (db.prepare('SELECT COUNT(*) as c FROM kg_entities WHERE active = 1').get() as any).c;
    const totalRelations = (db.prepare('SELECT COUNT(*) as c FROM kg_relations').get() as any).c;

    const typeRows = db.prepare('SELECT type, COUNT(*) as c FROM kg_entities WHERE active = 1 GROUP BY type').all() as {
      type: string;
      c: number;
    }[];

    const entityTypes: Record<string, number> = {};
    for (const row of typeRows) entityTypes[row.type] = row.c;

    const topEntities = db
      .prepare(
        'SELECT name, type, mention_count FROM kg_entities WHERE active = 1 ORDER BY mention_count DESC LIMIT 10',
      )
      .all() as { name: string; type: KGEntityType; mention_count: number }[];

    return {
      totalEntities,
      totalRelations,
      entityTypes,
      topEntities: topEntities.map((r) => ({ name: r.name, type: r.type, mentionCount: r.mention_count })),
    };
  }

  /**
   * Get a summary string for AI context injection (token-budgeted).
   */
  getContextSummary(maxEntities: number = 15): string {
    const db = this.getDb();

    const entities = db
      .prepare(
        `
        SELECT name, type, properties, mention_count
        FROM kg_entities
        WHERE active = 1
        ORDER BY mention_count DESC, last_seen DESC
        LIMIT ?
      `,
      )
      .all(maxEntities) as any[];

    if (entities.length === 0) return '';

    const lines = ['## Knowledge Graph (key entities)'];
    for (const e of entities) {
      const props = JSON.parse(e.properties || '{}');
      const propStr = Object.entries(props)
        .filter(([, v]) => v !== null && v !== undefined && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      lines.push(`- **${e.name}** (${e.type})${propStr ? ` — ${propStr}` : ''}`);
    }

    // Top relations
    const relations = db
      .prepare(
        `
        SELECT r.relation, s.name as source_name, t.name as target_name
        FROM kg_relations r
        JOIN kg_entities s ON s.id = r.source_id
        JOIN kg_entities t ON t.id = r.target_id
        WHERE s.active = 1 AND t.active = 1
        ORDER BY r.strength DESC
        LIMIT 10
      `,
      )
      .all() as { relation: string; source_name: string; target_name: string }[];

    if (relations.length > 0) {
      lines.push('### Relations');
      for (const r of relations) {
        lines.push(`- ${r.source_name} → ${r.relation} → ${r.target_name}`);
      }
    }

    return lines.join('\n');
  }

  // ═══════════════════════════════════════════════════
  //  Private — Schema
  // ═══════════════════════════════════════════════════

  private getDb(): any {
    if (!this.db?.db) throw new Error('KnowledgeGraph: database not available');
    return this.db.db;
  }

  private ensureTables(): void {
    const db = this.getDb();

    db.exec(`
      -- Knowledge Graph entities (nodes)
      CREATE TABLE IF NOT EXISTS kg_entities (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        confidence REAL NOT NULL DEFAULT 0.8,
        source TEXT NOT NULL DEFAULT 'conversation',
        first_seen TEXT NOT NULL DEFAULT (datetime('now')),
        last_seen TEXT NOT NULL DEFAULT (datetime('now')),
        mention_count INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 1
      );

      CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(type);
      CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name);
      CREATE INDEX IF NOT EXISTS idx_kg_entities_active ON kg_entities(active);
      CREATE INDEX IF NOT EXISTS idx_kg_entities_mentions ON kg_entities(mention_count DESC);

      -- FTS5 full-text search on entities
      CREATE VIRTUAL TABLE IF NOT EXISTS kg_entities_fts USING fts5(
        name, properties,
        content='kg_entities',
        content_rowid='rowid',
        tokenize='unicode61 remove_diacritics 2'
      );

      -- FTS sync triggers
      CREATE TRIGGER IF NOT EXISTS kg_fts_ai AFTER INSERT ON kg_entities BEGIN
        INSERT INTO kg_entities_fts(rowid, name, properties)
        VALUES (new.rowid, new.name, new.properties);
      END;

      CREATE TRIGGER IF NOT EXISTS kg_fts_ad AFTER DELETE ON kg_entities BEGIN
        INSERT INTO kg_entities_fts(kg_entities_fts, rowid, name, properties)
        VALUES ('delete', old.rowid, old.name, old.properties);
      END;

      CREATE TRIGGER IF NOT EXISTS kg_fts_au AFTER UPDATE ON kg_entities BEGIN
        INSERT INTO kg_entities_fts(kg_entities_fts, rowid, name, properties)
        VALUES ('delete', old.rowid, old.name, old.properties);
        INSERT INTO kg_entities_fts(rowid, name, properties)
        VALUES (new.rowid, new.name, new.properties);
      END;

      -- Knowledge Graph relations (edges)
      CREATE TABLE IF NOT EXISTS kg_relations (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
        relation TEXT NOT NULL,
        properties TEXT NOT NULL DEFAULT '{}',
        strength REAL NOT NULL DEFAULT 0.8,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_kg_relations_source ON kg_relations(source_id);
      CREATE INDEX IF NOT EXISTS idx_kg_relations_target ON kg_relations(target_id);
      CREATE INDEX IF NOT EXISTS idx_kg_relations_type ON kg_relations(relation);
    `);

    log.info('Knowledge Graph tables ensured');
  }

  private prepareStatements(): void {
    const db = this.getDb();

    this.stmtInsertEntity = db.prepare(`
      INSERT INTO kg_entities (id, name, type, properties, confidence, source)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.stmtUpdateEntity = db.prepare(`
      UPDATE kg_entities SET name = ?, properties = ?, confidence = ?, active = ?, last_seen = datetime('now')
      WHERE id = ?
    `);

    this.stmtGetEntity = db.prepare('SELECT * FROM kg_entities WHERE id = ?');

    this.stmtDeleteEntity = db.prepare('DELETE FROM kg_entities WHERE id = ?');

    this.stmtInsertRelation = db.prepare(`
      INSERT INTO kg_relations (id, source_id, target_id, relation, properties, strength)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    this.stmtDeleteRelation = db.prepare('DELETE FROM kg_relations WHERE id = ?');

    this.stmtBumpMention = db.prepare(`
      UPDATE kg_entities SET mention_count = mention_count + 1, last_seen = datetime('now') WHERE id = ?
    `);
  }

  private getRelation(id: string): KGRelation | null {
    const db = this.getDb();
    const row = db.prepare('SELECT * FROM kg_relations WHERE id = ?').get(id);
    return row ? this.rowToRelation(row) : null;
  }

  // ─── Row mapping ───

  private rowToEntity(row: any): KGEntity {
    return {
      id: row.id,
      name: row.name,
      type: row.type as KGEntityType,
      properties: JSON.parse(row.properties || '{}'),
      confidence: row.confidence,
      source: row.source as KGSource,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      mentionCount: row.mention_count,
      active: row.active === 1,
    };
  }

  private rowToRelation(row: any): KGRelation {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation,
      properties: JSON.parse(row.properties || '{}'),
      strength: row.strength,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  // ═══════════════════════════════════════════════════
  //  Private — AI Tool Registration
  // ═══════════════════════════════════════════════════

  private registerTools(): void {
    if (!this.toolsService) return;

    const register = (def: ToolDefinition, handler: (params: any) => Promise<ToolResult>) => {
      this.toolsService.register(def, handler);
    };

    // ─── kg_add_entity ───
    register(
      {
        name: 'kg_add_entity',
        description:
          'Dodaje encję (osobę, projekt, technologię, firmę, temat, miejsce, nawyk, preferencję) do grafu wiedzy użytkownika. Jeśli encja o tej samej nazwie i typie istnieje, scala właściwości i zwiększa licznik wzmianek.',
        category: 'knowledge',
        parameters: {
          name: { type: 'string', description: 'Nazwa encji', required: true },
          type: {
            type: 'string',
            description: 'Typ: person, project, technology, company, topic, place, event, habit, preference',
            required: true,
          },
          properties: {
            type: 'string',
            description: 'JSON z właściwościami (np. {"role": "developer", "email": "jan@firma.pl"})',
            required: false,
          },
          confidence: {
            type: 'number',
            description: 'Pewność 0.0-1.0 (domyślnie 0.8)',
            required: false,
          },
          source: {
            type: 'string',
            description: 'Źródło: conversation, onboarding, manual, auto',
            required: false,
          },
        },
      },
      async (params) => {
        try {
          const properties = params.properties ? JSON.parse(params.properties) : {};
          const entity = this.addEntity({
            name: params.name,
            type: params.type,
            properties,
            confidence: params.confidence,
            source: params.source,
          });
          return { success: true, data: `Dodano encję: ${entity.name} (${entity.type}, id=${entity.id})` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // ─── kg_add_relation ───
    register(
      {
        name: 'kg_add_relation',
        description:
          'Dodaje relację między dwoma encjami w grafie wiedzy. Encje muszą istnieć. Jeśli relacja tego typu już istnieje, uśrednia siłę.',
        category: 'knowledge',
        parameters: {
          source_id: { type: 'string', description: 'ID encji źródłowej', required: true },
          target_id: { type: 'string', description: 'ID encji docelowej', required: true },
          relation: {
            type: 'string',
            description:
              'Typ relacji: works_at, uses, knows, prefers, manages, related_to, part_of, collaborates_with, interested_in, created, attended, owns, lives_in, member_of (lub własny)',
            required: true,
          },
          properties: { type: 'string', description: 'JSON z właściwościami relacji', required: false },
          strength: { type: 'number', description: 'Siła relacji 0.0-1.0 (domyślnie 0.8)', required: false },
        },
      },
      async (params) => {
        try {
          const properties = params.properties ? JSON.parse(params.properties) : {};
          const relation = this.addRelation({
            sourceId: params.source_id,
            targetId: params.target_id,
            relation: params.relation,
            properties,
            strength: params.strength,
          });
          if (!relation) return { success: false, error: 'Encja źródłowa lub docelowa nie istnieje' };
          return { success: true, data: `Dodano relację: ${params.relation} (id=${relation.id})` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // ─── kg_query ───
    register(
      {
        name: 'kg_query',
        description:
          'Przeszukuje graf wiedzy — wyszukuje encje po tekście (full-text) i/lub typie. Zwraca listę encji z właściwościami.',
        category: 'knowledge',
        parameters: {
          query: { type: 'string', description: 'Tekst do wyszukania (opcjonalny)', required: false },
          type: {
            type: 'string',
            description: 'Filtr typu: person, project, technology, company, topic, place, event, habit, preference',
            required: false,
          },
          limit: { type: 'number', description: 'Max wyników (domyślnie 20)', required: false },
        },
      },
      async (params) => {
        try {
          const result = this.search({
            query: params.query,
            type: params.type,
            limit: params.limit,
          });
          if (result.entities.length === 0) {
            return { success: true, data: 'Brak wyników w grafie wiedzy.' };
          }
          const lines = result.entities.map((e) => {
            const props = Object.entries(e.properties)
              .filter(([, v]) => v !== null && v !== '')
              .map(([k, v]) => `${k}=${v}`)
              .join(', ');
            return `• ${e.name} (${e.type}, id=${e.id}, wzmianki=${e.mentionCount})${props ? ` [${props}]` : ''}`;
          });
          return {
            success: true,
            data: `Znaleziono ${result.entities.length}/${result.totalCount} encji:\n${lines.join('\n')}`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // ─── kg_get_connections ───
    register(
      {
        name: 'kg_get_connections',
        description: 'Pobiera graf połączeń wokół encji (BFS traversal). Zwraca encje i relacje do podanej głębokości.',
        category: 'knowledge',
        parameters: {
          entity_id: {
            type: 'string',
            description: 'ID encji centralnej (opcjonalny — bez = cały graf)',
            required: false,
          },
          depth: { type: 'number', description: 'Głębokość przeszukiwania (domyślnie 1, max 3)', required: false },
        },
      },
      async (params) => {
        try {
          const depth = Math.min(params.depth ?? 1, 3);
          const graph = this.getGraph(params.entity_id, depth);

          if (graph.entities.length === 0) {
            return { success: true, data: 'Graf wiedzy jest pusty.' };
          }

          const entityLines = graph.entities.map((e) => `• ${e.name} (${e.type}, id=${e.id})`);
          const relationLines = graph.relations.map((r) => {
            const src = graph.entities.find((e) => e.id === r.sourceId);
            const tgt = graph.entities.find((e) => e.id === r.targetId);
            return `  ${src?.name ?? r.sourceId} —[${r.relation}]→ ${tgt?.name ?? r.targetId}`;
          });

          return {
            success: true,
            data: `Encje (${graph.entities.length}):\n${entityLines.join('\n')}\n\nRelacje (${graph.relations.length}):\n${relationLines.join('\n') || '(brak)'}`,
          };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // ─── kg_update_entity ───
    register(
      {
        name: 'kg_update_entity',
        description: 'Aktualizuje właściwości encji w grafie wiedzy (partial merge).',
        category: 'knowledge',
        parameters: {
          entity_id: { type: 'string', description: 'ID encji do zaktualizowania', required: true },
          name: { type: 'string', description: 'Nowa nazwa (opcjonalnie)', required: false },
          properties: { type: 'string', description: 'JSON z nowymi/zaktualizowanymi właściwościami', required: false },
          confidence: { type: 'number', description: 'Nowa pewność 0.0-1.0', required: false },
        },
      },
      async (params) => {
        try {
          const properties = params.properties ? JSON.parse(params.properties) : undefined;
          const updated = this.updateEntity(params.entity_id, {
            name: params.name,
            properties,
            confidence: params.confidence,
          });
          if (!updated) return { success: false, error: `Encja ${params.entity_id} nie istnieje` };
          return { success: true, data: `Zaktualizowano encję: ${updated.name} (${updated.type})` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    // ─── kg_delete_entity ───
    register(
      {
        name: 'kg_delete_entity',
        description: 'Usuwa encję z grafu wiedzy (kaskadowo usuwa powiązane relacje).',
        category: 'knowledge',
        parameters: {
          entity_id: { type: 'string', description: 'ID encji do usunięcia', required: true },
        },
      },
      async (params) => {
        try {
          const entity = this.getEntity(params.entity_id);
          if (!entity) return { success: false, error: `Encja ${params.entity_id} nie istnieje` };
          this.deleteEntity(params.entity_id);
          return { success: true, data: `Usunięto encję: ${entity.name} (${entity.type})` };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      },
    );

    log.info('Registered 6 knowledge graph tools');
  }
}

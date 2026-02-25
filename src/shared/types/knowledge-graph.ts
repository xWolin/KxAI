/**
 * Knowledge Graph types — structured knowledge about the user's world.
 * Entities = nodes (people, projects, technologies, companies, etc.)
 * Relations = edges (works_at, uses, knows, prefers, etc.)
 */

// ─── Entity Types ───

export type KGEntityType =
  | 'person'
  | 'project'
  | 'technology'
  | 'company'
  | 'topic'
  | 'place'
  | 'event'
  | 'habit'
  | 'preference';

export type KGSource = 'conversation' | 'onboarding' | 'manual' | 'auto';

export interface KGEntity {
  id: string;
  name: string;
  type: KGEntityType;
  /** Arbitrary key-value properties (role, url, email, etc.) */
  properties: Record<string, unknown>;
  /** Confidence score 0.0–1.0 */
  confidence: number;
  /** How this entity was created */
  source: KGSource;
  /** ISO datetime — when first mentioned */
  firstSeen: string;
  /** ISO datetime — last reference */
  lastSeen: string;
  /** How many times referenced */
  mentionCount: number;
  /** Soft-delete flag */
  active: boolean;
}

// ─── Relation Types ───

export type KGRelationType =
  | 'works_at'
  | 'uses'
  | 'knows'
  | 'prefers'
  | 'manages'
  | 'related_to'
  | 'part_of'
  | 'collaborates_with'
  | 'interested_in'
  | 'created'
  | 'attended'
  | 'owns'
  | 'lives_in'
  | 'member_of';

export interface KGRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relation: KGRelationType | string;
  /** Arbitrary edge properties */
  properties: Record<string, unknown>;
  /** Relation strength 0.0–1.0 */
  strength: number;
  createdAt: string;
  updatedAt: string;
}

// ─── Query & Results ───

export interface KGSearchOptions {
  /** Text query (FTS5 search on name + properties) */
  query?: string;
  /** Filter by entity type */
  type?: KGEntityType;
  /** Include inactive (soft-deleted) entities */
  includeInactive?: boolean;
  /** Max results (default 20) */
  limit?: number;
}

export interface KGSearchResult {
  entities: KGEntity[];
  totalCount: number;
}

export interface KGGraphResult {
  entities: KGEntity[];
  relations: KGRelation[];
}

export interface KGStats {
  totalEntities: number;
  totalRelations: number;
  entityTypes: Record<string, number>;
  topEntities: { name: string; type: KGEntityType; mentionCount: number }[];
}

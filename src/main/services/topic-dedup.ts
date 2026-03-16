import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { createLogger } from './logger';
import type { CortexProposal } from '../../shared/types/cortex';

const log = createLogger('TopicDedup');

export class TopicDedupService {
  private readonly storagePath: string;
  private memory: Map<string, number> = new Map();
  private readonly ttlMs = 2 * 60 * 60 * 1000; // 2 hours

  constructor(userDataPath?: string) {
    let userData = userDataPath;
    if (!userData) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { app } = require('electron') as typeof import('electron');
        userData = app.getPath('userData');
      } catch {
        userData = './mock-userData';
      }
    }
    const dir = path.join(userData, 'workspace', 'cortex');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.storagePath = path.join(dir, 'topic-dedup.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, 'utf-8');
        const parsed = JSON.parse(data);
        const now = Date.now();
        // Only load non-expired entries
        for (const [hash, timestamp] of Object.entries(parsed)) {
          if (typeof timestamp === 'number' && now - timestamp < this.ttlMs) {
            this.memory.set(hash, timestamp);
          }
        }
      }
    } catch (err) {
      log.warn('Failed to load topic dedup memory:', err);
    }
  }

  private async save(): Promise<void> {
    try {
      const obj = Object.fromEntries(this.memory.entries());
      await fsp.writeFile(this.storagePath, JSON.stringify(obj, null, 2), 'utf-8');
    } catch (err) {
      log.warn('Failed to save topic dedup memory:', err);
    }
  }

  private getHash(proposal: CortexProposal): string {
    const content = `${proposal.title}|${proposal.description}`;
    return createHash('md5').update(content).digest('hex');
  }

  /**
   * Checks if a proposal was recently made.
   */
  isDuplicate(proposal: CortexProposal): boolean {
    const hash = this.getHash(proposal);
    const lastSeen = this.memory.get(hash);
    if (!lastSeen) return false;

    if (Date.now() - lastSeen < this.ttlMs) {
      return true;
    }

    // Expired
    this.memory.delete(hash);
    return false;
  }

  /**
   * Records a proposal as seen.
   */
  record(proposal: CortexProposal): void {
    const hash = this.getHash(proposal);
    this.memory.set(hash, Date.now());
    void this.save();
  }

  /**
   * For testing purposes, allows overriding TTL or clearing memory.
   */
  clear(): void {
    this.memory.clear();
  }
}

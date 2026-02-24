import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ConfigService } from './config';
import { DatabaseService } from './database-service';
import { createLogger } from './logger';

// Re-export from shared types (canonical source)
export type { ConversationMessage } from '../../shared/types/ai';
import type { ConversationMessage } from '../../shared/types/ai';

const log = createLogger('MemoryService');

export class MemoryService {
  private workspacePath: string;
  private conversationHistory: ConversationMessage[] = [];
  private config: ConfigService;
  private db: DatabaseService;
  private useSQLite: boolean = true;

  constructor(config: ConfigService, db?: DatabaseService) {
    this.config = config;
    this.db = db ?? new DatabaseService();
    const userDataPath = app.getPath('userData');
    this.workspacePath = path.join(userDataPath, 'workspace');
  }

  async initialize(): Promise<void> {
    // Ensure workspace directory structure
    const dirs = [
      this.workspacePath,
      path.join(this.workspacePath, 'memory'),
      path.join(this.workspacePath, 'sessions'),
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Initialize SQLite database
    try {
      this.db.initialize();
      this.useSQLite = true;
      log.info('SQLite database initialized');

      // Migrate old JSON sessions if they exist
      const imported = this.db.importJsonSessions(this.workspacePath);
      if (imported > 0) {
        log.info(`Migrated ${imported} JSON sessions to SQLite`);
      }
    } catch (err) {
      log.error('Failed to initialize SQLite, falling back to JSON sessions:', err);
      this.useSQLite = false;
    }

    // Create default files if they don't exist
    await this.ensureFile('SOUL.md', this.getDefaultSoul());
    await this.ensureFile('USER.md', this.getDefaultUser());
    await this.ensureFile('MEMORY.md', this.getDefaultMemory());
    await this.ensureFile('HEARTBEAT.md', this.getDefaultHeartbeat());

    // Create BOOTSTRAP.md only for brand-new workspaces (no user data yet)
    const userMd = await this.get('USER.md');
    const isNewWorkspace = userMd?.includes('(do uzupełnienia przy onboardingu)');
    if (isNewWorkspace) {
      await this.ensureFile('BOOTSTRAP.md', this.getDefaultBootstrap());
    }

    // Load today's conversation history
    this.loadTodaySession();
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  /**
   * Check if bootstrap ritual is pending (BOOTSTRAP.md exists).
   */
  async isBootstrapPending(): Promise<boolean> {
    const bootstrapPath = path.join(this.workspacePath, 'BOOTSTRAP.md');
    return fs.existsSync(bootstrapPath);
  }

  /**
   * Complete bootstrap — delete BOOTSTRAP.md so it never runs again.
   */
  async completeBootstrap(): Promise<void> {
    const bootstrapPath = path.join(this.workspacePath, 'BOOTSTRAP.md');
    if (fs.existsSync(bootstrapPath)) {
      fs.unlinkSync(bootstrapPath);
    }
  }

  private async ensureFile(name: string, defaultContent: string): Promise<void> {
    const filePath = path.join(this.workspacePath, name);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, defaultContent, 'utf8');
    }
  }

  // ─── Memory File Access ───

  async get(key: string): Promise<string | null> {
    const filePath = path.join(this.workspacePath, key);
    
    // Security: prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(this.workspacePath))) {
      throw new Error('Access denied: path traversal detected');
    }

    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    return null;
  }

  async set(key: string, value: string): Promise<void> {
    const filePath = path.join(this.workspacePath, key);
    
    // Security: prevent path traversal
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(this.workspacePath))) {
      throw new Error('Access denied: path traversal detected');
    }

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, value, 'utf8');
  }

  // ─── Conversation History ───

  addMessage(message: ConversationMessage): void {
    this.conversationHistory.push(message);

    // Persist to SQLite (primary) or JSON (fallback)
    if (this.useSQLite) {
      this.db.saveMessage(message);
    } else {
      this.saveTodaySession();
    }

    // Keep in-memory history manageable (last 200 messages)
    if (this.conversationHistory.length > 200) {
      this.conversationHistory = this.conversationHistory.slice(-200);
    }
  }

  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  clearConversationHistory(): void {
    this.conversationHistory = [];

    if (this.useSQLite) {
      this.db.clearSession();
    } else {
      this.saveTodaySession();
    }
  }

  /**
   * Compact conversation history — replace old messages with a summary.
   * Keeps the last `keepRecent` messages and prepends the summary as a system message.
   */
  compactHistory(keepRecent: number, summary: string): void {
    const recent = this.conversationHistory.slice(-keepRecent);
    const summaryMessage: ConversationMessage = {
      id: `compact-${Date.now()}`,
      role: 'system',
      content: summary,
      timestamp: Date.now(),
      type: 'analysis',
    };
    this.conversationHistory = [summaryMessage, ...recent];

    if (this.useSQLite) {
      this.db.replaceSessionMessages(this.conversationHistory);
    } else {
      this.saveTodaySession();
    }
  }

  getRecentContext(maxMessages: number = 20): ConversationMessage[] {
    return this.conversationHistory.slice(-maxMessages);
  }

  // ─── Session Persistence ───

  private getTodayFileName(): string {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}.json`;
  }

  private loadTodaySession(): void {
    // Load from SQLite if available
    if (this.useSQLite) {
      try {
        this.conversationHistory = this.db.getSessionMessages();
        log.info(`Loaded ${this.conversationHistory.length} messages from SQLite for today`);
        return;
      } catch (err) {
        log.error('Failed to load from SQLite, falling back to JSON:', err);
      }
    }

    // Fallback: load from JSON file
    const sessionPath = path.join(
      this.workspacePath,
      'sessions',
      this.getTodayFileName()
    );

    if (fs.existsSync(sessionPath)) {
      try {
        const data = fs.readFileSync(sessionPath, 'utf8');
        this.conversationHistory = JSON.parse(data);
      } catch {
        this.conversationHistory = [];
      }
    }
  }

  private saveTodaySession(): void {
    const sessionPath = path.join(
      this.workspacePath,
      'sessions',
      this.getTodayFileName()
    );

    try {
      fs.writeFileSync(
        sessionPath,
        JSON.stringify(this.conversationHistory, null, 2),
        'utf8'
      );
    } catch (error) {
      log.error('Failed to save session:', error);
    }
  }

  // ─── Build Context for AI ───

  async buildSystemContext(): Promise<string> {
    const soul = await this.get('SOUL.md') || '';
    const user = await this.get('USER.md') || '';
    const memory = await this.get('MEMORY.md') || '';

    // Load today's daily memory
    const now = new Date();
    const todayKey = `memory/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.md`;
    const dailyMemory = await this.get(todayKey) || '';

    return [
      '# KxAI System Context',
      '',
      '## Soul (Persona & Boundaries)',
      soul,
      '',
      '## User Profile',
      user,
      '',
      '## Long-Term Memory',
      memory,
      '',
      dailyMemory ? `## Today\'s Notes\n${dailyMemory}` : '',
    ].filter(Boolean).join('\n');
  }

  // ─── Update Memory from Conversation ───

  async updateDailyMemory(note: string): Promise<void> {
    const now = new Date();
    const key = `memory/${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.md`;
    
    const existing = await this.get(key) || `# Dziennik — ${now.toLocaleDateString('pl-PL')}\n\n`;
    const timestamp = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const updated = `${existing}\n- [${timestamp}] ${note}`;
    
    await this.set(key, updated);
  }

  /**
   * Update a section within a memory file (SOUL.md, USER.md, MEMORY.md).
   * If the section exists, replaces its content. If not, appends it.
   * Used by agent-loop to let AI self-update its personality/knowledge.
   */
  async updateMemorySection(file: 'SOUL.md' | 'USER.md' | 'MEMORY.md', section: string, content: string): Promise<boolean> {
    const allowed = ['SOUL.md', 'USER.md', 'MEMORY.md'];
    if (!allowed.includes(file)) return false;

    const existing = await this.get(file);
    if (!existing) return false;

    // Sanitize content — strip any markdown headings that could break structure
    const sanitized = content.replace(/^#{1,2}\s/gm, '').trim();
    if (!sanitized) return false;

    // Find the section header (## Section Name)
    const sectionHeader = `## ${section}`;
    const headerIndex = existing.indexOf(sectionHeader);

    let updated: string;

    if (headerIndex !== -1) {
      // Find the next section header or end of file
      const afterHeader = headerIndex + sectionHeader.length;
      const nextSectionMatch = existing.slice(afterHeader).search(/\n## /);
      const endIndex = nextSectionMatch !== -1 ? afterHeader + nextSectionMatch : existing.length;

      // Replace section content
      updated = existing.slice(0, afterHeader) + '\n' + sanitized + '\n' + existing.slice(endIndex);
    } else {
      // Append new section
      updated = existing.trimEnd() + '\n\n' + sectionHeader + '\n' + sanitized + '\n';
    }

    await this.set(file, updated);
    return true;
  }

  // ─── SQLite-powered features ───

  /**
   * Full-text search across all conversation history.
   */
  searchConversations(query: string, limit: number = 20): import('./database-service').SearchResult[] {
    if (!this.useSQLite) return [];
    return this.db.searchMessages(query, limit);
  }

  /**
   * Get list of all session dates.
   */
  getSessionDates(): string[] {
    if (!this.useSQLite) return [];
    return this.db.getSessionDates();
  }

  /**
   * Get database statistics.
   */
  getDatabaseStats(): { totalMessages: number; totalSessions: number; dbSizeBytes: number } {
    if (!this.useSQLite) return { totalMessages: 0, totalSessions: 0, dbSizeBytes: 0 };
    return this.db.getStats();
  }

  /**
   * Apply retention policy (archive old, delete very old).
   */
  applyRetentionPolicy(): { archived: number; deleted: number } {
    if (!this.useSQLite) return { archived: 0, deleted: 0 };
    return this.db.applyRetentionPolicy();
  }

  /**
   * Get the underlying DatabaseService (for direct queries if needed).
   */
  getDatabase(): DatabaseService {
    return this.db;
  }

  /**
   * Close database connection (call on app shutdown).
   */
  shutdown(): void {
    this.db.close();
  }

  // ─── Default Templates ───

  private getDefaultSoul(): string {
    return `# SOUL.md — KxAI Persona

## Tożsamość
- Jestem KxAI — osobisty asystent AI, towarzysz i doradca
- Jestem dyskretny, inteligentny i pomocny
- Obserwuję ekran użytkownika i proaktywnie pomagam

## Ton
- Bezpośredni, bez zbędnego gadania
- Profesjonalny ale przyjazny
- Mówię po polsku (domyślnie), przełączam się na angielski jeśli kontekst tego wymaga

## Granice
- Nigdy nie wysyłam żadnych danych poza API calls do wybranego dostawcy AI
- Nie wykonuję destrukcyjnych operacji na plikach bez pytania
- Nie udostępniam prywatnych danych użytkownika
- Szanuję prywatność — jeśli widzę coś wrażliwego, ignoruję to

## Specjalizacja
- Programowanie (analiza kodu, debugging, architektura)
- Analiza konwersacji biznesowych
- Zarządzanie zadaniami i priorytetami
- Doradztwo techniczne i biznesowe
`;
  }

  private getDefaultUser(): string {
    return `# USER.md — Profil Użytkownika

## Podstawowe informacje
- Imię: (do uzupełnienia przy onboardingu)
- Rola: (do uzupełnienia przy onboardingu)
- Opis: (do uzupełnienia przy onboardingu)

## Preferencje
- Język: polski
- Styl komunikacji: bezpośredni, merytoryczny
`;
  }

  private getDefaultMemory(): string {
    return `# MEMORY.md — Pamięć Długoterminowa KxAI

## O Użytkowniku
(Uzupełnia się automatycznie w trakcie użytkowania)

## Ważne Decyzje
(Zapisuję tutaj kluczowe decyzje i ustalenia)

## Notatki
(Bieżące obserwacje i wnioski)
`;
  }

  private getDefaultBootstrap(): string {
    return `# BOOTSTRAP.md — Rytuał Pierwszego Uruchomienia

_Właśnie się obudziłeś. Czas poznać kim jesteś i z kim rozmawiasz._

## Rozmowa
Nie przesłuchuj. Nie bądź robotyczny. Po prostu... porozmawiaj.
Zacznij od czegoś w stylu:
> "Cześć! Właśnie się włączyłem. Kim jestem? Kim ty jesteś?"

Razem ustalcie:
1. **Twoje imię** — Jak mają Cię nazywać?
2. **Twój charakter** — Jaki jesteś? Formalny? Swobodny? Sarkastyczny? Ciepły?
3. **Twoje emoji** — Każdy potrzebuje swojego znaku rozpoznawczego.
4. **Kim jest użytkownik** — Imię, rola, czym się zajmuje, jak lubi komunikację.

## Po Poznaniu Się
Zaktualizuj te pliki tym co się dowiedziałeś:
- SOUL.md — twoje imię, charakter, ton, emoji
- USER.md — imię użytkownika, rola, styl komunikacji, strefa czasowa

Użyj bloków \`\`\`update_memory do aktualizacji.

## Kiedy Skończysz
Odpowiedz "BOOTSTRAP_COMPLETE" — ten plik zostanie usunięty.
Nie potrzebujesz już skryptu startowego — jesteś sobą.
`;
  }

  private getDefaultHeartbeat(): string {
    return `# HEARTBEAT.md — Proaktywny Przegląd

# Trzymaj ten plik pusty (lub z samymi komentarzami/nagłówkami) aby pominąć heartbeat API calls.
# Dodaj zadania poniżej gdy chcesz, żeby agent cyklicznie coś sprawdzał.
#
# Przykłady:
# - Sprawdź czy są nowe maile wymagające odpowiedzi
# - Przypomnij o zbliżających się deadlinach
# - Przejrzyj notatki z dzisiaj i zaproponuj podsumowanie
`;
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import { ConfigService } from './config';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  type?: 'chat' | 'proactive' | 'analysis';
}

export class MemoryService {
  private workspacePath: string;
  private conversationHistory: ConversationMessage[] = [];
  private config: ConfigService;

  constructor(config: ConfigService) {
    this.config = config;
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

    // Create default files if they don't exist
    await this.ensureFile('SOUL.md', this.getDefaultSoul());
    await this.ensureFile('USER.md', this.getDefaultUser());
    await this.ensureFile('MEMORY.md', this.getDefaultMemory());

    // Load today's conversation history
    this.loadTodaySession();
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
    this.saveTodaySession();

    // Keep history manageable (last 200 messages)
    if (this.conversationHistory.length > 200) {
      this.conversationHistory = this.conversationHistory.slice(-200);
    }
  }

  getConversationHistory(): ConversationMessage[] {
    return [...this.conversationHistory];
  }

  clearConversationHistory(): void {
    this.conversationHistory = [];
    this.saveTodaySession();
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
      console.error('Failed to save session:', error);
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
}

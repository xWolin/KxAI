import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { app } from 'electron';

// Re-export from shared types (canonical source)
export type { KxAIConfig } from '../../shared/types/config';
import type { KxAIConfig } from '../../shared/types/config';

const DEFAULT_CONFIG: KxAIConfig = {
  aiProvider: 'openai',
  aiModel: 'gpt-5',
  proactiveMode: false,
  proactiveIntervalMs: 30000,
  theme: 'dark',
  onboarded: false,
  agentName: 'KxAI',
  agentEmoji: '🤖',
  screenWatchEnabled: false,
  userLanguage: 'pl',
};

export class ConfigService {
  private configPath: string;
  private config: KxAIConfig;

  constructor() {
    const userDataPath = app.getPath('userData');
    this.configPath = path.join(userDataPath, 'kxai-config.json');
    this.config = this.loadConfig();
  }

  private loadConfig(): KxAIConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
      }
    } catch (error) {
      console.error('Failed to load config:', error);
    }
    return { ...DEFAULT_CONFIG };
  }

  private async saveConfig(): Promise<void> {
    try {
      const dir = path.dirname(this.configPath);
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  get(key: string): any {
    return this.config[key];
  }

  set(key: string, value: any): void {
    this.config[key] = value;
    // Fire-and-forget — config save should not block callers
    void this.saveConfig();
  }

  getAll(): KxAIConfig {
    return { ...this.config };
  }

  isOnboarded(): boolean {
    return this.config.onboarded === true;
  }

  async completeOnboarding(data: {
    userName: string;
    userRole: string;
    userDescription: string;
    agentName?: string;
    agentEmoji?: string;
    aiProvider: 'openai' | 'anthropic';
    aiModel: string;
  }): Promise<void> {
    this.config = {
      ...this.config,
      ...data,
      onboarded: true,
    };
    await this.saveConfig();
  }
}

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';

export interface KxAIConfig {
  // User profile
  userName?: string;
  userRole?: string;
  userDescription?: string;
  userLanguage?: string;

  // AI settings
  aiProvider?: 'openai' | 'anthropic';
  aiModel?: string;
  
  // Proactive mode
  proactiveMode?: boolean;
  proactiveIntervalMs?: number;

  // UI
  widgetPosition?: { x: number; y: number };
  theme?: 'dark' | 'light';

  // Onboarding
  onboarded?: boolean;

  // Agent persona
  agentName?: string;
  agentEmoji?: string;

  // Screen watching
  screenWatchEnabled?: boolean;
  monitorIndexes?: number[];

  [key: string]: any;
}

const DEFAULT_CONFIG: KxAIConfig = {
  aiProvider: 'openai',
  aiModel: 'gpt-4o',
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

  private saveConfig(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
    } catch (error) {
      console.error('Failed to save config:', error);
    }
  }

  get(key: string): any {
    return this.config[key];
  }

  set(key: string, value: any): void {
    this.config[key] = value;
    this.saveConfig();
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
    this.saveConfig();
  }
}

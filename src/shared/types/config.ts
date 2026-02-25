/**
 * Shared configuration types — used by both main process and renderer.
 *
 * KxAIConfig is derived from the Zod schema in `shared/schemas/config-schema.ts`.
 * That schema is the single source of truth for shape, defaults, and validation.
 */

export type { KxAIConfigParsed as KxAIConfig, KxAIConfigInput } from '../schemas/config-schema';

/** Key of the config object — used for typed get/set */
export type { KxAIConfigParsed } from '../schemas/config-schema';

/** Config key literal union */
export type ConfigKey = keyof import('../schemas/config-schema').KxAIConfigParsed;

export interface OnboardingData {
  userName: string;
  userRole: string;
  userDescription: string;
  agentName?: string;
  agentEmoji?: string;
  aiProvider: 'openai' | 'anthropic';
  aiModel: string;
}

/**
 * Zod schemas for structured AI response validation.
 *
 * Used by:
 * - ai-service.ts — OpenAI Structured Outputs (json_schema response_format)
 * - response-processor.ts — validation of parsed ```cron/update_memory/take_control blocks
 *
 * @module shared/schemas/ai-responses
 */

import { z } from 'zod';

// ─── Screen Analysis ───

export const ScreenAnalysisSchema = z.object({
  hasInsight: z.boolean().describe('Whether the screen contains something noteworthy'),
  message: z.string().describe('User-facing insight message (Polish)'),
  context: z.string().describe('Brief context tag for logging (e.g. "praca", "social media")'),
});

export type ScreenAnalysisResult = z.infer<typeof ScreenAnalysisSchema>;

// ─── Cron Suggestion ───

export const CronSuggestionSchema = z.object({
  name: z.string().min(1).max(100).describe('Human-readable cron job name'),
  schedule: z
    .string()
    .min(5)
    .describe('Cron expression (e.g. "0 9 * * 1-5")'),
  action: z.string().min(1).max(500).describe('Action description for the AI to execute'),
  category: z
    .enum(['routine', 'workflow', 'reminder', 'cleanup', 'health-check', 'custom'])
    .optional()
    .default('custom')
    .describe('Job category'),
});

export type CronSuggestionParsed = z.infer<typeof CronSuggestionSchema>;

// ─── Memory Update ───

export const MemoryUpdateSchema = z.object({
  file: z
    .enum(['soul', 'user', 'memory'])
    .describe('Target memory file (soul/user/memory)'),
  section: z.string().min(1).max(100).describe('Section heading in the memory file'),
  content: z.string().min(1).max(2000).describe('Content to write under the section'),
});

export type MemoryUpdateParsed = z.infer<typeof MemoryUpdateSchema>;

// ─── Take Control ───

export const TakeControlSchema = z.object({
  task: z.string().min(1).max(500).describe('Task description for desktop automation'),
});

export type TakeControlParsed = z.infer<typeof TakeControlSchema>;

// ─── OpenAI Structured Output helpers ───

/**
 * Build OpenAI `response_format` for Structured Outputs.
 * Converts a zod schema to the `json_schema` format required by OpenAI API.
 *
 * @example
 * ```ts
 * const response = await openai.chat.completions.create({
 *   ...params,
 *   response_format: buildOpenAIJsonSchema('screen_analysis', ScreenAnalysisSchema),
 * });
 * ```
 */
export function buildOpenAIJsonSchema(
  name: string,
  schema: z.ZodType,
): { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } } {
  const { toJSONSchema } = require('zod') as typeof import('zod');
  const jsonSchema = toJSONSchema(schema);

  return {
    type: 'json_schema',
    json_schema: {
      name,
      strict: true,
      schema: jsonSchema as Record<string, unknown>,
    },
  };
}

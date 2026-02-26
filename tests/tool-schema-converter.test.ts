import { describe, it, expect } from 'vitest';
import { toOpenAITools, toAnthropicTools } from '../src/main/services/tool-schema-converter';
import type { ToolDefinition } from '../src/shared/types/tools';

// ─── Test fixtures ───

const SIMPLE_TOOL: ToolDefinition = {
  name: 'get_time',
  description: 'Get current time',
  category: 'system',
  parameters: {},
};

const TOOL_WITH_PARAMS: ToolDefinition = {
  name: 'search_memory',
  description: 'Search memory for relevant info',
  category: 'memory',
  parameters: {
    query: { type: 'string', description: 'Search query', required: true },
    limit: { type: 'number', description: 'Max results', required: false },
  },
};

const TOOL_WITH_ARRAY_PARAMS: ToolDefinition = {
  name: 'batch_process',
  description: 'Process multiple items',
  category: 'utility',
  parameters: {
    items: { type: 'string[]', description: 'List of items', required: true },
    scores: { type: 'number[]', description: 'Scores per item', required: false },
  },
};

const TOOL_ALL_TYPES: ToolDefinition = {
  name: 'complex_tool',
  description: 'Tool with all param types',
  category: 'test',
  parameters: {
    name: { type: 'string', description: 'Name', required: true },
    count: { type: 'number', description: 'Count', required: true },
    enabled: { type: 'boolean', description: 'Is enabled', required: false },
    data: { type: 'object', description: 'Extra data', required: false },
    tags: { type: 'string[]', description: 'Tags', required: true },
  },
};

const MULTIPLE_TOOLS: ToolDefinition[] = [SIMPLE_TOOL, TOOL_WITH_PARAMS, TOOL_WITH_ARRAY_PARAMS];

// ─── OpenAI format ───

describe('toOpenAITools', () => {
  it('converts empty array', () => {
    expect(toOpenAITools([])).toEqual([]);
  });

  it('converts tool with no parameters', () => {
    const result = toOpenAITools([SIMPLE_TOOL]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'function',
      function: {
        name: 'get_time',
        description: 'Get current time',
        parameters: {
          type: 'object',
          properties: {},
        },
      },
    });
  });

  it('omits required array when no params are required', () => {
    const tool: ToolDefinition = {
      name: 'test',
      description: 'Test',
      category: 'test',
      parameters: {
        optional: { type: 'string', description: 'Optional', required: false },
      },
    };
    const result = toOpenAITools([tool]);
    expect(result[0].function.parameters.required).toBeUndefined();
  });

  it('includes required array only for required params', () => {
    const result = toOpenAITools([TOOL_WITH_PARAMS]);
    expect(result[0].function.parameters.required).toEqual(['query']);
  });

  it('converts string type parameter', () => {
    const result = toOpenAITools([TOOL_WITH_PARAMS]);
    expect(result[0].function.parameters.properties.query).toEqual({
      type: 'string',
      description: 'Search query',
    });
  });

  it('converts number type parameter', () => {
    const result = toOpenAITools([TOOL_WITH_PARAMS]);
    expect(result[0].function.parameters.properties.limit).toEqual({
      type: 'number',
      description: 'Max results',
    });
  });

  it('converts array type (string[]) parameter', () => {
    const result = toOpenAITools([TOOL_WITH_ARRAY_PARAMS]);
    expect(result[0].function.parameters.properties.items).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'List of items',
    });
  });

  it('converts array type (number[]) parameter', () => {
    const result = toOpenAITools([TOOL_WITH_ARRAY_PARAMS]);
    expect(result[0].function.parameters.properties.scores).toEqual({
      type: 'array',
      items: { type: 'number' },
      description: 'Scores per item',
    });
  });

  it('converts boolean type parameter', () => {
    const result = toOpenAITools([TOOL_ALL_TYPES]);
    expect(result[0].function.parameters.properties.enabled).toEqual({
      type: 'boolean',
      description: 'Is enabled',
    });
  });

  it('converts object type parameter', () => {
    const result = toOpenAITools([TOOL_ALL_TYPES]);
    expect(result[0].function.parameters.properties.data).toEqual({
      type: 'object',
      description: 'Extra data',
    });
  });

  it('collects all required params', () => {
    const result = toOpenAITools([TOOL_ALL_TYPES]);
    expect(result[0].function.parameters.required).toEqual(['name', 'count', 'tags']);
  });

  it('converts multiple tools', () => {
    const result = toOpenAITools(MULTIPLE_TOOLS);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.function.name)).toEqual(['get_time', 'search_memory', 'batch_process']);
  });

  it('all results have type: function', () => {
    const result = toOpenAITools(MULTIPLE_TOOLS);
    result.forEach((t) => expect(t.type).toBe('function'));
  });
});

// ─── Anthropic format ───

describe('toAnthropicTools', () => {
  it('converts empty array', () => {
    expect(toAnthropicTools([])).toEqual([]);
  });

  it('converts tool with no parameters', () => {
    const result = toAnthropicTools([SIMPLE_TOOL]);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: 'get_time',
      description: 'Get current time',
      input_schema: {
        type: 'object',
        properties: {},
      },
    });
  });

  it('uses input_schema instead of parameters', () => {
    const result = toAnthropicTools([TOOL_WITH_PARAMS]);
    expect(result[0]).toHaveProperty('input_schema');
    expect(result[0]).not.toHaveProperty('parameters');
  });

  it('converts required params correctly', () => {
    const result = toAnthropicTools([TOOL_WITH_PARAMS]);
    expect(result[0].input_schema.required).toEqual(['query']);
  });

  it('converts array types', () => {
    const result = toAnthropicTools([TOOL_WITH_ARRAY_PARAMS]);
    expect(result[0].input_schema.properties.items).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'List of items',
    });
  });

  it('converts all param types', () => {
    const result = toAnthropicTools([TOOL_ALL_TYPES]);
    const props = result[0].input_schema.properties;
    expect(props.name.type).toBe('string');
    expect(props.count.type).toBe('number');
    expect(props.enabled.type).toBe('boolean');
    expect(props.data.type).toBe('object');
    expect(props.tags.type).toBe('array');
    expect(props.tags.items).toEqual({ type: 'string' });
  });

  it('omits required when no params are required', () => {
    const tool: ToolDefinition = {
      name: 'test',
      description: 'Test',
      category: 'test',
      parameters: {
        foo: { type: 'string', description: 'Optional', required: false },
      },
    };
    const result = toAnthropicTools([tool]);
    expect(result[0].input_schema.required).toBeUndefined();
  });

  it('converts multiple tools preserving order', () => {
    const result = toAnthropicTools(MULTIPLE_TOOLS);
    expect(result).toHaveLength(3);
    expect(result.map((t) => t.name)).toEqual(['get_time', 'search_memory', 'batch_process']);
  });

  it('does NOT have type: function (unlike OpenAI)', () => {
    const result = toAnthropicTools([SIMPLE_TOOL]);
    expect(result[0]).not.toHaveProperty('type');
  });
});

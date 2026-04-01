import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';
import type { LLMAdapter } from './adapter.js';
import type { LLMChatRequest, LLMEvent, LLMMessage, TokenUsage } from '../types.js';

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (_client) return _client;

  const config = getConfig();
  let apiKey: string;

  try {
    const keyPath = resolve(config.credentials_path, 'anthropic_api_key');
    apiKey = readFileSync(keyPath, 'utf-8').trim();
  } catch {
    apiKey = process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) {
      throw new Error('Anthropic API key not found. Set ANTHROPIC_API_KEY env or place key at credentials_path/anthropic_api_key');
    }
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/** Allow tests to inject a mock client. */
export function _setClient(client: Anthropic | null): void {
  _client = client;
}

type AnthropicMessage = Anthropic.MessageParam;
type AnthropicTool = Anthropic.Tool;

function buildMessages(messages: LLMMessage[]): AnthropicMessage[] {
  const result: AnthropicMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'user') {
      result.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant' && msg.tool_call_id) {
      // Assistant message that was a tool call — map to tool_use content block.
      // Merge with previous assistant message if it exists (Anthropic requires
      // tool_use and text in the same assistant turn).
      const toolUseBlock: Anthropic.ToolUseBlockParam = {
        type: 'tool_use',
        id: msg.tool_call_id,
        name: msg.tool_name!,
        input: msg.tool_result ?? {},
      };

      const prev = result[result.length - 1];
      if (prev && prev.role === 'assistant') {
        // Append to existing assistant content blocks
        if (typeof prev.content === 'string') {
          prev.content = [{ type: 'text', text: prev.content }, toolUseBlock];
        } else if (Array.isArray(prev.content)) {
          (prev.content as Anthropic.ContentBlockParam[]).push(toolUseBlock);
        }
      } else {
        result.push({ role: 'assistant', content: [toolUseBlock] });
      }
    } else if (msg.role === 'assistant') {
      result.push({ role: 'assistant', content: msg.content });
    } else if (msg.role === 'tool') {
      // Tool result — Anthropic expects a user message with tool_result content block
      const toolResultBlock: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: msg.tool_call_id!,
        content: msg.content,
      };

      const prev = result[result.length - 1];
      if (prev && prev.role === 'user' && Array.isArray(prev.content)) {
        // Merge multiple tool results into same user turn
        (prev.content as Anthropic.ToolResultBlockParam[]).push(toolResultBlock);
      } else {
        result.push({ role: 'user', content: [toolResultBlock] });
      }
    }
  }

  return result;
}

function buildTools(request: LLMChatRequest): AnthropicTool[] | undefined {
  if (!request.tools || request.tools.length === 0) return undefined;

  return request.tools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters as Anthropic.Tool.InputSchema,
  }));
}

export class AnthropicAdapter implements LLMAdapter {
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  async *chat(request: LLMChatRequest): AsyncGenerator<LLMEvent> {
    const client = getClient();
    const messages = buildMessages(request.messages);
    const tools = buildTools(request);

    try {
      const stream = client.messages.stream({
        model: this.model,
        system: request.system,
        messages,
        max_tokens: request.max_tokens,
        temperature: request.temperature ?? 0.7,
        ...(tools ? { tools } : {}),
      });

      // Track tool_use blocks being built across deltas
      let currentToolId = '';
      let currentToolName = '';
      let jsonAccumulator = '';

      for await (const event of stream) {
        switch (event.type) {
          case 'content_block_start': {
            const block = event.content_block;
            if (block.type === 'tool_use') {
              currentToolId = block.id;
              currentToolName = block.name;
              jsonAccumulator = '';
            }
            break;
          }

          case 'content_block_delta': {
            const delta = event.delta;
            if (delta.type === 'text_delta') {
              yield { type: 'token', text: delta.text };
            } else if (delta.type === 'input_json_delta') {
              jsonAccumulator += delta.partial_json;
            }
            break;
          }

          case 'content_block_stop': {
            if (currentToolId) {
              let args: Record<string, unknown> = {};
              if (jsonAccumulator) {
                try {
                  args = JSON.parse(jsonAccumulator);
                } catch {
                  args = {};
                }
              }
              yield {
                type: 'tool_call',
                id: currentToolId,
                name: currentToolName,
                args,
              };
              currentToolId = '';
              currentToolName = '';
              jsonAccumulator = '';
            }
            break;
          }

          case 'message_stop': {
            // Nothing — usage is extracted after the loop from the final message
            break;
          }
        }
      }

      // Extract token usage from the final message
      const finalMessage = await stream.finalMessage();
      const usage: TokenUsage = {
        input_tokens: finalMessage.usage.input_tokens,
        output_tokens: finalMessage.usage.output_tokens,
      };

      yield { type: 'done', usage };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Anthropic error';
      yield { type: 'error', message };
    }
  }
}

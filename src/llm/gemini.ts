import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { getConfig } from '../config.js';
import type { LLMAdapter } from './adapter.js';
import type { LLMChatRequest, LLMEvent, LLMMessage, TokenUsage } from '../types.js';

let _client: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (_client) return _client;

  const config = getConfig();
  let apiKey: string;

  try {
    const keyPath = resolve(config.credentials_path, 'gemini_api_key');
    apiKey = readFileSync(keyPath, 'utf-8').trim();
  } catch {
    apiKey = process.env.GEMINI_API_KEY || '';
    if (!apiKey) {
      throw new Error('Gemini API key not found. Set GEMINI_API_KEY env or place key at credentials_path/gemini_api_key');
    }
  }

  _client = new GoogleGenAI({ apiKey });
  return _client;
}

type GeminiContent = {
  role: 'user' | 'model';
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, unknown> } }
    | { functionResponse: { name: string; response: Record<string, unknown> } }
  >;
};

function buildContents(messages: LLMMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool results map to a user-role message with functionResponse part
      contents.push({
        role: 'user',
        parts: [{
          functionResponse: {
            name: msg.tool_name!,
            response: msg.tool_result ?? { result: msg.content },
          },
        }],
      });
    } else if (msg.role === 'assistant' && msg.tool_call_id) {
      // Assistant message that was a tool call — map to model-role with functionCall
      const fcPart: Record<string, unknown> = {
        functionCall: {
          name: msg.tool_name!,
          args: msg.tool_result ?? {},
        },
      };
      // Gemini 3 Flash requires thought_signature to be preserved
      if (msg.thought_signature) {
        fcPart.thoughtSignature = msg.thought_signature;
      }
      contents.push({
        role: 'model',
        parts: [fcPart as { functionCall: { name: string; args: Record<string, unknown> } }],
      });
    } else {
      contents.push({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      });
    }
  }

  return contents;
}

function buildToolsConfig(request: LLMChatRequest): { functionDeclarations: Array<{ name: string; description: string; parameters: Record<string, unknown> }> }[] | undefined {
  if (!request.tools || request.tools.length === 0) return undefined;

  return [{
    functionDeclarations: request.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    })),
  }];
}

export class GeminiAdapter implements LLMAdapter {
  private model: string;

  constructor(model: string) {
    this.model = model;
  }

  async *chat(request: LLMChatRequest): AsyncGenerator<LLMEvent> {
    const client = getClient();
    const contents = buildContents(request.messages);
    const tools = buildToolsConfig(request);

    try {
      const response = await client.models.generateContentStream({
        model: this.model,
        contents,
        config: {
          systemInstruction: request.system,
          maxOutputTokens: request.max_tokens,
          temperature: request.temperature ?? 0.7,
          thinkingConfig: { thinkingBudget: 4096 },
          ...(tools ? { tools } : {}),
        },
      });

      let totalText = '';
      // Gemini 3 Flash puts thoughtSignature on the first functionCall part only,
      // but requires it on ALL when replaying. Track across the entire stream.
      let responseThoughtSig: string | undefined;

      for await (const chunk of response) {
        // Check for function call parts
        const candidates = (chunk as unknown as Record<string, unknown>).candidates as Array<{
          content?: { parts?: Array<Record<string, unknown>> };
        }> | undefined;

        if (candidates?.[0]?.content?.parts) {
          const parts = candidates[0].content.parts;

          // Capture thoughtSignature from any part that has it
          for (const part of parts) {
            const sig = (part as Record<string, unknown>).thoughtSignature ?? (part as Record<string, unknown>).thought_signature;
            if (sig) {
              responseThoughtSig = sig as string;
              break;
            }
          }

          for (const part of parts) {
            if (part.functionCall) {
              const fc = part.functionCall as { name: string; args: Record<string, unknown> };
              yield {
                type: 'tool_call',
                id: `tc-${Date.now()}`,
                name: fc.name,
                args: fc.args ?? {},
                ...(responseThoughtSig ? { thought_signature: responseThoughtSig } : {}),
              };
            }
          }
        }

        // Regular text tokens
        const text = chunk.text;
        if (text) {
          totalText += text;
          yield { type: 'token', text };
        }
      }

      // Estimate token usage
      const inputChars = request.system.length + request.messages.reduce((acc, m) => acc + (m.content?.length ?? 0), 0);
      const usage: TokenUsage = {
        input_tokens: Math.ceil(inputChars / 4),
        output_tokens: Math.ceil(totalText.length / 4),
      };

      yield { type: 'done', usage };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown Gemini error';
      yield { type: 'error', message };
    }
  }
}

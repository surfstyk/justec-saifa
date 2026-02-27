import { getConfig } from '../config.js';
import { GeminiAdapter } from './gemini.js';
import type { LLMAdapter } from './adapter.js';
import type { Session, LLMModelConfig } from '../types.js';

const adapterCache = new Map<string, LLMAdapter>();

function createAdapter(modelConfig: LLMModelConfig): LLMAdapter {
  const key = `${modelConfig.provider}:${modelConfig.model}`;
  const cached = adapterCache.get(key);
  if (cached) return cached;

  let adapter: LLMAdapter;

  switch (modelConfig.provider) {
    case 'google':
      adapter = new GeminiAdapter(modelConfig.model);
      break;
    default:
      throw new Error(`Unsupported LLM provider: ${modelConfig.provider}. Only 'google' is implemented.`);
  }

  adapterCache.set(key, adapter);
  return adapter;
}

export function resolveModel(session: Session): {
  adapter: LLMAdapter;
  config: LLMModelConfig;
} {
  const appConfig = getConfig();
  const modelConfig = session.tier === 'meeting_room'
    ? appConfig.llm.meeting_room
    : appConfig.llm.lobby;

  return {
    adapter: createAdapter(modelConfig),
    config: modelConfig,
  };
}

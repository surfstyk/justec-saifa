import type { Response } from 'express';
import type {
  Session, AppConfig, ActionPayload, BehavioralSignals,
  QualificationSignals, LLMMessage, ToolDefinition, StructuredMessage,
} from '../types.js';
import type { GuardAction } from '../security/guard.js';

// ── Pipeline Context ────────────────────────────────────────

export interface PipelineContext {
  // Immutable inputs
  session: Session;
  requestBody: { text?: string; action?: ActionPayload; behavioral?: BehavioralSignals };
  ipHash: string;
  config: AppConfig;

  // Accumulated state (mutable across stages)
  processedText: string;
  threatLevel: 0 | 1 | 2 | 3;
  guardAction: GuardAction | null;
  guardRedirect: string | null;
  systemPrompt: string;
  messages: LLMMessage[];
  tools: ToolDefinition[];
  fullResponse: string;
  toolCalls: ToolCallRecord[];
  structuredMessages: StructuredMessage[];
  capturedSignals: QualificationSignals | null;
  tokenUsage: { input: number; output: number };

  // SSE writer (passed through for streaming stage)
  res: Response;
  clientDisconnected: boolean;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  args: Record<string, unknown>;
  thought_signature?: string;
}

// ── Stage Result ────────────────────────────────────────────

export type StageResult =
  | { action: 'continue'; ctx: PipelineContext }
  | { action: 'halt'; ctx: PipelineContext; reason: string }
  | { action: 'terminate'; ctx: PipelineContext; reason: string; message: string };

// ── Stage Function ──────────────────────────────────────────

export type PipelineStage = (ctx: PipelineContext) => Promise<StageResult>;

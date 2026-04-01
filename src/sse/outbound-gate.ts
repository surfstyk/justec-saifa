import { ToolCallSanitizer } from './tool-call-sanitizer.js';
import { filterOutput } from '../security/output-filter.js';

/**
 * Callback invoked when the outbound gate detects a leakage pattern
 * in LLM output before it reaches the client.
 */
export type LeakageCallback = (reason: string) => void;

// Sentence-end delimiters for buffering boundaries
const SENTENCE_END = /[.!?\n]/;

/**
 * Outbound streaming gate that wraps ToolCallSanitizer and adds
 * sentence-level leakage checks before releasing text to the client.
 *
 * Design:
 * - Text flows through ToolCallSanitizer first (strips tool-call leaks)
 * - Clean output accumulates in a sentence buffer
 * - At each sentence boundary, the complete sentence is checked against
 *   leakage patterns (LEAKAGE_PATTERNS + internal_keywords)
 * - Safe sentences are released; unsafe sentences are suppressed
 * - On flush(), any remaining partial sentence is checked and released/suppressed
 */
export class OutboundGate {
  private sanitizer = new ToolCallSanitizer();
  private sentenceBuffer = '';
  private onLeakage: LeakageCallback | null;

  constructor(onLeakage?: LeakageCallback) {
    this.onLeakage = onLeakage ?? null;
  }

  /**
   * Feed a chunk of streamed text. Returns safe text to emit (may be empty).
   */
  push(chunk: string): string {
    const sanitized = this.sanitizer.push(chunk);
    if (!sanitized) return '';

    this.sentenceBuffer += sanitized;
    return this.releaseSentences();
  }

  /**
   * Flush at end-of-stream. Returns any remaining safe text.
   */
  flush(): string {
    const flushed = this.sanitizer.flush();
    if (flushed) {
      this.sentenceBuffer += flushed;
    }

    // Check whatever remains in the buffer
    const remaining = this.sentenceBuffer;
    this.sentenceBuffer = '';

    if (!remaining) return '';
    return this.checkAndRelease(remaining);
  }

  /**
   * Scan the sentence buffer for complete sentences, check each, release safe ones.
   */
  private releaseSentences(): string {
    let released = '';

    while (true) {
      const match = this.sentenceBuffer.match(SENTENCE_END);
      if (!match || match.index === undefined) break;

      // Include the delimiter in the sentence
      const boundary = match.index + 1;
      const sentence = this.sentenceBuffer.slice(0, boundary);
      this.sentenceBuffer = this.sentenceBuffer.slice(boundary);

      released += this.checkAndRelease(sentence);
    }

    return released;
  }

  /**
   * Check a text segment against the output filter. Return it if safe, empty string if not.
   */
  private checkAndRelease(text: string): string {
    const result = filterOutput(text);
    if (result.passed) return text;

    console.warn(`[outbound-gate] Suppressed leakage before emission: ${result.reason}`);
    if (this.onLeakage) {
      this.onLeakage(result.reason ?? 'unknown');
    }
    return '';
  }
}

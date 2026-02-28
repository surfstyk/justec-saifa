const TAG_START = '<tool_call:';
const TAG_END = '/>';
const MAX_BUFFER = 8192;

/**
 * Internal tool names that should never appear in visitor-facing text.
 * Used to detect function-call-style leaks like `report_signals(...)`.
 */
const TOOL_NAMES = [
  'report_signals',
  'check_calendar_availability',
  'book_appointment',
  'request_phone',
  'request_payment',
];

/**
 * Preamble phrases that Gemini emits before listing tool calls as text.
 * Matched case-insensitively. Entire line (up to next \n) is discarded.
 */
const PREAMBLE_PATTERNS = [
  'tagged calls:',
  'tool calls:',
  'function calls:',
  'calling tools:',
  'tool call:',
  'function call:',
];

type Mode = 'passthrough' | 'xml' | 'fn_call' | 'line';

/**
 * Streaming sanitizer that strips leaked tool invocations from Gemini output.
 *
 * Detects three pattern types:
 * 1. XML tags:       `<tool_call:report_signals .../>`
 * 2. Function calls: `report_signals(qualification={...})`
 * 3. Preamble lines: `Tagged calls:\n`
 *
 * Operates as a state machine with modes:
 * - **passthrough**: Scans for triggers, holds back partial matches at chunk boundaries
 * - **xml**: Buffers until `/>`, discards tag
 * - **fn_call**: Buffers while tracking `(`/`)` depth; discards call when balanced
 * - **line**: Buffers until `\n`, discards line
 *
 * Safety valve: flushes buffer as-is if it exceeds 8KB without finding an end delimiter.
 */
export class ToolCallSanitizer {
  private mode: Mode = 'passthrough';
  private buffer = '';
  private pending = ''; // partial trigger held back in passthrough mode
  private parenDepth = 0;

  /**
   * Feed a chunk of streamed text. Returns sanitized text to emit (may be empty).
   */
  push(chunk: string): string {
    if (this.mode !== 'passthrough') {
      return this.handleBuffering(chunk);
    }
    return this.handlePassThrough(chunk);
  }

  /**
   * Flush any remaining state at end-of-stream.
   * Discards incomplete buffered content; emits pending partials.
   */
  flush(): string {
    if (this.mode !== 'passthrough') {
      // Incomplete leak at end of stream — discard it
      console.warn(`[tool-call-sanitizer] Discarding incomplete ${this.mode} (${this.buffer.length} chars)`);
      this.buffer = '';
      this.mode = 'passthrough';
      this.parenDepth = 0;
      return '';
    }
    // Emit any held-back partial prefix — it wasn't a real trigger
    const out = this.pending;
    this.pending = '';
    return out;
  }

  private handlePassThrough(chunk: string): string {
    const text = this.pending + chunk;
    this.pending = '';

    // Try to find the earliest trigger in the text
    const match = this.findEarliestTrigger(text);
    if (match) {
      const before = text.slice(0, match.index);
      const remaining = text.slice(match.index);

      this.mode = match.mode;
      this.buffer = remaining;
      this.parenDepth = 0;

      // For fn_call, count opening paren(s) already in buffer
      if (match.mode === 'fn_call') {
        for (const ch of remaining) {
          if (ch === '(') this.parenDepth++;
          else if (ch === ')') this.parenDepth--;
        }
      }

      return this.drainBuffer(before);
    }

    // Check for partial trigger at end of text
    const holdBack = this.partialMatchAtEnd(text);
    if (holdBack > 0) {
      this.pending = text.slice(-holdBack);
      return text.slice(0, -holdBack);
    }

    return text;
  }

  private handleBuffering(chunk: string): string {
    this.buffer += chunk;

    // Safety valve
    if (this.buffer.length > MAX_BUFFER) {
      console.warn(`[tool-call-sanitizer] Buffer exceeded ${MAX_BUFFER} chars in ${this.mode} mode, flushing`);
      const out = this.buffer;
      this.buffer = '';
      this.mode = 'passthrough';
      this.parenDepth = 0;
      return out;
    }

    return this.drainBuffer('');
  }

  /**
   * Attempt to find the end delimiter for the current mode and consume the leak.
   * May find multiple consecutive leaks. Returns accumulated clean output.
   */
  private drainBuffer(prefix: string): string {
    let out = prefix;

    while (this.mode !== 'passthrough') {
      if (this.mode === 'xml') {
        const endIdx = this.buffer.indexOf(TAG_END);
        if (endIdx === -1) break;
        const after = this.buffer.slice(endIdx + TAG_END.length);
        console.warn(`[tool-call-sanitizer] Stripped XML tag (${endIdx + TAG_END.length} chars)`);
        this.buffer = '';
        this.mode = 'passthrough';
        if (after.length > 0) out += this.handlePassThrough(after);
      } else if (this.mode === 'fn_call') {
        // Track paren depth through new content
        const resolved = this.advanceParenDepth();
        if (resolved === -1) break; // no closing paren yet
        const after = this.buffer.slice(resolved + 1);
        console.warn(`[tool-call-sanitizer] Stripped function call (${resolved + 1} chars)`);
        this.buffer = '';
        this.mode = 'passthrough';
        this.parenDepth = 0;
        if (after.length > 0) out += this.handlePassThrough(after);
      } else if (this.mode === 'line') {
        const nlIdx = this.buffer.indexOf('\n');
        if (nlIdx === -1) break; // wait for newline
        const after = this.buffer.slice(nlIdx + 1);
        console.warn(`[tool-call-sanitizer] Stripped preamble line`);
        this.buffer = '';
        this.mode = 'passthrough';
        if (after.length > 0) out += this.handlePassThrough(after);
      }
    }

    return out;
  }

  /**
   * Scan the buffer for the position where paren depth returns to 0.
   * Returns the index of the closing `)`, or -1 if not yet balanced.
   *
   * We re-scan from the start because the buffer may have been assembled
   * from multiple chunks with interleaved counting.
   */
  private advanceParenDepth(): number {
    let depth = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      if (this.buffer[i] === '(') depth++;
      else if (this.buffer[i] === ')') {
        depth--;
        if (depth === 0) return i;
      }
    }
    this.parenDepth = depth;
    return -1;
  }

  /**
   * Find the earliest trigger in text, returning its index and mode.
   */
  private findEarliestTrigger(text: string): { index: number; mode: Mode } | null {
    let best: { index: number; mode: Mode } | null = null;

    // 1. XML tag: <tool_call:
    const xmlIdx = text.indexOf(TAG_START);
    if (xmlIdx !== -1) {
      best = { index: xmlIdx, mode: 'xml' };
    }

    // 2. Function call: tool_name(
    for (const name of TOOL_NAMES) {
      const fnIdx = text.indexOf(name + '(');
      if (fnIdx !== -1 && (!best || fnIdx < best.index)) {
        best = { index: fnIdx, mode: 'fn_call' };
      }
    }

    // 3. Preamble lines (case-insensitive)
    const textLower = text.toLowerCase();
    for (const preamble of PREAMBLE_PATTERNS) {
      const pIdx = textLower.indexOf(preamble);
      if (pIdx !== -1 && (!best || pIdx < best.index)) {
        best = { index: pIdx, mode: 'line' };
      }
    }

    return best;
  }

  /**
   * Check if text ends with a partial match of any trigger string.
   * Returns the number of trailing characters to hold back.
   */
  private partialMatchAtEnd(text: string): number {
    let maxHold = 0;

    // Check partial match against XML tag start
    maxHold = Math.max(maxHold, this.partialSuffixMatch(text, TAG_START));

    // Check partial match against each tool_name + "("
    for (const name of TOOL_NAMES) {
      maxHold = Math.max(maxHold, this.partialSuffixMatch(text, name + '('));
    }

    // Check partial match against preamble patterns
    for (const preamble of PREAMBLE_PATTERNS) {
      maxHold = Math.max(maxHold, this.partialSuffixMatchCI(text, preamble));
    }

    return maxHold;
  }

  /**
   * Returns how many chars at the end of `text` match a prefix of `trigger`.
   */
  private partialSuffixMatch(text: string, trigger: string): number {
    const maxCheck = Math.min(text.length, trigger.length - 1);
    for (let len = maxCheck; len >= 1; len--) {
      if (text.endsWith(trigger.slice(0, len))) {
        return len;
      }
    }
    return 0;
  }

  /**
   * Case-insensitive version of partialSuffixMatch.
   */
  private partialSuffixMatchCI(text: string, trigger: string): number {
    const textLower = text.toLowerCase();
    const maxCheck = Math.min(textLower.length, trigger.length - 1);
    for (let len = maxCheck; len >= 1; len--) {
      if (textLower.endsWith(trigger.slice(0, len))) {
        return len;
      }
    }
    return 0;
  }
}

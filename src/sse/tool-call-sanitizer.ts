const TAG_START = '<tool_call:';
const TAG_END = '/>';
const MAX_BUFFER = 8192;

/**
 * Streaming sanitizer that strips `<tool_call:.../>` XML leaked by Gemini.
 *
 * Operates in two modes:
 * - **Pass-through**: scans each chunk for `<tool_call:`, emits everything
 *   before it, then switches to buffering. Holds back ambiguous trailing
 *   chars (partial prefix like `<tool_`) until the next chunk resolves.
 * - **Buffering**: accumulates text until `/>` is found, discards the tag,
 *   emits any text after it.
 *
 * Safety valve: if the buffer exceeds 8 KB without finding `/>`, flushes as-is.
 */
export class ToolCallSanitizer {
  private buffering = false;
  private buffer = '';
  private pending = ''; // partial prefix held back in pass-through mode

  /**
   * Feed a chunk of streamed text. Returns sanitized text to emit (may be empty).
   */
  push(chunk: string): string {
    if (this.buffering) {
      return this.handleBuffering(chunk);
    }
    return this.handlePassThrough(chunk);
  }

  /**
   * Flush any remaining state at end-of-stream.
   * Discards incomplete tags (buffering mode), emits pending partials (pass-through).
   */
  flush(): string {
    if (this.buffering) {
      // Incomplete tag at end of stream — discard it
      console.warn(`[tool-call-sanitizer] Discarding incomplete tag (${this.buffer.length} chars)`);
      this.buffer = '';
      this.buffering = false;
      return '';
    }
    // Emit any held-back partial prefix — it wasn't a real tag start
    const out = this.pending;
    this.pending = '';
    return out;
  }

  private handlePassThrough(chunk: string): string {
    const text = this.pending + chunk;
    this.pending = '';

    const idx = text.indexOf(TAG_START);
    if (idx !== -1) {
      // Found tag start — emit everything before it, buffer the rest
      this.buffering = true;
      this.buffer = text.slice(idx);
      // Check if we already have the end in this chunk
      return this.drainBuffer(text.slice(0, idx));
    }

    // Check for partial prefix at the end (e.g. text ends with "<tool_c")
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
      console.warn(`[tool-call-sanitizer] Buffer exceeded ${MAX_BUFFER} chars, flushing as-is`);
      const out = this.buffer;
      this.buffer = '';
      this.buffering = false;
      return out;
    }

    return this.drainBuffer('');
  }

  /**
   * While in buffering mode, look for `/>` to close the tag.
   * May find multiple tags. Returns accumulated clean output.
   */
  private drainBuffer(prefix: string): string {
    let out = prefix;

    while (this.buffering) {
      const endIdx = this.buffer.indexOf(TAG_END);
      if (endIdx === -1) break;

      // Discard everything up to and including `/>`
      const after = this.buffer.slice(endIdx + TAG_END.length);
      this.buffer = '';
      this.buffering = false;

      // Process remainder — may contain another tag
      if (after.length > 0) {
        out += this.handlePassThrough(after);
      }
    }

    return out;
  }

  /**
   * Checks if `text` ends with a partial match of `<tool_call:`.
   * Returns the number of trailing characters to hold back.
   */
  private partialMatchAtEnd(text: string): number {
    // Check progressively longer suffixes of text against prefixes of TAG_START
    const maxCheck = Math.min(text.length, TAG_START.length - 1);
    for (let len = maxCheck; len >= 1; len--) {
      if (text.endsWith(TAG_START.slice(0, len))) {
        return len;
      }
    }
    return 0;
  }
}

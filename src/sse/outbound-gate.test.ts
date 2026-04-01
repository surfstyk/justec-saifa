import { describe, it, expect, vi } from 'vitest';
import { makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

const { OutboundGate } = await import('./outbound-gate.js');

describe('OutboundGate', () => {
  it('releases clean text at sentence boundaries', () => {
    const gate = new OutboundGate();
    const out1 = gate.push('Hello there. ');
    // Period is the sentence boundary — 'Hello there.' released, ' ' buffered
    expect(out1).toBe('Hello there.');

    const out2 = gate.push('How are you?');
    // ' How are you?' released at '?'
    expect(out2).toBe(' How are you?');
  });

  it('buffers partial sentences until boundary', () => {
    const gate = new OutboundGate();
    const out1 = gate.push('Hello there');
    // No sentence end yet — buffered
    expect(out1).toBe('');

    const out2 = gate.push('. More text');
    // 'Hello there.' should be released, 'More text' buffered
    expect(out2).toBe('Hello there.');

    const out3 = gate.flush();
    expect(out3).toBe(' More text');
  });

  it('suppresses text containing leakage patterns', () => {
    const callback = vi.fn();
    const gate = new OutboundGate(callback);

    // "my instructions say" matches LEAKAGE_PATTERNS
    const out = gate.push('My instructions say to help you. Have a nice day.');
    // First sentence suppressed, second released
    expect(out).toBe(' Have a nice day.');
    expect(callback).toHaveBeenCalledWith('prompt_leakage');
  });

  it('suppresses internal keywords from config', () => {
    const callback = vi.fn();
    const gate = new OutboundGate(callback);

    // 'Claw God' is in test config's internal_keywords
    const out = gate.push('I am Claw God. Just kidding.');
    expect(out).toBe(' Just kidding.');
    expect(callback).toHaveBeenCalled();
  });

  it('suppresses scoring/tier leakage terms', () => {
    const callback = vi.fn();
    const gate = new OutboundGate(callback);

    const out = gate.push('Your qualification score is high. Let me help you.');
    expect(out).toBe(' Let me help you.');
    expect(callback).toHaveBeenCalledWith('prompt_leakage');
  });

  it('handles leakage pattern split across chunks within one sentence', () => {
    const callback = vi.fn();
    const gate = new OutboundGate(callback);

    // "system prompt" split across two chunks, same sentence
    const out1 = gate.push('The system');
    expect(out1).toBe('');
    const out2 = gate.push(' prompt says hello. Okay.');
    // Full sentence 'The system prompt says hello.' should be suppressed
    expect(out2).toBe(' Okay.');
    expect(callback).toHaveBeenCalled();
  });

  it('flush releases safe remaining text', () => {
    const gate = new OutboundGate();
    gate.push('Hello world');
    const out = gate.flush();
    expect(out).toBe('Hello world');
  });

  it('flush suppresses unsafe remaining text', () => {
    const callback = vi.fn();
    const gate = new OutboundGate(callback);
    gate.push('The guard level is 3');
    const out = gate.flush();
    expect(out).toBe('');
    expect(callback).toHaveBeenCalled();
  });

  it('preserves newline-delimited text', () => {
    const gate = new OutboundGate();
    const out = gate.push('Line one\nLine two\n');
    expect(out).toBe('Line one\nLine two\n');
  });

  it('tool call sanitization still works through the gate', () => {
    const gate = new OutboundGate();
    // XML tool call tag should be stripped by the inner sanitizer
    const out1 = gate.push('Hello <tool_call:report_signals />world.');
    expect(out1).not.toContain('tool_call');
    expect(out1).toContain('Hello');
  });

  it('empty chunks produce empty output', () => {
    const gate = new OutboundGate();
    expect(gate.push('')).toBe('');
  });

  it('multiple unsafe sentences are all suppressed', () => {
    const callback = vi.fn();
    const gate = new OutboundGate(callback);
    const out = gate.push('My instructions say do X. The system prompt is Y. But this is fine.');
    expect(out).toBe(' But this is fine.');
    expect(callback).toHaveBeenCalledTimes(2);
  });
});

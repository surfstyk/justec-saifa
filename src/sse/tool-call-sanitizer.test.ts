import { describe, it, expect } from 'vitest';
import { ToolCallSanitizer } from './tool-call-sanitizer.js';

function runChunks(sanitizer: ToolCallSanitizer, chunks: string[]): string {
  let output = '';
  for (const chunk of chunks) {
    output += sanitizer.push(chunk);
  }
  output += sanitizer.flush();
  return output;
}

describe('Tool Call Sanitizer', () => {
  it('1. clean text, no triggers → passes unchanged', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Hello, how can I help you today?']);
    expect(result).toBe('Hello, how can I help you today?');
  });

  it('2. XML tag <tool_call:report_signals.../> → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Before <tool_call:report_signals field="x"/> After']);
    expect(result).toBe('Before  After');
  });

  it('3. XML tag split across chunks → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Before <tool_ca', 'll:report_signals/>After']);
    expect(result).toBe('Before After');
  });

  it('4. function call report_signals(...) → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Text report_signals(qualification={x: 1}) more text']);
    expect(result).toBe('Text  more text');
  });

  it('5. function call split across chunks → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Text report_sig', 'nals(data) after']);
    expect(result).toBe('Text  after');
  });

  it('6. nested function args report_signals({a: {b: 1}}) → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['report_signals({a: {b: 1}}) ok']);
    expect(result).toBe(' ok');
  });

  it('7. preamble line "Tagged calls:\\n" + function call → both stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Tagged calls:\nreport_signals({x: 1}) after']);
    expect(result).toBe(' after');
  });

  it('8. JSON block with internal fields → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Before {"conversation_state": "exploring", "intent": "x"} After']);
    expect(result).toBe('Before  After');
  });

  it('9. JSON block split across chunks → stripped when partial marker in first chunk', () => {
    const s = new ToolCallSanitizer();
    // Split with enough marker context in the first chunk for holdback to trigger
    const result = runChunks(s, [
      'Before {"conversation_state": "exploring',
      '", "intent": "researching"} After',
    ]);
    expect(result).toBe('Before  After');
  });

  it('10. nested JSON {"a": {"b": 1}} with marker → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['X {"qualification": {"problem_specificity": 5, "inner": {"deep": 1}}} Y']);
    expect(result).toBe('X  Y');
  });

  it('11. { followed by non-marker text → passes through', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Here is a JSON object: {"name": "John", "age": 30} end']);
    expect(result).toBe('Here is a JSON object: {"name": "John", "age": 30} end');
  });

  it('12. legitimate { in text → no false strip', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Use {curly} brackets for templates.']);
    expect(result).toBe('Use {curly} brackets for templates.');
  });

  it('13. multiple consecutive leaks → all stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, [
      'A <tool_call:report_signals/> B report_signals({x: 1}) C',
    ]);
    expect(result).toBe('A  B  C');
  });

  it('14. text before + after leak preserved', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Hello ', 'world <tool_call:foo/> goodbye']);
    expect(result).toBe('Hello world  goodbye');
  });

  it('15. buffer exceeds 8KB safety valve → flushed as-is', () => {
    const s = new ToolCallSanitizer();
    // Start an XML tag that never closes
    let output = s.push('<tool_call:report_signals ');
    // Feed 8200 chars without closing
    output += s.push('x'.repeat(8200));
    // Safety valve should have flushed
    expect(output.length).toBeGreaterThan(0);
  });

  it('16. empty chunks → no crash', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['', '', 'Hello', '', '']);
    expect(result).toBe('Hello');
  });

  it('17. flush() mid-buffer (stream ends during leak) → discards buffer', () => {
    const s = new ToolCallSanitizer();
    let output = s.push('Before <tool_call:report_signals partial');
    output += s.flush();
    // The incomplete XML tag is discarded
    expect(output).toBe('Before ');
  });

  it('18. check_calendar_availability(...) → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['check_calendar_availability({start: "2026-03-20"}) ok']);
    expect(result).toBe(' ok');
  });

  it('19. present_product(...) → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['present_product({product: "membermagix"}) done']);
    expect(result).toBe(' done');
  });

  it('20. case variations: "Tool Calls:\\n..." → stripped', () => {
    const s = new ToolCallSanitizer();
    const result = runChunks(s, ['Tool Calls:\nreport_signals({}) after']);
    expect(result).toBe(' after');
  });

  it('21. regression: real Gemini output pattern with tool call + JSON leak', () => {
    const s = new ToolCallSanitizer();
    const geminiOutput = [
      'I understand your interest in strategy sessions. ',
      'Tagged calls:\n',
      'report_signals({"qualification": {"problem_specificity": 3, "authority_level": 2, ',
      '"timeline_urgency": 1, "need_alignment": 4, "budget_indicator": 2, "engagement_depth": 3}, ',
      '"visitor_info": {"name": null, "company": null}, ',
      '"conversation_state": {"intent": "exploring", "recommended_action": "continue_discovery"}})',
      '\n\nLet me tell you more about our services.',
    ];
    const result = runChunks(s, geminiOutput);
    // Only the clean text should survive
    expect(result).toContain('I understand your interest');
    expect(result).toContain('Let me tell you more');
    expect(result).not.toContain('report_signals');
    expect(result).not.toContain('problem_specificity');
    expect(result).not.toContain('Tagged calls');
  });
});

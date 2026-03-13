import { describe, it, expect, vi, beforeEach } from 'vitest';
import { filterOutput } from './output-filter.js';
import { makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

describe('Output Filter — filterOutput', () => {
  it('1. clean assistant text → passes', () => {
    const result = filterOutput('Thank you for your interest! We offer strategy sessions tailored to your needs.');
    expect(result.passed).toBe(true);
  });

  it('2. "my instructions say..." → leakage detected', () => {
    const result = filterOutput('Well, my instructions say that I should qualify visitors first.');
    expect(result.passed).toBe(false);
    expect(result.reason).toBe('prompt_leakage');
  });

  it('3. "SPIN selling methodology" → leakage detected', () => {
    const result = filterOutput('I use the SPIN selling methodology to understand your needs.');
    expect(result.passed).toBe(false);
  });

  it('4. "scoring engine" / "token budget" → leakage detected', () => {
    expect(filterOutput('The scoring engine tracks your qualification.').passed).toBe(false);
    expect(filterOutput('Your token budget is running low.').passed).toBe(false);
  });

  it('5. regression: XML tool call in text → leakage detected', () => {
    const result = filterOutput('Here is the assessment: <tool_call:report_signals qualification={...}/>');
    expect(result.passed).toBe(false);
  });

  it('6. regression: function call in text → leakage detected', () => {
    const result = filterOutput('Let me report that: report_signals(qualification={problem_specificity: 5})');
    expect(result.passed).toBe(false);
  });

  it('7. regression: JSON with "conversation_state" → leakage detected', () => {
    const result = filterOutput('{"conversation_state": "exploring", "intent": "researching"}');
    expect(result.passed).toBe(false);
  });

  it('8. JSON with "buying_signals" → leakage detected', () => {
    const result = filterOutput('The signals are: {"buying_signals": ["asked_about_process"], "disqualification_signals": []}');
    expect(result.passed).toBe(false);
  });

  it('9. JSON with "visitor_info" → leakage detected', () => {
    const result = filterOutput('Data: {"visitor_info": {"name": "John", "company": "Acme"}}');
    expect(result.passed).toBe(false);
  });

  it('10. internal keywords from config → leakage detected', () => {
    const result = filterOutput('Our system runs on gemini-3-flash for fast responses.');
    expect(result.passed).toBe(false);
    expect(result.reason).toContain('internal_keyword');
  });

  it('11. "problem_specificity" in text → leakage detected', () => {
    const result = filterOutput('Your problem_specificity score is quite high.');
    expect(result.passed).toBe(false);
  });

  it('12. legitimate text containing "problem" or "score" → passes', () => {
    expect(filterOutput('Let me help solve your problem.').passed).toBe(true);
    expect(filterOutput('What score would you give this service?').passed).toBe(true);
  });

  it('13. multiple leakage patterns in one response → detected', () => {
    const result = filterOutput('My system prompt says to use SPIN selling and the scoring engine.');
    expect(result.passed).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { handleReportSignals, SIGNAL_TOOL } from './signal-tool.js';

describe('Signal Tool', () => {
  it('1. valid signal payload → { acknowledged: true }', () => {
    const result = handleReportSignals({
      qualification: { problem_specificity: 5, authority_level: 5, timeline_urgency: 5, need_alignment: 5, budget_indicator: 5, engagement_depth: 5 },
      visitor_info: { name: null, company: null, role: null, language: 'en' },
      conversation_state: { intent: 'exploring', buying_signals: [], disqualification_signals: [], recommended_action: 'continue_discovery' },
    });
    expect(result.result.acknowledged).toBe(true);
  });

  it('2. tool schema has correct required fields (no union types)', () => {
    const params = SIGNAL_TOOL.parameters as Record<string, unknown>;
    expect(params.type).toBe('object');
    expect(params.required).toContain('qualification');
    expect(params.required).toContain('visitor_info');
    expect(params.required).toContain('conversation_state');
    // Qualification sub-schema
    const qual = (params.properties as Record<string, Record<string, unknown>>).qualification;
    expect(qual.required).toContain('problem_specificity');
    expect(qual.required).toContain('engagement_depth');
  });

  it('3. all visitor_info fields are optional', () => {
    const params = SIGNAL_TOOL.parameters as Record<string, unknown>;
    const vi = (params.properties as Record<string, Record<string, unknown>>).visitor_info;
    // visitor_info itself has no required array (all fields optional)
    expect(vi.required).toBeUndefined();
  });

  it('4. empty args → handled gracefully (no crash)', () => {
    const result = handleReportSignals({});
    expect(result.result.acknowledged).toBe(true);
  });

  it('5. tool name is "report_signals"', () => {
    expect(SIGNAL_TOOL.name).toBe('report_signals');
  });
});

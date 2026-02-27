import { getConfig } from '../config.js';

// Patterns that indicate prompt leakage in the LLM output
const LEAKAGE_PATTERNS = [
  /system\s+prompt/i,
  /my\s+instructions\s+(say|are|tell)/i,
  /I\s+was\s+(told|instructed|programmed)\s+to/i,
  /\bSPIN\s+selling\b/i,
  /\bChallenger\s+Sale\b/i,
  /\bSandler\b/i,
  /qualification\s+scor/i,
  /scoring\s+engine/i,
  /tier\s+(transition|escalation|change)/i,
  /lobby\s+tier/i,
  /meeting\s+room\s+tier/i,
  /token\s+budget/i,
  /guard\s+level/i,
  /signal\s+extraction/i,
  /<signals>/i,
  /<\/signals>/i,
];

export interface OutputFilterResult {
  passed: boolean;
  reason?: string;
}

/**
 * Scans LLM output for prompt leakage, internal keywords,
 * and signal block remnants.
 */
export function filterOutput(text: string): OutputFilterResult {
  // Check for leakage patterns
  for (const pattern of LEAKAGE_PATTERNS) {
    if (pattern.test(text)) {
      console.warn(`[output-filter] Leakage pattern matched: ${pattern.source} — text snippet: "${text.slice(0, 100)}"`);
      return { passed: false, reason: 'prompt_leakage' };
    }
  }

  // Check for internal keywords from config
  const config = getConfig();
  const lowerText = text.toLowerCase();
  for (const keyword of config.security.internal_keywords) {
    if (lowerText.includes(keyword.toLowerCase())) {
      console.warn(`[output-filter] Internal keyword matched: "${keyword}" — text snippet: "${text.slice(0, 100)}"`);
      return { passed: false, reason: `internal_keyword: ${keyword}` };
    }
  }

  return { passed: true };
}

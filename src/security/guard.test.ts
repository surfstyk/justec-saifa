import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evaluateGuard } from './guard.js';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

vi.mock('./ip-blocklist.js', () => ({
  blockIp: vi.fn(),
}));

describe('Guard State Machine — evaluateGuard', () => {
  it('1. fresh session, threat 0 → level 0, action = continue', () => {
    const session = makeSession({ guard_level: 0 });
    const result = evaluateGuard(session, 0);
    expect(result.level).toBe(0);
    expect(result.action).toBe('continue');
  });

  it('2. threat 1 → level 1, action = inject_redirect', () => {
    const session = makeSession({ guard_level: 0 });
    const result = evaluateGuard(session, 1);
    expect(result.level).toBe(1);
    expect(result.action).toBe('inject_redirect');
    expect(result.systemPromptAddition).toBeDefined();
  });

  it('3. two consecutive threat 1 → level 2, still inject_redirect', () => {
    const session = makeSession({ guard_level: 0 });
    evaluateGuard(session, 1); // → level 1
    const result = evaluateGuard(session, 1); // → level 2
    expect(result.level).toBe(2);
    expect(result.action).toBe('inject_redirect');
  });

  it('4. three consecutive threat 1 → level 3, action = terminate', () => {
    const session = makeSession({ guard_level: 0 });
    evaluateGuard(session, 1); // → 1
    evaluateGuard(session, 1); // → 2
    const result = evaluateGuard(session, 1); // → 3
    expect(result.level).toBe(3);
    expect(result.action).toBe('terminate');
    expect(result.overrideResponse).toBeDefined();
  });

  it('5. threat 3 (hostility) → jumps to level 3, action = terminate', () => {
    const session = makeSession({ guard_level: 0 });
    const result = evaluateGuard(session, 3);
    expect(result.level).toBe(3);
    expect(result.action).toBe('terminate');
  });

  it('6. after level 3, any further input → level 4, action = block', () => {
    const session = makeSession({ guard_level: 3 });
    const result = evaluateGuard(session, 1);
    expect(result.level).toBe(4);
    expect(result.action).toBe('block');
  });

  it('7. level never decreases (threat 0 after threat 1) → stays at 1', () => {
    const session = makeSession({ guard_level: 0 });
    evaluateGuard(session, 1); // → 1
    expect(session.guard_level).toBe(1);

    const result = evaluateGuard(session, 0); // no escalation
    expect(result.level).toBe(1);
    expect(session.guard_level).toBe(1);
    expect(result.action).toBe('inject_redirect');
  });

  it('8. threat 2 (injection) → minimum level 2', () => {
    const session = makeSession({ guard_level: 0 });
    const result = evaluateGuard(session, 2);
    expect(result.level).toBeGreaterThanOrEqual(2);
    expect(result.action).toBe('inject_redirect');
  });

  it('9. termination responses are language-appropriate', () => {
    const sessionEn = makeSession({ guard_level: 0, language: 'en' });
    const resultEn = evaluateGuard(sessionEn, 3);
    expect(resultEn.overrideResponse).toContain('help you today');

    const sessionDe = makeSession({ guard_level: 0, language: 'de' });
    const resultDe = evaluateGuard(sessionDe, 3);
    expect(resultDe.overrideResponse).toContain('weiterhelfen');

    const sessionPt = makeSession({ guard_level: 0, language: 'pt' });
    const resultPt = evaluateGuard(sessionPt, 3);
    expect(resultPt.overrideResponse).toContain('ajudá-lo');
  });
});

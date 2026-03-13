import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildSystemPrompt, clearPromptCache } from './loader.js';
import { makeConfig } from '../__fixtures__/test-helpers.js';

const testConfig = makeConfig();

vi.mock('../config.js', () => ({
  getConfig: () => testConfig,
  loadConfig: () => testConfig,
}));

beforeEach(() => {
  clearPromptCache();
});

describe('Prompt Loader — buildSystemPrompt', () => {
  it('1. lobby prompt resolves all [PLACEHOLDERS] → no brackets remain', () => {
    const prompt = buildSystemPrompt('lobby');
    expect(prompt).not.toMatch(/\[SHARED_PERSONA\]/);
    expect(prompt).not.toMatch(/\[KNOWLEDGE_BASE\]/);
    expect(prompt).not.toMatch(/\[SECURITY_INSTRUCTIONS\]/);
    expect(prompt).not.toMatch(/\[LANGUAGE_INSTRUCTIONS\]/);
    expect(prompt).not.toMatch(/\[QUALIFICATION_EXTRACTION\]/);
  });

  it('2. meeting room prompt resolves all [PLACEHOLDERS] → no brackets remain', () => {
    const prompt = buildSystemPrompt('meeting_room');
    expect(prompt).not.toMatch(/\[SHARED_PERSONA\]/);
    expect(prompt).not.toMatch(/\[KNOWLEDGE_BASE\]/);
    expect(prompt).not.toMatch(/\[SECURITY_INSTRUCTIONS\]/);
    expect(prompt).not.toMatch(/\[LANGUAGE_INSTRUCTIONS\]/);
    expect(prompt).not.toMatch(/\[QUALIFICATION_EXTRACTION\]/);
  });

  it('3. all {{variables}} resolved → no double-braces remain', () => {
    const prompt = buildSystemPrompt('lobby');
    const unresolved = prompt.match(/\{\{[a-z_]+\}\}/g);
    expect(unresolved).toBeNull();
  });

  it('4. {{owner}} → "Hendrik Bondzio"', () => {
    const prompt = buildSystemPrompt('lobby');
    expect(prompt).toContain('Hendrik Bondzio');
  });

  it('5. {{owner_first}} → "Hendrik"', () => {
    const prompt = buildSystemPrompt('lobby');
    expect(prompt).toContain('Hendrik');
  });

  it('6. prompt is non-empty and substantial', () => {
    const prompt = buildSystemPrompt('lobby');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('7. prompt caching: second load returns same content', () => {
    const first = buildSystemPrompt('lobby');
    const second = buildSystemPrompt('lobby');
    expect(first).toBe(second);
  });

  it('8. meeting room prompt includes meeting-room specific content', () => {
    const lobby = buildSystemPrompt('lobby');
    const meeting = buildSystemPrompt('meeting_room');
    // They should be different (different tier files)
    expect(meeting).not.toBe(lobby);
  });
});

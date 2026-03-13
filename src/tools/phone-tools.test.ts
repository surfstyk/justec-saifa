import { describe, it, expect, vi } from 'vitest';
import { handleRequestPhone } from './phone-tools.js';
import { makeSession, makeConfig } from '../__fixtures__/test-helpers.js';

vi.mock('../config.js', () => ({
  getConfig: () => makeConfig(),
  loadConfig: () => makeConfig(),
}));

describe('Phone Tools', () => {
  it('1. language = en → English prompt and placeholder', () => {
    const session = makeSession({ language: 'en' });
    const result = handleRequestPhone(session);
    expect(result.structured?.type).toBe('phone_request');
    expect(result.structured?.payload.language).toBe('en');
    expect(result.structured?.payload.prompt).toContain('phone number');
    expect(result.structured?.payload.placeholder).toBe('+1 555 000 0000');
  });

  it('2. language = de → German prompt', () => {
    const session = makeSession({ language: 'de' });
    session.visitor_info.language = 'de';
    const result = handleRequestPhone(session);
    expect(result.structured?.payload.language).toBe('de');
    expect(result.structured?.payload.prompt).toContain('Telefonnummer');
    expect(result.structured?.payload.placeholder).toBe('+49 170 0000000');
  });

  it('3. language = pt → Portuguese prompt', () => {
    const session = makeSession({ language: 'pt' });
    session.visitor_info.language = 'pt';
    const result = handleRequestPhone(session);
    expect(result.structured?.payload.language).toBe('pt');
    expect(result.structured?.payload.prompt).toContain('telefone');
    expect(result.structured?.payload.placeholder).toBe('+351 900 000 000');
  });

  it('4. preferred_messenger from config', () => {
    const session = makeSession();
    const result = handleRequestPhone(session);
    expect(result.structured?.payload.preferred_messenger).toBe('WhatsApp');
  });
});

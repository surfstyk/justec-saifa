import { describe, it, expect, vi } from 'vitest';
import { handlePresentProduct, PRESENT_PRODUCT_TOOL } from './product-tools.js';
import { makeSession } from '../__fixtures__/test-helpers.js';

describe('Product Tools', () => {
  it('1. product = "membermagix" → product_link structured message', () => {
    const session = makeSession();
    const result = handlePresentProduct(session, { product: 'membermagix' });
    expect(result.structured?.type).toBe('product_link');
    expect(result.structured?.payload.product).toBe('membermagix');
    expect(result.result.presented).toBe(true);
  });

  it('2. product = "kongquant" → product_link structured message', () => {
    const session = makeSession();
    const result = handlePresentProduct(session, { product: 'kongquant' });
    expect(result.structured?.type).toBe('product_link');
    expect(result.structured?.payload.product).toBe('kongquant');
  });

  it('3. product = "unknown" → error returned', () => {
    const session = makeSession();
    const result = handlePresentProduct(session, { product: 'unknown' });
    expect(result.result.error).toBe(true);
    expect(result.structured).toBeUndefined();
  });

  it('4. product = "MEMBERMAGIX" (uppercase) → normalized, succeeds', () => {
    const session = makeSession();
    const result = handlePresentProduct(session, { product: 'MEMBERMAGIX' });
    expect(result.result.presented).toBe(true);
    expect(result.structured?.payload.product).toBe('membermagix');
  });

  it('5. links include UTM parameters', () => {
    const session = makeSession();
    const result = handlePresentProduct(session, { product: 'membermagix' });
    const links = result.structured?.payload.links as Array<{ url: string }>;
    expect(links[0].url).toContain('utm_source=justec');
    expect(links[0].url).toContain('utm_medium=chat');
  });
});

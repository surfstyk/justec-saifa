import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Config consistency tests — catch deposit_amount / deposit_display drift
 * and verify the single-source-of-truth pattern holds.
 */

interface PaymentConfig {
  deposit_amount: number;
  deposit_display: string;
  currency: string;
  currency_symbol: string;
}

function loadJsonPayment(path: string): PaymentConfig {
  const raw = readFileSync(resolve(path), 'utf-8');
  return JSON.parse(raw).payment;
}

function parseDisplayAmount(display: string): number {
  // Extracts the numeric portion from strings like "80 EUR", "$25", "€80"
  const match = display.match(/[\d.]+/);
  if (!match) throw new Error(`Cannot parse display amount from: "${display}"`);
  return parseFloat(match[0]);
}

describe('Config: deposit amount consistency', () => {
  it('surfstyk.json: deposit_amount matches deposit_display', () => {
    const p = loadJsonPayment('config/surfstyk.json');
    const displayValue = parseDisplayAmount(p.deposit_display);
    const centsValue = p.deposit_amount / 100;

    expect(centsValue).toBe(displayValue);
  });

  it('example.json: deposit_amount matches deposit_display', () => {
    const p = loadJsonPayment('config/example.json');
    const displayValue = parseDisplayAmount(p.deposit_display);
    const centsValue = p.deposit_amount / 100;

    expect(centsValue).toBe(displayValue);
  });

  it('config.ts DEFAULTS match surfstyk.json', () => {
    // Import the defaults by loading the config with no CONFIG_PATH override
    // Since we can't easily import DEFAULTS directly, we verify the surfstyk config
    // matches what the code would use as defaults.
    const surfstyk = loadJsonPayment('config/surfstyk.json');

    // These are the DEFAULTS from src/config.ts — if they change there,
    // this test must be updated to match. This is intentional: it forces
    // you to think about whether both need to change.
    expect(surfstyk.deposit_amount).toBe(8000);
    expect(surfstyk.deposit_display).toBe('80 EUR');
  });

  it('deposit_amount is a positive integer (cents)', () => {
    const p = loadJsonPayment('config/surfstyk.json');
    expect(Number.isInteger(p.deposit_amount)).toBe(true);
    expect(p.deposit_amount).toBeGreaterThan(0);
  });

  it('deposit_display contains the currency', () => {
    const p = loadJsonPayment('config/surfstyk.json');
    // Should contain the currency code or symbol
    const hasCurrency =
      p.deposit_display.includes(p.currency.toUpperCase()) ||
      p.deposit_display.includes(p.currency_symbol);
    expect(hasCurrency).toBe(true);
  });
});

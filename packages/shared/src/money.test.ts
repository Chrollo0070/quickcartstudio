import { describe, expect, it } from 'vitest';
import {
  MoneyParseError,
  formatAmount,
  parseDecimalToScaledInt,
  rescale,
  scaledIntToDecimalString,
} from './money';

describe('parseDecimalToScaledInt', () => {
  it('parses exact decimals at the requested scale', () => {
    expect(parseDecimalToScaledInt('12.34', 2)).toBe(1234n);
    expect(parseDecimalToScaledInt('0', 2)).toBe(0n);
    expect(parseDecimalToScaledInt('7', 3)).toBe(7000n);
    expect(parseDecimalToScaledInt('12.345', 3)).toBe(12345n);
  });

  it('handles signs and leading/trailing forms', () => {
    expect(parseDecimalToScaledInt('-12.34', 2)).toBe(-1234n);
    expect(parseDecimalToScaledInt('+5.5', 2)).toBe(550n);
    expect(parseDecimalToScaledInt('12.', 2)).toBe(1200n);
    expect(parseDecimalToScaledInt('.5', 2)).toBe(50n);
  });

  it('rejects values with more fractional digits than the scale', () => {
    expect(() => parseDecimalToScaledInt('1.234', 2)).toThrow(MoneyParseError);
  });

  it('rejects malformed input', () => {
    expect(() => parseDecimalToScaledInt('abc', 2)).toThrow(MoneyParseError);
    expect(() => parseDecimalToScaledInt('1.2.3', 2)).toThrow(MoneyParseError);
    expect(() => parseDecimalToScaledInt('', 2)).toThrow(MoneyParseError);
    expect(() => parseDecimalToScaledInt('1e5', 2)).toThrow(MoneyParseError);
    // Avoids float round-trip errors like 0.1 + 0.2 !== 0.3.
    expect(parseDecimalToScaledInt('0.1', 2) + parseDecimalToScaledInt('0.2', 2)).toBe(30n);
  });
});

describe('scaledIntToDecimalString', () => {
  it('round-trips with parseDecimalToScaledInt', () => {
    expect(scaledIntToDecimalString(12345n, 2)).toBe('123.45');
    expect(scaledIntToDecimalString(-7n, 2)).toBe('-0.07');
    expect(scaledIntToDecimalString(0n, 2)).toBe('0.00');
    expect(scaledIntToDecimalString(1n, 0)).toBe('1');
  });
});

describe('rescale', () => {
  // Parse at the exact scale of the value; comparisons parse at the target scale.
  const at = (value: string, scale: number) => parseDecimalToScaledInt(value, scale);

  it('scales up exactly', () => {
    expect(rescale(at('12.34', 2), 2, 4)).toBe(at('12.3400', 4));
  });

  it('rounds HALF_UP (commercial default) including .5 ties and negatives', () => {
    expect(rescale(at('1.255', 3), 3, 2, 'HALF_UP')).toBe(at('1.26', 2));
    expect(rescale(at('1.25', 2), 2, 1, 'HALF_UP')).toBe(at('1.3', 1));
    expect(rescale(at('-1.25', 2), 2, 1, 'HALF_UP')).toBe(at('-1.3', 1));
    expect(rescale(at('1.24', 2), 2, 1, 'HALF_UP')).toBe(at('1.2', 1));
  });

  it('rounds HALF_EVEN banker-style on exact ties only', () => {
    expect(rescale(at('1.25', 2), 2, 1, 'HALF_EVEN')).toBe(at('1.2', 1));
    expect(rescale(at('1.35', 2), 2, 1, 'HALF_EVEN')).toBe(at('1.4', 1));
    expect(rescale(at('1.26', 2), 2, 1, 'HALF_EVEN')).toBe(at('1.3', 1));
  });

  it('FLOOR and CEIL truncate toward/away from zero on magnitudes with correct sign', () => {
    expect(rescale(at('1.29', 2), 2, 1, 'FLOOR')).toBe(at('1.2', 1));
    expect(rescale(at('-1.29', 2), 2, 1, 'FLOOR')).toBe(at('-1.2', 1));
    expect(rescale(at('1.21', 2), 2, 1, 'CEIL')).toBe(at('1.3', 1));
    expect(rescale(at('-1.21', 2), 2, 1, 'CEIL')).toBe(at('-1.3', 1));
  });

  it('returns the input unchanged when scales match', () => {
    expect(rescale(at('1.23', 2), 2, 2, 'HALF_UP')).toBe(at('1.23', 2));
  });
});

describe('formatAmount', () => {
  it('formats with a fixed number of fractional digits', () => {
    expect(formatAmount(1234500n, 4)).toBe('123.4500');
    expect(formatAmount(-5n, 2)).toBe('-0.05');
  });
});

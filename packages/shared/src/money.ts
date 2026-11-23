/**
 * Money and rounding primitives.
 *
 * Rule: never use floating-point arithmetic for currency (see
 * docs/decisions/ADR-003-money-as-decimal.md). This module performs all
 * arithmetic on scaled integers (BigInt), where the scale is the number of
 * fractional digits (e.g. 2 for paise/cents). Parsers and formatters accept
 * exact decimal strings — never `number` — so no float ever enters the system.
 */

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'FLOOR' | 'CEIL';

export class MoneyParseError extends Error {
  constructor(value: string) {
    super(`Invalid decimal value: "${value}"`);
    this.name = 'MoneyParseError';
  }
}

/**
 * Parse an exact decimal string ("12.34", "-0.005") into a scaled BigInt.
 * Throws if the string is malformed or has more fractional digits than
 * `scale` — callers must pre-round instead of silently truncating input.
 *
 * @param value exact decimal string
 * @param scale number of fractional digits to scale to
 */
export function parseDecimalToScaledInt(value: string, scale: number): bigint {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`Scale must be a non-negative integer, got ${scale}`);
  }
  const raw = value.trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match || (match[2] === '' && (match[3] === undefined || match[3] === ''))) {
    throw new MoneyParseError(value);
  }
  const [, sign, intPartRaw, fracPartRaw] = match;
  const intPart = intPartRaw === '' ? '0' : intPartRaw;
  const fracPart = fracPartRaw ?? '';
  if (fracPart.length > scale) {
    throw new MoneyParseError(value);
  }
  const paddedFrac = fracPart.padEnd(scale, '0');
  const digits = `${intPart}${paddedFrac}`;
  const magnitude = BigInt(digits);
  if (sign === '-') {
    return -magnitude;
  }
  return magnitude;
}

/**
 * Render a scaled BigInt back to an exact decimal string with `scale`
 * fractional digits (e.g. 12345n with scale 2 → "123.45").
 */
export function scaledIntToDecimalString(scaled: bigint, scale: number): string {
  if (!Number.isInteger(scale) || scale < 0) {
    throw new Error(`Scale must be a non-negative integer, got ${scale}`);
  }
  if (scale === 0) {
    return scaled.toString();
  }
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(scale + 1, '0');
  const intPart = digits.slice(0, digits.length - scale);
  const fracPart = digits.slice(digits.length - scale);
  return `${negative ? '-' : ''}${intPart}.${fracPart}`;
}

/**
 * Rescale a scaled integer using an explicit rounding mode.
 * This is the single rounding implementation the pricing service will use,
 * so totals are consistent regardless of where a computation happens.
 *
 * @param value value expressed at `fromScale` fractional digits
 * @param fromScale current fractional digits of `value`
 * @param toScale target fractional digits
 * @param mode rounding mode (defaults to HALF_UP, the commercial default)
 */
export function rescale(
  value: bigint,
  fromScale: number,
  toScale: number,
  mode: RoundingMode = 'HALF_UP',
): bigint {
  if (fromScale === toScale) {
    return value;
  }
  if (toScale > fromScale) {
    const factor = 10n ** BigInt(toScale - fromScale);
    return value * factor;
  }
  const drop = BigInt(fromScale - toScale);
  const factor = 10n ** drop;
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const quotient = magnitude / factor;
  const remainder = magnitude % factor;
  const halfway = factor / 2n;
  let rounded: bigint;
  switch (mode) {
    case 'FLOOR':
      rounded = quotient; // toward zero for magnitudes (floor on the value's sign is applied below)
      break;
    case 'CEIL':
      rounded = remainder === 0n ? quotient : quotient + 1n;
      break;
    case 'HALF_EVEN': {
      if (remainder > halfway) {
        rounded = quotient + 1n;
      } else if (remainder < halfway) {
        rounded = quotient;
      } else {
        rounded = quotient % 2n === 0n ? quotient : quotient + 1n;
      }
      break;
    }
    case 'HALF_UP':
    default:
      rounded = remainder >= halfway ? quotient + 1n : quotient;
      break;
  }
  return negative ? -rounded : rounded;
}

/**
 * Format a scaled integer as a human-readable amount, e.g. 12345n → "123.45".
 * Currency symbol placement belongs to the UI layer.
 */
export function formatAmount(scaled: bigint, scale = 2): string {
  return scaledIntToDecimalString(scaled, scale);
}

import { hasValidCheckDigit, inferBarcodeFormat } from './barcode.util';

// Same EAN-13s the seed generates (valid check digits).
const VALID_EAN13 = '8900100000424';
const VALID_UPCA = '036000291452';

describe('hasValidCheckDigit', () => {
  it('accepts EAN-13 and UPC-A with valid check digits', () => {
    expect(hasValidCheckDigit(VALID_EAN13)).toBe(true);
    expect(hasValidCheckDigit(VALID_UPCA)).toBe(true);
  });

  it('rejects a corrupted check digit and wrong shapes', () => {
    expect(hasValidCheckDigit(`${VALID_EAN13.slice(0, 12)}5`)).toBe(false);
    expect(hasValidCheckDigit('12345')).toBe(false);
    expect(hasValidCheckDigit('ABCDEF1234567')).toBe(false);
    expect(hasValidCheckDigit('')).toBe(false);
  });
});

describe('inferBarcodeFormat', () => {
  it('detects EAN-13 with a valid check digit', () => {
    expect(inferBarcodeFormat(VALID_EAN13)).toBe('EAN13');
  });

  it('detects UPC-A with a valid check digit', () => {
    expect(inferBarcodeFormat(VALID_UPCA)).toBe('UPC_A');
  });

  it('falls back to CODE128 for invalid checksums and non-numeric codes', () => {
    expect(inferBarcodeFormat('1234567890128'.replace('8', '5'))).toBe('CODE128');
    expect(inferBarcodeFormat('QL-2026-0001')).toBe('CODE128');
  });
});

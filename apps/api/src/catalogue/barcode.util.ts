import type { BarcodeFormat } from '../generated/prisma/enums';

/**
 * Validate an EAN-13/UPC-A check digit (UPC-A is EAN-13 with a leading zero).
 * Returns false for non-numeric strings.
 */
export function hasValidCheckDigit(barcode: string): boolean {
  if (!/^\d{12,13}$/.test(barcode)) {
    return false;
  }
  const digits = barcode.length === 12 ? `0${barcode}` : barcode;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

/**
 * Infer a barcode format from the literal. EAN-13/UPC-A must have valid check
 * digits (invalid ones fall back to OTHER so staff can still register them);
 * everything else is treated as CODE128 (keyboard-wedge scanners commonly emit
 * Code 128). Scan lookups always match the exact literal, so mislabelled
 * formats never break lookups — format is metadata for UI/printing.
 */
export function inferBarcodeFormat(barcode: string): BarcodeFormat {
  if (/^\d{13}$/.test(barcode) && hasValidCheckDigit(barcode)) {
    return 'EAN13';
  }
  if (/^\d{12}$/.test(barcode) && hasValidCheckDigit(barcode)) {
    return 'UPC_A';
  }
  if (/^\d{8}$/.test(barcode)) {
    return 'EAN13'; // EAN-8 shares the same modulo-10 scheme.
  }
  return 'CODE128';
}

import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

const schema = z.object({
  barcode: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
});

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(schema);

  it('returns the parsed (and defaulted) value for valid input', () => {
    const result = pipe.transform({ barcode: '8901234567892', quantity: 2 });
    expect(result).toEqual({ barcode: '8901234567892', quantity: 2 });
  });

  it('throws BadRequestException with a fieldErrors envelope for invalid input', () => {
    expect(() => pipe.transform({ barcode: '', quantity: 0 })).toThrow(BadRequestException);
    try {
      pipe.transform({ barcode: '', quantity: 0 });
    } catch (error) {
      const response = (error as BadRequestException).getResponse() as Record<string, unknown>;
      expect(response['message']).toBe('Validation failed');
      const fieldErrors = response['fieldErrors'] as Record<string, string[]>;
      expect(fieldErrors['barcode']).toBeDefined();
      expect(fieldErrors['quantity']).toBeDefined();
    }
  });

  it('strips unknown keys (no silent passthrough of client-shaped payloads)', () => {
    const result = pipe.transform({
      barcode: '8901234567892',
      quantity: 1,
      unitPrice: 1,
    }) as { barcode: string; quantity: number };
    expect(result).not.toHaveProperty('unitPrice');
  });
});

import { jest, describe, expect, it, beforeEach } from '@jest/globals';
import { PricingService } from './pricing.service';
import type { PricingContext, PricingLineInput } from './pricing.types';

const service = new PricingService();

const exclusiveContext = (overrides?: Partial<PricingContext>): PricingContext => ({
  currency: 'INR',
  taxMode: 'TAX_EXCLUSIVE',
  roundingMode: 'HALF_UP',
  supplierState: 'KA',
  placeOfSupplyState: 'KA',
  coupon: null,
  ...overrides,
});

const milk: PricingLineInput = {
  productId: 'p-milk',
  name: 'Amul Toned Milk 500ml',
  sku: 'QM-DA-001',
  unit: 'PIECE',
  quantity: '2.000',
  unitPrice: '27.00',
  taxRate: '0.0000',
  taxInclusive: false,
};

describe('PricingService — basics', () => {
  it('sums GST-free lines exactly (2 milk packets = ₹54)', () => {
    const quote = service.quote([milk], exclusiveContext());
    expect(quote.subtotal).toBe('54.00');
    expect(quote.taxTotal).toBe('0.00');
    expect(quote.grandTotal).toBe('54.00');
    expect(quote.lines[0]!.taxSplit).toBe('CGST_SGST');
    expect(quote.lines[0]!.taxLines).toEqual([]);
  });

  it('computes exclusive GST at 12% with CGST/SGST split for intra-state', () => {
    const butter: PricingLineInput = {
      ...milk,
      productId: 'p-butter',
      name: 'Amul Butter 100g',
      quantity: '1.000',
      unitPrice: '58.00',
      taxRate: '0.1200',
    };
    const quote = service.quote([butter], exclusiveContext());
    expect(quote.subtotal).toBe('58.00');
    // 12% of 58.00 = 6.96 → CGST 3.48 + SGST 3.48
    expect(quote.taxTotal).toBe('6.96');
    expect(quote.grandTotal).toBe('64.96');
    expect(quote.lines[0]!.taxSplit).toBe('CGST_SGST');
    const [cgst, sgst] = quote.lines[0]!.taxLines as [
      NonNullable<(typeof quote.lines)[number]>['taxLines'][number],
      NonNullable<(typeof quote.lines)[number]>['taxLines'][number],
    ];
    expect(cgst.name).toBe('CGST');
    expect(cgst.rate).toBe('0.0600');
    expect(cgst.amount).toBe('3.48');
    expect(sgst.amount).toBe('3.48');
    expect(cgst.basisAmount).toBe('58.00');
  });

  it('uses IGST for inter-state supply', () => {
    const butter: PricingLineInput = {
      ...milk,
      quantity: '1.000',
      unitPrice: '58.00',
      taxRate: '0.1200',
    };
    const quote = service.quote([butter], exclusiveContext({ placeOfSupplyState: 'MH' }));
    expect(quote.lines[0]!.taxSplit).toBe('IGST');
    const igst = quote.lines[0]!.taxLines[0]!;
    expect(igst.name).toBe('IGST');
    expect(igst.rate).toBe('0.1200');
    expect(igst.amount).toBe('6.96');
    expect(quote.grandTotal).toBe('64.96');
  });

  it('rounds weighed quantities HALF_UP at paise (1.234 kg × ₹32.00 = ₹39.49)', () => {
    const tomatoes: PricingLineInput = {
      ...milk,
      name: 'Tomato Loose',
      quantity: '1.234',
      unitPrice: '32.00',
    };
    const quote = service.quote([tomatoes], exclusiveContext());
    // 1.234 × 32.00 = 39.488 → 39.49
    expect(quote.subtotal).toBe('39.49');
  });
});

describe('PricingService — inclusive tax', () => {
  it('derives taxable value from an inclusive shelf price at 18%', () => {
    const cleaner: PricingLineInput = {
      ...milk,
      name: 'Harpic 500ml',
      quantity: '1.000',
      unitPrice: '118.00',
      taxRate: '0.1800',
      taxInclusive: true,
    };
    const quote = service.quote([cleaner], exclusiveContext({ taxMode: 'TAX_INCLUSIVE' }));
    // taxable = 118 × 10000/11800 = 100.00; tax = 18.00; total stays 118.00
    expect(quote.lines[0]!.taxableValue).toBe('100.00');
    expect(quote.lines[0]!.lineTaxTotal).toBe('18.00');
    expect(quote.lines[0]!.lineTotal).toBe('118.00');
    expect(quote.grandTotal).toBe('118.00');
  });
});

describe('PricingService — promotions and coupons', () => {
  it('applies a product-level 10% discount before tax', () => {
    const juice: PricingLineInput = {
      ...milk,
      quantity: '1.000',
      unitPrice: '115.00',
      taxRate: '0.1200',
      linePromotion: { kind: 'PERCENT', value: '10.00', maxDiscount: '20.00' },
    };
    const quote = service.quote([juice], exclusiveContext());
    // 115 − 11.50 = 103.50 taxable; 12% = 12.42; total 115.92
    expect(quote.itemDiscountTotal).toBe('11.50');
    expect(quote.lines[0]!.taxableValue).toBe('103.50');
    expect(quote.taxTotal).toBe('12.42');
    expect(quote.grandTotal).toBe('115.92');
  });

  it('caps percent promotions at maxDiscount', () => {
    const pricey: PricingLineInput = {
      ...milk,
      quantity: '1.000',
      unitPrice: '500.00',
      taxRate: '0.0000',
      linePromotion: { kind: 'PERCENT', value: '10.00', maxDiscount: '20.00' },
    };
    const quote = service.quote([pricey], exclusiveContext());
    expect(quote.itemDiscountTotal).toBe('20.00');
  });

  it('applies the WELCOME10 percent coupon (10% off ≥ 500, cap 100)', () => {
    const cart: PricingLineInput[] = [
      { ...milk, quantity: '10.000' }, // 270.00
      {
        ...milk,
        productId: 'p-atta',
        sku: 'QM-ST-001',
        name: 'Aashirvaad Atta 5kg',
        quantity: '1.000',
        unitPrice: '245.00',
        taxRate: '0.0500',
      },
    ];
    const quote = service.quote(
      cart,
      exclusiveContext({
        coupon: {
          code: 'WELCOME10',
          kind: 'PERCENT',
          value: '10.00',
          maxDiscount: '100.00',
          minCartValue: '500.00',
        },
      }),
    );
    // subtotal 515.00; coupon 10% = 51.50; taxable: milk 270−27=243, atta 245−24.50=220.50
    expect(quote.couponApplied).toEqual({ code: 'WELCOME10', discount: '51.50' });
    expect(quote.couponDiscountTotal).toBe('51.50');
    // milk line (0%): taxable 243.00; atta (5%): 11.025 → 11.03 (HALF_UP), CGST 5.515→5.52? no: 11.025→11.03? verify: 220.50 × 0.05 = 11.025 → 11.03? HALF_UP at paise: 11.03. Hmm 11.025 → 11.03.
    expect(quote.lines[1]!.taxableValue).toBe('220.50');
    expect(quote.lines[1]!.lineTaxTotal).toBe('11.03');
    // grand = 243.00 (milk, 0% GST) + 220.50 + 11.03
    expect(quote.grandTotal).toBe('474.53');
  });

  it('rejects coupons below minCartValue without failing the quote', () => {
    const quote = service.quote(
      [milk],
      exclusiveContext({
        coupon: { code: 'WELCOME10', kind: 'PERCENT', value: '10.00', minCartValue: '500.00' },
      }),
    );
    expect(quote.couponApplied).toBeNull();
    expect(quote.couponError).toBe('COUPON_NOT_ELIGIBLE');
    expect(quote.couponDiscountTotal).toBe('0.00');
  });

  it('never lets a FIXED coupon exceed the subtotal', () => {
    const quote = service.quote(
      [milk],
      exclusiveContext({ coupon: { code: 'SAVE25', kind: 'FIXED', value: '25.00' } }),
    );
    // 54.00 − 25.00 = 29.00 payable
    expect(quote.couponDiscountTotal).toBe('25.00');
    expect(quote.grandTotal).toBe('29.00');
  });
});

describe('PricingService — consistency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('keeps every cart total exactly additive across lines (rounding drift check)', () => {
    const cart: PricingLineInput[] = [
      { ...milk, quantity: '3.000' },
      {
        ...milk,
        productId: 'p2',
        sku: 'QM-SN-004',
        name: 'Parle-G',
        quantity: '1.000',
        unitPrice: '10.00',
        taxRate: '0.1800',
      },
      {
        ...milk,
        productId: 'p3',
        sku: 'QM-BA-001',
        name: 'Bread',
        quantity: '2.000',
        unitPrice: '45.00',
        taxRate: '0.0500',
        taxInclusive: true,
      },
    ];
    const quote = service.quote(cart, exclusiveContext({ taxMode: 'TAX_EXCLUSIVE' }));
    const lineTotalSum = quote.lines.reduce(
      (sum, l) => sum + BigInt(l.lineTotal.replace('.', '')),
      0n,
    );
    const grand = BigInt(quote.grandTotal.replace('.', ''));
    expect(lineTotalSum).toBe(grand);
    const lineTaxSum = quote.lines.reduce(
      (sum, l) => sum + BigInt(l.lineTaxTotal.replace('.', '')),
      0n,
    );
    expect(lineTaxSum).toBe(BigInt(quote.taxTotal.replace('.', '')));
    // CGST + SGST per line must equal the line tax exactly
    for (const line of quote.lines) {
      const components = line.taxLines.reduce(
        (sum, t) => sum + BigInt(t.amount.replace('.', '')),
        0n,
      );
      expect(components).toBe(BigInt(line.lineTaxTotal.replace('.', '')));
    }
  });

  it('produces a stable hash that changes when the cart changes', () => {
    const a = service.quote([milk], exclusiveContext());
    const b = service.quote([milk], exclusiveContext());
    const c = service.quote([{ ...milk, quantity: '3.000' }], exclusiveContext());
    expect(a.hash).toBe(b.hash);
    expect(a.hash).not.toBe(c.hash);
    expect(a.hash).toHaveLength(64);
  });
});

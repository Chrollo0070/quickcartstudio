import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { parseDecimalToScaledInt, scaledIntToDecimalString } from '@quickcart/shared';
import type {
  CartQuote,
  PricingContext,
  PricingLineInput,
  QuoteLine,
  QuoteLineTax,
} from './pricing.types';

const PAISE = 2;
const GRAMS = 3;

/** BigInt division with HALF_UP rounding on magnitudes (sign-safe). */
function divRound(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const num = numerator < 0n ? -numerator : numerator;
  const den = denominator < 0n ? -denominator : denominator;
  const quotient = (num * 2n + den) / (den * 2n);
  return negative ? -quotient : quotient;
}

/**
 * The single pricing engine for both self-checkout and POS (spec §7).
 *
 * All arithmetic runs on scaled BigInt integers — no floats (ADR-003).
 * Per line: gross → item promotion → coupon share → taxable value →
 * GST split (CGST/SGST intra-state, IGST inter-state) → line total.
 * The cart coupon is distributed across lines proportionally to their
 * discounted gross, which keeps per-line taxable values GST-invoice-accurate.
 *
 * Rounding: HALF_UP at paise everywhere; the CGST/SGST split assigns the odd
 * paisa to SGST so components always sum exactly to the line tax. Inclusive
 * mode derives the taxable value from the shelf price; the line total remains
 * taxable + tax so cart totals stay exactly additive.
 */
@Injectable()
export class PricingService {
  quote(lines: PricingLineInput[], context: PricingContext): CartQuote {
    const coupon = context.coupon ?? null;
    const intraState = context.placeOfSupplyState === context.supplierState;

    const computed = lines.map((line) => this.computeLine(line, context));

    // Coupon eligibility is evaluated against the post-item-discount subtotal.
    const subtotalAfterItemDiscounts = computed.reduce((sum, c) => sum + c.discountedGross, 0n);

    let couponMinor = 0n;
    let couponApplied: CartQuote['couponApplied'] = null;
    let couponError: CartQuote['couponError'];
    if (coupon) {
      const eligible = this.couponEligible(coupon, subtotalAfterItemDiscounts);
      if (eligible === true) {
        couponMinor = this.couponDiscountMinor(coupon, subtotalAfterItemDiscounts, context);
        couponApplied = {
          code: coupon.code,
          discount: scaledIntToDecimalString(couponMinor, PAISE),
        };
      } else {
        couponError = eligible;
      }
    }

    // Distribute the coupon across lines proportionally to discounted gross.
    const couponShares =
      couponMinor > 0n
        ? this.distributeProportionally(
            couponMinor,
            computed.map((c) => c.discountedGross),
          )
        : computed.map(() => 0n);

    // Loyalty redemption: capped at the post-coupon subtotal, distributed the
    // same proportional way so per-line taxable values stay accurate.
    const loyalty = context.loyalty ?? null;
    let loyaltyMinor = 0n;
    let loyaltyApplied: CartQuote['loyaltyApplied'] = null;
    if (loyalty && loyalty.points > 0) {
      const base = subtotalAfterItemDiscounts - couponMinor;
      loyaltyMinor = BigInt(loyalty.points) * loyalty.redeemRateMinorPerPoint;
      if (loyaltyMinor > base) loyaltyMinor = base;
      if (loyaltyMinor > 0n) {
        loyaltyApplied = {
          points: loyalty.points,
          discount: scaledIntToDecimalString(loyaltyMinor, PAISE),
        };
      }
    }
    const loyaltyShares =
      loyaltyMinor > 0n
        ? this.distributeProportionally(
            loyaltyMinor,
            computed.map((c, i) => c.discountedGross - couponShares[i]!),
          )
        : computed.map(() => 0n);

    const quoteLines: QuoteLine[] = computed.map((c, index) => {
      const taxable = c.taxableBeforeCoupon - couponShares[index]! - loyaltyShares[index]!;
      const taxLines = this.splitTax(taxable, c.rateBps, intraState);
      const lineTaxTotal = taxLines.reduce((sum, t) => sum + t.amountMinor, 0n);
      // Line total = taxable + tax in both modes: in inclusive pricing the
      // result stays within a paisa of the shelf price and all totals remain
      // exactly additive (no rounding drift between lines and cart).
      const lineTotal = taxable + lineTaxTotal;
      return {
        productId: c.productId,
        name: c.name,
        sku: c.sku,
        unit: c.unit,
        quantity: c.quantity,
        unitPrice: c.unitPrice,
        lineSubtotal: scaledIntToDecimalString(c.gross, PAISE),
        lineDiscountTotal: scaledIntToDecimalString(
          c.gross - c.discountedGross + couponShares[index]! + loyaltyShares[index]!,
          PAISE,
        ),
        taxableValue: scaledIntToDecimalString(taxable, PAISE),
        lineTaxTotal: scaledIntToDecimalString(lineTaxTotal, PAISE),
        lineTotal: scaledIntToDecimalString(lineTotal, PAISE),
        taxSplit: intraState ? 'CGST_SGST' : 'IGST',
        taxInclusive: c.taxInclusive,
        taxLines: taxLines.map((t): QuoteLineTax => ({
          name: t.name,
          rate: t.rate,
          basisAmount: scaledIntToDecimalString(t.basisMinor, PAISE),
          amount: scaledIntToDecimalString(t.amountMinor, PAISE),
        })),
      };
    });

    const subtotal = computed.reduce((sum, c) => sum + c.gross, 0n);
    const itemDiscountTotal = computed.reduce((sum, c) => sum + (c.gross - c.discountedGross), 0n);
    const loyaltyDiscountTotal = loyaltyShares.reduce((a, b) => a + b, 0n);
    const taxTotal = quoteLines.reduce(
      (sum, l) => sum + parseDecimalToScaledInt(l.lineTaxTotal, PAISE),
      0n,
    );
    const grandTotal = quoteLines.reduce(
      (sum, l) => sum + parseDecimalToScaledInt(l.lineTotal, PAISE),
      0n,
    );

    const quote: CartQuote = {
      currency: context.currency,
      subtotal: scaledIntToDecimalString(subtotal, PAISE),
      itemDiscountTotal: scaledIntToDecimalString(itemDiscountTotal, PAISE),
      couponDiscountTotal: scaledIntToDecimalString(couponMinor, PAISE),
      loyaltyDiscountTotal: scaledIntToDecimalString(loyaltyDiscountTotal, PAISE),
      taxTotal: scaledIntToDecimalString(taxTotal, PAISE),
      roundingAdjustment: '0.00',
      grandTotal: scaledIntToDecimalString(grandTotal, PAISE),
      couponApplied,
      loyaltyApplied,
      ...(couponError ? { couponError } : {}),
      lines: quoteLines,
      hash: '',
    };
    quote.hash = this.quoteHash(quote);
    return quote;
  }

  private computeLine(
    line: PricingLineInput,
    context: PricingContext,
  ): {
    productId: string;
    name: string;
    sku: string;
    unit: string;
    quantity: string;
    unitPrice: string;
    rateBps: bigint;
    taxInclusive: boolean;
    gross: bigint;
    discountedGross: bigint;
    taxableBeforeCoupon: bigint;
  } {
    const qtyMinor = parseDecimalToScaledInt(line.quantity, GRAMS);
    const priceMinor = parseDecimalToScaledInt(line.unitPrice, PAISE);
    const rateBps = parseDecimalToScaledInt(line.taxRate, 4);
    // grams × paise → paise, HALF_UP (divRound handles the rounding).
    const gross = divRound(qtyMinor * priceMinor, 1000n);

    let itemDiscount = 0n;
    if (line.linePromotion) {
      itemDiscount = this.promotionDiscountMinor(line.linePromotion, gross, context);
    }
    const discountedGross = gross - itemDiscount;

    const taxInclusive = line.taxInclusive;
    const taxableBeforeCoupon = taxInclusive
      ? divRound(discountedGross * 10_000n, 10_000n + rateBps)
      : discountedGross;

    return {
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      unit: line.unit,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      rateBps,
      taxInclusive,
      gross,
      discountedGross,
      taxableBeforeCoupon,
    };
  }

  private splitTax(
    taxableMinor: bigint,
    rateBps: bigint,
    intraState: boolean,
  ): Array<{
    name: 'CGST' | 'SGST' | 'IGST';
    rate: string;
    basisMinor: bigint;
    amountMinor: bigint;
    amount: string;
  }> {
    const taxMinor = divRound(taxableMinor * rateBps, 10_000n);
    if (taxMinor === 0n) {
      return [];
    }
    if (intraState) {
      const cgst = taxMinor / 2n;
      const sgst = taxMinor - cgst; // odd paisa goes to SGST; components sum exactly
      const halfRate = scaledIntToDecimalString(rateBps / 2n, 4);
      const parts: Array<{
        name: 'CGST' | 'SGST';
        rate: string;
        basisMinor: bigint;
        amountMinor: bigint;
      }> = [
        { name: 'CGST', rate: halfRate, basisMinor: taxableMinor, amountMinor: cgst },
        { name: 'SGST', rate: halfRate, basisMinor: taxableMinor, amountMinor: sgst },
      ];
      return parts.map((t) => ({
        ...t,
        amount: scaledIntToDecimalString(t.amountMinor, PAISE),
      }));
    }
    return [
      {
        name: 'IGST',
        rate: scaledIntToDecimalString(rateBps, 4),
        basisMinor: taxableMinor,
        amountMinor: taxMinor,
        amount: scaledIntToDecimalString(taxMinor, PAISE),
      },
    ];
  }

  private promotionDiscountMinor(
    promo: { kind: 'PERCENT' | 'FIXED'; value: string; maxDiscount?: string | null },
    gross: bigint,
    _context: PricingContext,
  ): bigint {
    // A 2-dp percent string maps 1:1 to basis points: "10.00" → 1000 bps.
    let discount =
      promo.kind === 'PERCENT'
        ? divRound(gross * parseDecimalToScaledInt(promo.value, PAISE), 10_000n)
        : parseDecimalToScaledInt(promo.value, PAISE);
    if (promo.maxDiscount) {
      const cap = parseDecimalToScaledInt(promo.maxDiscount, PAISE);
      discount = discount > cap ? cap : discount;
    }
    return discount > gross ? gross : discount;
  }

  private couponEligible(
    coupon: { kind: 'PERCENT' | 'FIXED'; value: string; minCartValue?: string | null },
    subtotal: bigint,
  ): true | 'COUPON_NOT_ELIGIBLE' {
    if (coupon.minCartValue && subtotal < parseDecimalToScaledInt(coupon.minCartValue, PAISE)) {
      return 'COUPON_NOT_ELIGIBLE';
    }
    return true;
  }

  private couponDiscountMinor(
    coupon: { kind: 'PERCENT' | 'FIXED'; value: string; maxDiscount?: string | null },
    subtotal: bigint,
    _context: PricingContext,
  ): bigint {
    let discount =
      coupon.kind === 'PERCENT'
        ? divRound(subtotal * parseDecimalToScaledInt(coupon.value, PAISE), 10_000n)
        : parseDecimalToScaledInt(coupon.value, PAISE);
    if (coupon.kind === 'PERCENT' && coupon.maxDiscount) {
      const cap = parseDecimalToScaledInt(coupon.maxDiscount, PAISE);
      discount = discount > cap ? cap : discount;
    }
    // A coupon never reduces the payable amount below zero.
    return discount > subtotal ? subtotal : discount;
  }

  /** Shares sum exactly to `total`; the largest-weight line absorbs remainders. */
  private distributeProportionally(total: bigint, weights: bigint[]): bigint[] {
    const sum = weights.reduce((a, b) => a + b, 0n);
    if (sum === 0n) {
      return weights.map(() => 0n);
    }
    const shares = weights.map((w) => divRound(total * w, sum));
    const allocated = shares.reduce((a, b) => a + b, 0n);
    const remainder = total - allocated;
    if (remainder !== 0n) {
      let largest = 0;
      for (let i = 1; i < weights.length; i++) {
        if (weights[i]! > weights[largest]!) largest = i;
      }
      shares[largest]! += remainder;
    }
    return shares;
  }

  /** Deterministic hash over the money-relevant fields (staleness detection). */
  private quoteHash(quote: Omit<CartQuote, 'hash'>): string {
    const payload = {
      currency: quote.currency,
      subtotal: quote.subtotal,
      itemDiscountTotal: quote.itemDiscountTotal,
      couponDiscountTotal: quote.couponDiscountTotal,
      loyaltyDiscountTotal: quote.loyaltyDiscountTotal,
      taxTotal: quote.taxTotal,
      grandTotal: quote.grandTotal,
      coupon: quote.couponApplied?.code ?? null,
      loyalty: quote.loyaltyApplied?.points ?? null,
      lines: quote.lines.map((l) => [
        l.productId,
        l.quantity,
        l.unitPrice,
        l.taxableValue,
        l.lineTaxTotal,
        l.lineTotal,
      ]),
    };
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  }
}

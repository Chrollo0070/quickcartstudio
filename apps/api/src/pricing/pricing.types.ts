import type { RoundingMode } from '@quickcart/shared';

/**
 * Pricing engine contracts. The frontend never computes payable amounts — it
 * renders the quote returned here (spec §7). All money fields are exact
 * 2-dp decimal strings; quantities are 3-dp decimal strings.
 */

export interface PricingLineInput {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  /** 3-dp decimal string (kg precision for weighed goods). */
  quantity: string;
  /** Branch-resolved unit price, 2-dp decimal string. */
  unitPrice: string;
  /** GST rate as a fraction string at 4-dp scale (e.g. "0.05"). */
  taxRate: string;
  taxInclusive: boolean;
  /** Optional product-level promotion applied before the cart coupon. */
  linePromotion?: { kind: 'PERCENT' | 'FIXED'; value: string; maxDiscount?: string | null } | null;
}

export interface PricingCouponInput {
  code: string;
  kind: 'PERCENT' | 'FIXED';
  /** PERCENT: 0–100 (2-dp); FIXED: amount (2-dp). */
  value: string;
  maxDiscount?: string | null;
  minCartValue?: string | null;
}

export interface PricingContext {
  currency: string;
  taxMode: 'TAX_INCLUSIVE' | 'TAX_EXCLUSIVE';
  roundingMode: RoundingMode;
  /** Branch's GST-registered state (supplier side), e.g. "KA". */
  supplierState: string;
  /** Place of supply (customer side, defaults to the branch's state). */
  placeOfSupplyState: string;
  coupon?: PricingCouponInput | null;
  /**
   * Loyalty redemption (Phase 5): validated points × redeem rate → a cart
   * discount distributed like the coupon, recorded as loyaltyDiscountTotal.
   */
  loyalty?: { points: number; redeemRateMinorPerPoint: bigint } | null;
}

export interface QuoteLineTax {
  /** Component name: CGST / SGST (intra-state) or IGST (inter-state). */
  name: 'CGST' | 'SGST' | 'IGST';
  rate: string;
  basisAmount: string;
  amount: string;
}

export interface QuoteLine {
  productId: string;
  name: string;
  sku: string;
  unit: string;
  quantity: string;
  unitPrice: string;
  lineSubtotal: string;
  lineDiscountTotal: string;
  taxableValue: string;
  lineTaxTotal: string;
  lineTotal: string;
  taxSplit: 'CGST_SGST' | 'IGST';
  taxInclusive: boolean;
  taxLines: QuoteLineTax[];
}

export interface CartQuote {
  currency: string;
  subtotal: string;
  itemDiscountTotal: string;
  couponDiscountTotal: string;
  loyaltyDiscountTotal: string;
  taxTotal: string;
  roundingAdjustment: string;
  grandTotal: string;
  couponApplied: { code: string; discount: string } | null;
  loyaltyApplied: { points: number; discount: string } | null;
  /** Set when a requested coupon was rejected (quote still succeeds). */
  couponError?: 'COUPON_NOT_FOUND' | 'COUPON_INACTIVE' | 'COUPON_NOT_ELIGIBLE';
  lines: QuoteLine[];
  /** Stable hash of the quote — confirm() rejects stale carts via this. */
  hash: string;
}

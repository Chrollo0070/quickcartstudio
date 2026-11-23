import type { Prisma } from '../generated/prisma/client';

/**
 * Receipt snapshot shape — the immutable document rendered by the customer
 * UI and (later) emailed/exported. Value snapshots mean catalogue edits never
 * change a paid receipt.
 */
export interface ConfirmReceiptPayload {
  invoiceNumber: string;
  issuedAt: string;
  store: {
    name: string;
    code: string;
    address: string | null;
    city: string | null;
    state: string | null;
    gstin: string | null;
    phone: string | null;
  };
  order: {
    id: string;
    channel: string;
    placedAt: string;
    currency: string;
  };
  lines: Array<{
    name: string;
    sku: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    lineSubtotal: string;
    lineDiscountTotal: string;
    taxableValue: string;
    lineTaxTotal: string;
    lineTotal: string;
    taxSplit: 'CGST_SGST' | 'IGST';
    taxLines: Array<{ name: string; rate: string; basisAmount: string; amount: string }>;
  }>;
  totals: {
    subtotal: string;
    itemDiscountTotal: string;
    couponDiscountTotal: string;
    loyaltyDiscountTotal: string;
    taxTotal: string;
    roundingAdjustment: string;
    grandTotal: string;
  };
  payment: {
    provider: string;
    method: string | null;
    amount: string;
    currency: string;
  };
}

export type ReceiptRecord = Prisma.ReceiptGetPayload<Record<string, never>>;

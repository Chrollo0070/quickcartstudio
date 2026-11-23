/**
 * Payment provider abstraction (spec §2 Payments). Providers are swapped via
 * configuration; the API contract is what the checkout flow needs:
 *
 *  1. createIntent — start a payment for an order (provider-side reference).
 *  2. verifyWebhook — authenticate an incoming callback (signature) and map
 *     it to a settlement instruction. NEVER trust a frontend "success" flag.
 *  3. kind — the enum value persisted on Payment.provider.
 *
 * Raw card data never passes through here (or anywhere): providers handle
 * payment instruments on their own surfaces.
 */
export interface PaymentIntentRequest {
  orderId: string;
  /** Minor units (paise). */
  amountMinor: number;
  currency: string;
  /** Client idempotency key — forwarded so retries reuse the same intent. */
  idempotencyKey: string;
  description: string;
}

export interface PaymentIntentResult {
  /** Our Payment.id — clients poll/complete against this. */
  paymentId: string;
  /** Provider-side reference stored on Payment.providerRef. */
  providerRef: string;
  /** Provider-specific payload for the client SDK (or demo instructions). */
  clientPayload: Record<string, unknown>;
}

export interface WebhookEvent {
  /** Maps to Payment.providerRef for settlement. */
  providerRef: string;
  /** Only 'SUCCEEDED' events reach the settlement path; failures/cancels
   *  update Payment.status without touching stock. */
  outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  /** Minor units reported by the provider — must match the payment amount. */
  amountMinor?: number;
  failureReason?: string;
}

export interface WebhookVerificationResult {
  verified: boolean;
  event?: WebhookEvent;
}

export interface PaymentProvider {
  readonly kind: 'MOCK' | 'RAZORPAY' | 'CASH';
  createIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult>;
  /**
   * Verify a provider callback. `rawBody` MUST be the untouched request body
   * (HMACs are computed over exact bytes). Returns verified:false for
   * tampered/unknown payloads — the caller rejects before any DB access.
   */
  verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<WebhookVerificationResult>;
}

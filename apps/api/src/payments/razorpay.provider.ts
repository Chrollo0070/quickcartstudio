import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { getEnv } from '../config/env';
import { safeEqualHex } from './mock-payment.provider';
import type {
  PaymentIntentRequest,
  PaymentIntentResult,
  PaymentProvider,
  WebhookVerificationResult,
} from './payment-provider.interface';

/**
 * Razorpay test-mode adapter (spec §2, Indian market).
 *
 * Implemented locally (no network needed for the security-critical parts):
 * - webhook signature verification (X-Razorpay-Signature, HMAC-SHA256 of the
 *   raw body with the webhook secret) — the settle path is identical to the
 *   mock provider's once verified;
 * - client-side checkout signature math
 *   (HMAC(order_id|payment_id, key_secret)) is the standard test-mode flow.
 *
 * Creating real Razorpay orders requires live API calls with RAZORPAY_KEY_ID /
 * RAZORPAY_KEY_SECRET; without them the adapter refuses (501) rather than
 * faking a gateway. Wiring the actual HTTPS call is a deployment-time task
 * (documented in docs/implementation-status.md).
 */
@Injectable()
export class RazorpayProvider implements PaymentProvider {
  readonly kind = 'RAZORPAY' as const;

  private configured(): boolean {
    const env = getEnv();
    return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET);
  }

  async createIntent(_request: PaymentIntentRequest): Promise<PaymentIntentResult> {
    if (!this.configured()) {
      throw new ServiceUnavailableException({
        message: 'Razorpay adapter is not configured (missing RAZORPAY_* env vars)',
        code: 'PROVIDER_NOT_CONFIGURED',
      });
    }
    // Deployment-time: POST https://api.razorpay.com/v1/orders with
    // { amount: amountMinor, currency, receipt: idempotencyKey } and store
    // the returned order id as providerRef. Test-mode signature the client
    // verifies: HMAC(order_id|payment_id, RAZORPAY_KEY_SECRET).
    throw new ServiceUnavailableException({
      message: 'Razorpay order creation requires live API wiring (see implementation-status)',
      code: 'PROVIDER_NOT_IMPLEMENTED',
    });
  }

  /**
   * Razorpay webhook: X-Razorpay-Signature = HMAC-SHA256(rawBody, webhook secret).
   * Handled events: payment.captured (settle), payment.failed, order.cancelled? —
   * mapped to our outcomes; anything else is ignored (verified but no event).
   */
  async verifyWebhook(
    headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<WebhookVerificationResult> {
    if (!this.configured()) {
      return { verified: false };
    }
    const header = headers['x-razorpay-signature'];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!signature) {
      return { verified: false };
    }
    const expected = createHmac('sha256', getEnv().RAZORPAY_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest('hex');
    if (!safeEqualHex(expected, signature)) {
      return { verified: false };
    }

    let parsed: {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number } } };
    };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      return { verified: false };
    }
    const entity = parsed.payload?.payment?.entity;
    if (!entity?.order_id) {
      return { verified: true }; // authenticated, but not a settlement event
    }
    if (parsed.event === 'payment.captured') {
      return {
        verified: true,
        event: { providerRef: entity.order_id, outcome: 'SUCCEEDED', amountMinor: entity.amount },
      };
    }
    if (parsed.event === 'payment.failed') {
      return {
        verified: true,
        event: {
          providerRef: entity.order_id,
          outcome: 'FAILED',
          failureReason: 'Razorpay payment failed',
        },
      };
    }
    return { verified: true };
  }
}

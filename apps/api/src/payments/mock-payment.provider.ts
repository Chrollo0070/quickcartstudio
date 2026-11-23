import { Injectable } from '@nestjs/common';
import { createHmac, randomUUID } from 'node:crypto';
import { getEnv } from '../config/env';
import type {
  PaymentIntentRequest,
  PaymentIntentResult,
  PaymentProvider,
  WebhookEvent,
  WebhookVerificationResult,
} from './payment-provider.interface';

/**
 * Demo payment provider (spec §2: mock first). The intent returns a payment
 * reference; "settlement" happens through the SAME webhook path a real
 * provider uses — an HMAC-signed callback over exact bytes. The demo UI's
 * "Pay now" button asks OUR server to emit that signed callback (server-side
 * trusted), so signature verification, idempotency and stock settlement all
 * run through one code path. No card data is involved anywhere.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly kind = 'MOCK' as const;

  async createIntent(request: PaymentIntentRequest): Promise<PaymentIntentResult> {
    const providerRef = `mock_${randomUUID()}`;
    return {
      paymentId: '', // filled by PaymentsService after the Payment row exists
      providerRef,
      clientPayload: {
        provider: 'MOCK',
        mockReference: providerRef,
        amountMinor: request.amountMinor,
        currency: request.currency,
        instructions: 'Use the demo "Pay now" action — it emits the signed mock webhook.',
      },
    };
  }

  /**
   * Mock callback shape: { providerRef, outcome, signature }
   * signature = HMAC-SHA256(providerRef|outcome, PAYMENT_WEBHOOK_SECRET) hex.
   */
  static signature(providerRef: string, outcome: WebhookEvent['outcome']): string {
    return createHmac('sha256', getEnv().PAYMENT_WEBHOOK_SECRET)
      .update(`${providerRef}|${outcome}`)
      .digest('hex');
  }

  async verifyWebhook(
    _headers: Record<string, string | string[] | undefined>,
    rawBody: string,
  ): Promise<WebhookVerificationResult> {
    let parsed: { providerRef?: string; outcome?: string; signature?: string };
    try {
      parsed = JSON.parse(rawBody) as typeof parsed;
    } catch {
      return { verified: false };
    }
    const { providerRef, outcome, signature } = parsed;
    if (typeof providerRef !== 'string' || typeof signature !== 'string') {
      return { verified: false };
    }
    if (outcome !== 'SUCCEEDED' && outcome !== 'FAILED' && outcome !== 'CANCELLED') {
      return { verified: false };
    }
    const expected = MockPaymentProvider.signature(providerRef, outcome);
    if (!safeEqualHex(expected, signature)) {
      return { verified: false };
    }
    const event: WebhookEvent = {
      providerRef,
      outcome,
      failureReason: outcome === 'FAILED' ? 'Mock failure (demo)' : undefined,
    };
    return { verified: true, event };
  }
}

export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

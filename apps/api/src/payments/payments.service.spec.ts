import { jest, describe, expect, it, beforeAll } from '@jest/globals';
import { createHmac } from 'node:crypto';
import { MockPaymentProvider, safeEqualHex } from './mock-payment.provider';
import { RazorpayProvider } from './razorpay.provider';
import { PaymentsService } from './payments.service';

const RZP_WEBHOOK_SECRET = 'rzp-test-webhook-secret-0123456789';

beforeAll(() => {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
  process.env.JWT_ACCESS_SECRET = 'x'.repeat(48);
  process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-0123456789abcdef';
  const RZP_WEBHOOK_SECRET = 'rzp-test-webhook-secret-0123456789';
  process.env.RAZORPAY_WEBHOOK_SECRET = RZP_WEBHOOK_SECRET;
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
  process.env.RAZORPAY_KEY_SECRET = 'rzp_test_secret';
});

describe('safeEqualHex', () => {
  it('matches equal hex strings and rejects different ones (constant-time semantics)', () => {
    expect(safeEqualHex('abcd', 'abcd')).toBe(true);
    expect(safeEqualHex('abcd', 'abce')).toBe(false);
    expect(safeEqualHex('abcd', 'abc')).toBe(false);
    expect(safeEqualHex('', '')).toBe(true);
  });
});

describe('MockPaymentProvider.verifyWebhook', () => {
  const provider = new MockPaymentProvider();

  it('accepts a correctly signed SUCCEEDED callback', async () => {
    const body = JSON.stringify({
      providerRef: 'mock_123',
      outcome: 'SUCCEEDED',
      signature: MockPaymentProvider.signature('mock_123', 'SUCCEEDED'),
    });
    const result = await provider.verifyWebhook({}, body);
    expect(result.verified).toBe(true);
    expect(result.event).toMatchObject({ providerRef: 'mock_123', outcome: 'SUCCEEDED' });
  });

  it('rejects tampered payloads (signature over different content)', async () => {
    const body = JSON.stringify({
      providerRef: 'mock_123',
      outcome: 'SUCCEEDED',
      signature: MockPaymentProvider.signature('mock_999', 'SUCCEEDED'),
    });
    const result = await provider.verifyWebhook({}, body);
    expect(result.verified).toBe(false);
  });

  it('rejects an attacker-chosen signature (secret not known to clients)', async () => {
    const body = JSON.stringify({
      providerRef: 'mock_123',
      outcome: 'SUCCEEDED',
      signature: 'deadbeef',
    });
    const result = await provider.verifyWebhook({}, body);
    expect(result.verified).toBe(false);
  });

  it('rejects unknown outcomes and malformed JSON', async () => {
    const signedRefund = JSON.stringify({
      providerRef: 'mock_123',
      outcome: 'REFUNDED',
      signature: MockPaymentProvider.signature('mock_123', 'REFUNDED' as never),
    });
    expect((await provider.verifyWebhook({}, signedRefund)).verified).toBe(false);
    expect((await provider.verifyWebhook({}, 'not json')).verified).toBe(false);
    expect((await provider.verifyWebhook({}, '{}')).verified).toBe(false);
  });
});

describe('RazorpayProvider.verifyWebhook', () => {
  const provider = new RazorpayProvider();
  const secret = RZP_WEBHOOK_SECRET;

  function signedBody(
    event: string,
    orderId: string,
    amount: number,
  ): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify({
      event,
      payload: { payment: { entity: { id: 'pay_1', order_id: orderId, amount } } },
    });
    return {
      body,
      headers: {
        'x-razorpay-signature': createHmac('sha256', secret).update(body).digest('hex'),
      },
    };
  }

  it('maps a signature-verified payment.captured to a settlement event', async () => {
    const { body, headers } = signedBody('payment.captured', 'order_99', 10125);
    const result = await provider.verifyWebhook(headers, body);
    expect(result.verified).toBe(true);
    expect(result.event).toMatchObject({
      providerRef: 'order_99',
      outcome: 'SUCCEEDED',
      amountMinor: 10125,
    });
  });

  it('rejects a forged signature before any parsing matters', async () => {
    const { body } = signedBody('payment.captured', 'order_99', 10125);
    const result = await provider.verifyWebhook({ 'x-razorpay-signature': 'forged' }, body);
    expect(result.verified).toBe(false);
  });

  it('verifies unrelated events but yields no settlement instruction', async () => {
    const { body, headers } = signedBody('refund.processed', 'order_99', 10125);
    const result = await provider.verifyWebhook(headers, body);
    expect(result.verified).toBe(true);
    expect(result.event).toBeUndefined();
  });
});

describe('PaymentsService — duplicate webhook suppression', () => {
  const settledPayment = {
    id: 'pay-1',
    orderId: 'order-1',
    provider: 'MOCK',
    providerRef: 'mock_abc',
    status: 'SUCCEEDED',
    amount: { times: () => ({ toFixed: () => '10125' }) } as never,
    currency: 'INR',
    method: 'mock',
    requestedAt: new Date(),
    settledAt: new Date(),
    failureReason: null,
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    updatedAt: new Date(),
    createdAt: new Date(),
  };

  function makeService() {
    const prisma = {
      payment: {
        findUnique: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue(settledPayment),
        findFirst: jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(null),
        updateMany: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ count: 0 }),
      },
      $transaction: jest
        .fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()
        .mockImplementation((fn) =>
          fn({
            payment: {
              findUnique: jest
                .fn<(...args: unknown[]) => Promise<unknown>>()
                .mockResolvedValue(settledPayment),
            },
          }),
        ),
      order: {
        updateMany: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({ count: 0 }),
      },
    };
    const service = new PaymentsService(
      prisma as never,
      { emit: () => undefined } as never,
      new MockPaymentProvider(),
      new RazorpayProvider(),
    );
    return { service, prisma };
  }

  it('returns duplicate:true with ZERO stock/db side effects for an already-settled payment', async () => {
    const { service, prisma } = makeService();
    const result = (await service.handleWebhook(
      'MOCK',
      {},
      JSON.stringify({
        providerRef: 'mock_abc',
        outcome: 'SUCCEEDED',
        signature: MockPaymentProvider.signature('mock_abc', 'SUCCEEDED'),
      }),
    )) as { settled?: boolean; duplicate?: boolean };
    expect(result.duplicate).toBe(true);
    // The transaction body returned before creating movements or updating rows:
    // only findUnique ran inside it.
    expect(prisma.order.updateMany).not.toHaveBeenCalled();
    expect(prisma.payment.updateMany).not.toHaveBeenCalled();
  });

  it('markPaymentFailed closes the order only while it is still pending', async () => {
    const { service, prisma } = makeService();
    prisma.payment.findFirst.mockResolvedValue({ orderId: 'order-1' });
    await service.markPaymentFailed('MOCK', 'mock_abc', 'demo failure');
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'PENDING_PAYMENT' }),
        data: { status: 'FAILED' },
      }),
    );
  });
});

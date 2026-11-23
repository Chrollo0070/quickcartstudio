import { createEnv } from './env';

const validSource = {
  NODE_ENV: 'development',
  PORT: '4000',
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  CORS_ORIGINS: 'http://localhost:3000, http://127.0.0.1:3000',
  LOG_LEVEL: 'info',
  JWT_ACCESS_SECRET: 'x'.repeat(48),
  PAYMENT_WEBHOOK_SECRET: 'w'.repeat(48),
};

describe('createEnv', () => {
  it('accepts a valid environment and applies defaults for omitted keys', () => {
    const parsed = createEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
      JWT_ACCESS_SECRET: 'y'.repeat(48),
      PAYMENT_WEBHOOK_SECRET: 'v'.repeat(48),
    });
    expect(parsed.NODE_ENV).toBe('development');
    expect(parsed.PORT).toBe(4000);
    expect(parsed.LOG_LEVEL).toBe('info');
    expect(parsed.JWT_ACCESS_TTL).toBe('15m');
    expect(parsed.JWT_REFRESH_TTL_DAYS).toBe(7);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(parsed.REDIS_URL).toBeUndefined();
  });

  it('coerces PORT to a number', () => {
    const parsed = createEnv({ ...validSource, PORT: '8080' });
    expect(parsed.PORT).toBe(8080);
  });

  it('splits CORS_ORIGINS into a trimmed allowlist', () => {
    const parsed = createEnv(validSource);
    expect(parsed.CORS_ORIGINS).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
  });

  it('rejects a missing DATABASE_URL with a readable report', () => {
    expect(() => createEnv({ PORT: '4000', JWT_ACCESS_SECRET: 'x'.repeat(48) })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rejects a short JWT_ACCESS_SECRET', () => {
    expect(() => createEnv({ ...validSource, JWT_ACCESS_SECRET: 'too-short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('rejects malformed URLs and out-of-range ports', () => {
    expect(() => createEnv({ ...validSource, DATABASE_URL: 'not-a-url' })).toThrow(/DATABASE_URL/);
    expect(() => createEnv({ ...validSource, PORT: '99999' })).toThrow(/PORT/);
    expect(() => createEnv({ ...validSource, NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('never exposes raw environment values in the error message', () => {
    let message = '';
    try {
      createEnv({ ...validSource, DATABASE_URL: 'not-a-url' });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain('postgresql://user:pass');
  });
});

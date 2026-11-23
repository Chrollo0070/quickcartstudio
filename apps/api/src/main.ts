import 'dotenv/config';
import { Logger, type LogLevel } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { API_PREFIX, APP_NAME } from '@quickcart/shared';
import { getEnv } from './config/env';
import { requestIdMiddleware } from './common/middleware/request-id.middleware';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const env = getEnv();
  const logLevels: LogLevel[] =
    env.NODE_ENV === 'development' ? ['log', 'warn', 'error', 'debug'] : ['log', 'warn', 'error'];
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: logLevels,
    // Preserve the untouched request body for webhook HMAC verification.
    rawBody: true,
  });

  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.enableCors({ origin: env.CORS_ORIGINS, credentials: true });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();

  const swaggerConfig = new DocumentBuilder()
    .setTitle(`${APP_NAME} API`)
    .setDescription('Supermarket self-checkout, POS and real-time inventory platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  await app.listen(env.PORT, '0.0.0.0');
  const url = await app.getUrl();
  const logger = new Logger('Bootstrap');
  logger.log(`${APP_NAME} API listening on ${url}/${API_PREFIX}`);
  logger.log(`Swagger UI available at ${url}/${API_PREFIX}/docs`);
}

void bootstrap().catch((error: unknown) => {
  // Fail loudly and immediately when startup validation or wiring breaks.
  // console.error is allowed by the lint config for fatal startup failures.
  console.error('Fatal: API failed to start', error);
  process.exit(1);
});

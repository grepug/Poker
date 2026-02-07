import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

const resolveCorsOrigin = () => {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === '*') {
    return true;
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length === 0) {
    return true;
  }

  return origins.length === 1 ? origins[0] : origins;
};

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors({
    origin: resolveCorsOrigin(),
    credentials: true,
  });

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  logger.log(`Server running on http://${host}:${port}`);
  logger.log(`WebSocket server ready`);
}
bootstrap();

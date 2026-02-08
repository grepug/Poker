import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import * as express from 'express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'fs';
import * as path from 'path';

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

  const frontendPathCandidates = [
    process.env.FRONTEND_DIST_PATH?.trim(),
    path.resolve(process.cwd(), '../poker-client/dist'),
    path.resolve(__dirname, '../../poker-client/dist'),
    path.resolve(__dirname, '../../../poker-client/dist'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const frontendDistPath = frontendPathCandidates.find((candidate) =>
    existsSync(path.join(candidate, 'index.html')),
  );

  if (frontendDistPath) {
    const frontendIndexPath = path.join(frontendDistPath, 'index.html');
    app.use(express.static(frontendDistPath, { index: false }));

    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.get(
      '*',
      (req: Request, res: Response, next: NextFunction): void => {
        if (
          req.path.startsWith('/socket.io') ||
          req.path.startsWith('/api') ||
          req.path === '/health'
        ) {
          next();
          return;
        }

        res.sendFile(frontendIndexPath);
      },
    );

    logger.log(`Serving frontend from ${frontendDistPath}`);
  } else {
    logger.warn(
      `Frontend dist not found; checked: ${frontendPathCandidates.join(', ')}`,
    );
  }

  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  logger.log(`Server running on http://${host}:${port}`);
  logger.log(`WebSocket server ready`);
}
bootstrap();

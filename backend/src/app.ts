import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { env } from './config/env.js';
import { getDatabaseStatus } from './config/database.js';
import authRoutes from './routes/auth.routes.js';
import corridorRoutes from './routes/corridor.routes.js';
import poolRoutes from './routes/pool.routes.js';
import publicTrackRoutes from './routes/publicTrack.routes.js';
import shipperBusinessRoutes from './routes/shipperBusiness.routes.js';
import shipmentRoutes from './routes/shipment.routes.js';
import driverRoutes from './routes/driver.routes.js';
import platformOwnerRoutes from './routes/platformOwner.routes.js';
import { HttpError } from './utils/errors.js';
import { logger } from './utils/logger.js';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: env.ORIGIN,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const healthHandler = (_req: Request, res: Response) => {
    const db = getDatabaseStatus();
    const statusCode = db.connected ? 200 : 503;
    res.status(statusCode).json({
      success: db.connected,
      service: 'meecargo-api',
      environment: env.NODE_ENV,
      uptimeSeconds: Math.floor(process.uptime()),
      db,
      modes: {
        payment: env.PAYMENT_MODE,
        routing: env.ROUTING_PROVIDER,
        notifications: env.NOTIFICATION_PROVIDER,
      },
      timestamp: new Date().toISOString(),
    });
  };

  app.get('/api/v1/health', healthHandler);
  app.get('/health', healthHandler);

  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/corridors', corridorRoutes);
  app.use('/api/v1/pools', poolRoutes);
  app.use('/api/v1/track', publicTrackRoutes);
  app.use('/api/v1/shipper/business', shipperBusinessRoutes);
  app.use('/api/v1/shipments', shipmentRoutes);
  app.use('/api/v1/driver', driverRoutes);
  app.use('/api/v1/platform-owner', platformOwnerRoutes);

  app.use((req: Request, res: Response) => {
    res.status(404).json({
      success: false,
      error: `Route not found: ${req.method} ${req.originalUrl}`,
    });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        success: false,
        error: err.message,
        ...(err.code ? { code: err.code } : {}),
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }

    if (err.name === 'ValidationError') {
      res.status(400).json({
        success: false,
        error: err.message,
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    if (err.name === 'MulterError') {
      res.status(400).json({
        success: false,
        error:
          err.message === 'File too large'
            ? 'Uploaded file exceeds the 5 MB limit'
            : err.message,
        code: 'INVALID_FILE_UPLOAD',
      });
      return;
    }

    logger.error('[API Error]', {
      message: err.message,
      name: err.name,
    });
    res.status(500).json({
      success: false,
      error: env.NODE_ENV === 'production' ? 'Internal server error' : err.message,
    });
  });

  return app;
}

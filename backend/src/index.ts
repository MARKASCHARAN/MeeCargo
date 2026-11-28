import http from 'node:http';
import { env } from './config/env.js';
import { connectDatabase, disconnectDatabase } from './config/database.js';
import { createApp } from './app.js';
import { processExpiredOpenPools } from './services/cutoffService.js';
import { processScheduledPoolingWindowOpenings } from './services/driverSlotService.js';
import { processExpiredMarketplaceOpportunities } from './services/hybridOrchestratorService.js';
import { attachSocketGateway } from './socket/poolGateway.js';

async function bootstrap() {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);
  attachSocketGateway(server);

  const runScheduledSweeps = async () => {
    await processScheduledPoolingWindowOpenings().catch((err) => {
      console.warn('[AutoOpen] Sweep error:', err instanceof Error ? err.message : err);
    });
    await processExpiredOpenPools().catch((err) => {
      console.warn('[AutoCutoff] Sweep error:', err instanceof Error ? err.message : err);
    });
    await processExpiredMarketplaceOpportunities().catch((err) => {
      console.warn('[Marketplace] Sweep error:', err instanceof Error ? err.message : err);
    });
  };

  void runScheduledSweeps();
  const cutoffInterval = setInterval(() => {
    void runScheduledSweeps();
  }, 60_000);
  cutoffInterval.unref();

  server.listen(env.PORT, () => {
    console.log(`MeeCargo API listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down cleanly...`);
    clearInterval(cutoffInterval);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

bootstrap().catch((error) => {
  console.error('Failed to start MeeCargo API:', error);
  process.exit(1);
});

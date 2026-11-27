import mongoose, { type ClientSession } from 'mongoose';
import { env } from './env.js';

let replicaSetSupported: boolean | null = null;
let loggedStandaloneWarning = false;

export async function detectReplicaSetSupport(): Promise<boolean> {
  if (mongoose.connection.readyState !== 1 || !mongoose.connection.db) {
    replicaSetSupported = false;
    return false;
  }

  try {
    const admin = mongoose.connection.db.admin();
    const hello = await admin.command({ hello: 1 });
    replicaSetSupported = Boolean(hello.setName || hello.msg === 'isdbgrid');
    return replicaSetSupported;
  } catch {
    replicaSetSupported = false;
    return false;
  }
}

export async function connectDatabase(uri: string = env.MONGODB_URL): Promise<void> {
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    const hasReplicaSet = await detectReplicaSetSupport();
    console.log(
      `Connected to MongoDB (replicaSet=${hasReplicaSet ? 'enabled' : 'standalone'})`
    );
    if (!hasReplicaSet) {
      console.warn(
        'MongoDB is running without a replica set. Multi-document transactions will run sequentially without ACID rollback. See README for replica-set setup.'
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`MongoDB connection failed: ${message}`);
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

export function getDatabaseStatus() {
  const stateMap: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };
  return {
    connected: mongoose.connection.readyState === 1,
    readyState: stateMap[mongoose.connection.readyState] ?? 'unknown',
    replicaSetSupported: Boolean(replicaSetSupported),
  };
}

/**
 * Runs a multi-document operation inside a MongoDB transaction when connected
 * to a replica set or sharded cluster, falling back to non-transactional execution
 * on standalone dev instances.
 */
export async function withTransaction<T>(
  work: (session: ClientSession | null) => Promise<T>
): Promise<T> {
  const supportsTx =
    replicaSetSupported !== null ? replicaSetSupported : await detectReplicaSetSupport();

  if (!supportsTx) {
    if (!loggedStandaloneWarning) {
      loggedStandaloneWarning = true;
      console.warn('Running withTransaction() without replica-set transaction support.');
    }
    return work(null);
  }

  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

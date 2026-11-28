import { Schema, model, type Document } from 'mongoose';

export interface IRouteMatrixCache extends Document {
  cacheKey: string;
  provider: 'FIXTURE' | 'OSRM';
  stopCodes: string[];
  distanceMatrixMeters: number[][];
  durationMatrixSeconds: number[][];
  expiresAt: Date;
  createdAt: Date;
}

const routeMatrixCacheSchema = new Schema<IRouteMatrixCache>(
  {
    cacheKey: { type: String, required: true, unique: true },
    provider: { type: String, enum: ['FIXTURE', 'OSRM'], required: true },
    stopCodes: { type: [String], required: true },
    distanceMatrixMeters: { type: [[Number]], required: true },
    durationMatrixSeconds: { type: [[Number]], required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

routeMatrixCacheSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RouteMatrixCache = model<IRouteMatrixCache>(
  'RouteMatrixCache',
  routeMatrixCacheSchema
);

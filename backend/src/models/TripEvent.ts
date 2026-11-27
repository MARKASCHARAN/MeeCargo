import { Schema, model, type Document, type Types } from 'mongoose';
import { geoPointSchema, type GeoPoint } from './common.js';

export type TripEventType =
  | 'TRIP_STARTED'
  | 'TRIP_PAUSED'
  | 'TRIP_RESUMED'
  | 'TRIP_COMPLETED'
  | 'STOP_ARRIVED'
  | 'PICKUP_VERIFIED'
  | 'IN_TRANSIT'
  | 'AT_DESTINATION'
  | 'DELIVERED'
  | 'DELIVERY_FAILED'
  | 'EXCEPTION_REPORTED';

export interface ITripEvent extends Document {
  _id: Types.ObjectId;
  tripId: Types.ObjectId;
  shipmentId?: Types.ObjectId;
  eventType: TripEventType;
  actorUserId: Types.ObjectId;
  occurredAt: Date;
  idempotencyKey?: string;
  location?: GeoPoint;
  reason?: string;
  metadata?: Record<string, unknown>;
  recordedOffline?: boolean;
  createdAt: Date;
}

const tripEventSchema = new Schema<ITripEvent>(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', index: true },
    eventType: {
      type: String,
      enum: [
        'TRIP_STARTED',
        'TRIP_PAUSED',
        'TRIP_RESUMED',
        'TRIP_COMPLETED',
        'STOP_ARRIVED',
        'PICKUP_VERIFIED',
        'IN_TRANSIT',
        'AT_DESTINATION',
        'DELIVERED',
        'DELIVERY_FAILED',
        'EXCEPTION_REPORTED',
      ],
      required: true,
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    occurredAt: { type: Date, required: true, default: Date.now },
    idempotencyKey: { type: String, trim: true },
    location: { type: geoPointSchema },
    reason: { type: String, trim: true, maxlength: 300 },
    metadata: { type: Schema.Types.Mixed },
    recordedOffline: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

tripEventSchema.index(
  { tripId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  }
);
tripEventSchema.index({ tripId: 1, occurredAt: 1 });

export const TripEvent = model<ITripEvent>('TripEvent', tripEventSchema);

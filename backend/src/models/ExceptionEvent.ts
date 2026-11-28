import { Schema, model, type Document, type Types } from 'mongoose';

export type ExceptionType =
  | 'CUSTOMER_UNAVAILABLE'
  | 'INCORRECT_ADDRESS'
  | 'VEHICLE_BREAKDOWN'
  | 'ROAD_BLOCKED'
  | 'SHIPMENT_DAMAGED'
  | 'RECIPIENT_REFUSES'
  | 'DRIVER_UNAVAILABLE'
  | 'PARTIAL_DELIVERY'
  | 'PICKUP_FAILURE'
  | 'ROUTE_INFEASIBILITY';

export type ExceptionResolutionStatus =
  | 'OPEN'
  | 'RESCHEDULED'
  | 'RETURNED'
  | 'REASSIGNED'
  | 'RESOLVED';

export interface ExceptionResolutionAudit {
  action: string;
  actorUserId: Types.ObjectId;
  at: Date;
  note?: string;
}

export interface IExceptionEvent extends Document {
  _id: Types.ObjectId;
  tripId: Types.ObjectId;
  shipmentId?: Types.ObjectId;
  businessId?: Types.ObjectId;
  exceptionType: ExceptionType;
  reason: string;
  reportedByUserId: Types.ObjectId;
  occurredAt: Date;
  evidenceStorageKey?: string;
  evidenceMimeType?: string;
  evidenceAccessToken?: string;
  resolutionStatus: ExceptionResolutionStatus;
  reassignedTripId?: Types.ObjectId;
  routeRecalculated: boolean;
  resolutionHistory: ExceptionResolutionAudit[];
  createdAt: Date;
  updatedAt: Date;
}

const exceptionEventSchema = new Schema<IExceptionEvent>(
  {
    tripId: { type: Schema.Types.ObjectId, ref: 'Trip', required: true, index: true },
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', index: true },
    businessId: { type: Schema.Types.ObjectId, ref: 'BusinessProfile', index: true },
    exceptionType: {
      type: String,
      enum: [
        'CUSTOMER_UNAVAILABLE',
        'INCORRECT_ADDRESS',
        'VEHICLE_BREAKDOWN',
        'ROAD_BLOCKED',
        'SHIPMENT_DAMAGED',
        'RECIPIENT_REFUSES',
        'DRIVER_UNAVAILABLE',
        'PARTIAL_DELIVERY',
        'PICKUP_FAILURE',
        'ROUTE_INFEASIBILITY',
      ],
      required: true,
    },
    reason: { type: String, required: true, trim: true, maxlength: 500 },
    reportedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    occurredAt: { type: Date, required: true, default: Date.now },
    evidenceStorageKey: { type: String, trim: true },
    evidenceMimeType: { type: String, trim: true },
    evidenceAccessToken: { type: String, trim: true },
    resolutionStatus: {
      type: String,
      enum: ['OPEN', 'RESCHEDULED', 'RETURNED', 'REASSIGNED', 'RESOLVED'],
      default: 'OPEN',
    },
    reassignedTripId: { type: Schema.Types.ObjectId, ref: 'Trip' },
    routeRecalculated: { type: Boolean, default: false },
    resolutionHistory: [
      {
        action: { type: String, required: true },
        actorUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, required: true, default: Date.now },
        note: { type: String, trim: true },
      },
    ],
  },
  { timestamps: true }
);

export const ExceptionEvent = model<IExceptionEvent>(
  'ExceptionEvent',
  exceptionEventSchema
);

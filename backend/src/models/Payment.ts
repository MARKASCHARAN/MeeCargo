import { Schema, model, type Document, type Types } from 'mongoose';

export type PaymentType = 'TOKEN' | 'PICKUP_BALANCE' | 'REFUND';
export type PaymentStatus =
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'REFUND_PENDING'
  | 'REFUNDED';

export interface IPayment extends Document {
  _id: Types.ObjectId;
  shipmentId: Types.ObjectId;
  businessId: Types.ObjectId;
  type: PaymentType;
  amountPaise: number;
  status: PaymentStatus;
  mode: 'SIMULATED' | 'TEST_GATEWAY';
  isSimulated: boolean;
  providerRef: string;
  idempotencyKey?: string;
  refundReference?: string;
  refundReason?: string;
  actorUserId?: Types.ObjectId;
  processedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const ALLOWED_PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  PENDING: ['SUCCESS', 'FAILED'],
  SUCCESS: ['REFUND_PENDING', 'REFUNDED'],
  FAILED: [],
  REFUND_PENDING: ['REFUNDED', 'FAILED'],
  REFUNDED: [],
};

export function isValidPaymentTransition(
  from: PaymentStatus,
  to: PaymentStatus
): boolean {
  return ALLOWED_PAYMENT_TRANSITIONS[from]?.includes(to) ?? false;
}

const paymentSchema = new Schema<IPayment>(
  {
    shipmentId: { type: Schema.Types.ObjectId, ref: 'Shipment', required: true, index: true },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['TOKEN', 'PICKUP_BALANCE', 'REFUND'],
      required: true,
    },
    amountPaise: {
      type: Number,
      required: true,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Payment amount must be stored in integer paise.',
      },
    },
    status: {
      type: String,
      enum: ['PENDING', 'SUCCESS', 'FAILED', 'REFUND_PENDING', 'REFUNDED'],
      default: 'PENDING',
    },
    mode: {
      type: String,
      enum: ['SIMULATED', 'TEST_GATEWAY'],
      default: 'SIMULATED',
    },
    isSimulated: { type: Boolean, default: true },
    providerRef: { type: String, required: true, unique: true, trim: true },
    idempotencyKey: { type: String, trim: true },
    refundReference: { type: String, trim: true },
    refundReason: { type: String, trim: true, maxlength: 300 },
    actorUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    processedAt: { type: Date },
  },
  { timestamps: true }
);

paymentSchema.index(
  { shipmentId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true }
);

export const Payment = model<IPayment>('Payment', paymentSchema);

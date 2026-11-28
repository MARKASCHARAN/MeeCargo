import { Schema, model, type Document, type Types } from 'mongoose';

export interface INotificationLog extends Document {
  _id: Types.ObjectId;
  recipientUserId?: Types.ObjectId;
  recipientContact?: string;
  channel: 'IN_APP' | 'CONSOLE' | 'WEBHOOK';
  eventType: string;
  title: string;
  message: string;
  dedupeKey?: string;
  metadata?: Record<string, unknown>;
  readAt?: Date;
  createdAt: Date;
}

const notificationLogSchema = new Schema<INotificationLog>(
  {
    recipientUserId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    recipientContact: { type: String, trim: true },
    channel: {
      type: String,
      enum: ['IN_APP', 'CONSOLE', 'WEBHOOK'],
      default: 'IN_APP',
    },
    eventType: { type: String, required: true, trim: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    dedupeKey: { type: String, unique: true, sparse: true },
    metadata: { type: Schema.Types.Mixed },
    readAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

export const NotificationLog = model<INotificationLog>(
  'NotificationLog',
  notificationLogSchema
);

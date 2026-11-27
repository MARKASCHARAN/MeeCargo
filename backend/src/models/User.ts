import { Schema, model, type Document, type Types } from 'mongoose';

export type UserRole = 'SHIPPER' | 'DRIVER' | 'PLATFORM_OWNER';

export interface IUser extends Document {
  _id: Types.ObjectId;
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: UserRole;
  businessId?: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    phone: {
      type: String,
      trim: true,
      sparse: true,
      unique: true,
    },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ['SHIPPER', 'DRIVER', 'PLATFORM_OWNER'],
      required: true,
    },
    businessId: {
      type: Schema.Types.ObjectId,
      ref: 'BusinessProfile',
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

userSchema.index({ role: 1, isActive: 1 });
userSchema.index({ businessId: 1 });
userSchema.index(
  { role: 1 },
  {
    unique: true,
    partialFilterExpression: { role: 'PLATFORM_OWNER' },
  }
);

export const User = model<IUser>('User', userSchema);

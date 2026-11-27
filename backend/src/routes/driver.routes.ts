import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Trip } from '../models/Trip.js';
import { Vehicle } from '../models/Vehicle.js';
import { respondToTripAssignment } from '../services/driverAssignment.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

router.use(requireAuth, requireRole('DRIVER'));

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  availabilityStatus: z.enum(['AVAILABLE', 'ON_TRIP', 'OFFLINE']).default('AVAILABLE'),
  fleetTier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']).default('TIER_1'),
  licenseNumber: z.string().trim().max(40).optional(),
  homeBase: z.string().trim().max(120).optional(),
  vehicleId: z.string().optional(),
});

const availabilitySchema = z.object({
  availabilityStatus: z.enum(['AVAILABLE', 'ON_TRIP', 'OFFLINE']),
});

router.get('/profile', async (req, res) => {
  const profile = await DriverProfile.findOne({ userId: req.auth!.userId }).populate(
    'vehicleId'
  );
  res.json({
    success: true,
    driverProfile: profile,
  });
});

router.put('/profile', async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid driver profile payload', 'VALIDATION_ERROR', parsed.error.flatten());
  }

  const data = parsed.data;
  if (data.vehicleId) {
    if (!isValidObjectId(data.vehicleId)) {
      throw new HttpError(400, 'Invalid vehicleId', 'VALIDATION_ERROR');
    }
    const vehicle = await Vehicle.findById(data.vehicleId);
    if (!vehicle) {
      throw new HttpError(404, 'Assigned vehicle not found', 'VEHICLE_NOT_FOUND');
    }
  }

  const profile = await DriverProfile.findOneAndUpdate(
    { userId: req.auth!.userId },
    {
      $set: {
        userId: req.auth!.userId,
        name: data.name,
        phone: data.phone,
        availabilityStatus: data.availabilityStatus,
        fleetTier: data.fleetTier,
        ...(data.licenseNumber !== undefined ? { licenseNumber: data.licenseNumber } : {}),
        ...(data.homeBase !== undefined ? { homeBase: data.homeBase } : {}),
        ...(data.vehicleId !== undefined ? { vehicleId: data.vehicleId } : {}),
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  ).populate('vehicleId');

  res.json({
    success: true,
    driverProfile: profile,
  });
});

router.patch('/availability', async (req, res) => {
  const parsed = availabilitySchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid availability status', 'VALIDATION_ERROR');
  }

  const profile = await DriverProfile.findOneAndUpdate(
    { userId: req.auth!.userId },
    { $set: { availabilityStatus: parsed.data.availabilityStatus } },
    { returnDocument: 'after', runValidators: true }
  ).populate('vehicleId');

  if (!profile) {
    throw new HttpError(404, 'Driver profile not found. Create your profile first.', 'NOT_FOUND');
  }

  res.json({
    success: true,
    driverProfile: profile,
  });
});

router.get('/trips', async (req, res) => {
  const trips = await Trip.find({ driverId: req.auth!.userId })
    .populate('corridorId', 'code name stops')
    .populate('slotId', 'slotCode label plannedDepartureAt estimatedArrivalStartAt estimatedArrivalEndAt')
    .populate('vehicleId', 'registrationNumber vehicleClass tier maxWeightKg maxVolumeCbm bedDimensionsCm')
    .sort({ plannedDepartureAt: 1 });

  res.json({
    success: true,
    trips,
  });
});

router.get('/trips/:tripId', async (req, res) => {
  const { tripId } = req.params;
  if (!isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid trip ID', 'VALIDATION_ERROR');
  }

  const trip = await Trip.findOne({
    _id: tripId,
    driverId: req.auth!.userId,
  })
    .populate('corridorId', 'code name stops')
    .populate('slotId', 'slotCode label plannedDepartureAt estimatedArrivalStartAt estimatedArrivalEndAt')
    .populate('vehicleId', 'registrationNumber vehicleClass tier maxWeightKg maxVolumeCbm bedDimensionsCm');

  if (!trip) {
    throw new HttpError(403, 'Trip not found or not assigned to you', 'FORBIDDEN');
  }

  res.json({
    success: true,
    trip,
  });
});

router.post('/trips/:tripId/respond', async (req, res) => {
  const tripId = Array.isArray(req.params.tripId)
    ? req.params.tripId[0]
    : req.params.tripId;

  const schema = z.object({
    decision: z.enum(['ACCEPT', 'REJECT']),
    reason: z.string().trim().max(300).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid trip response payload', 'VALIDATION_ERROR');
  }

  const result = await respondToTripAssignment({
    tripId,
    driverUserId: req.auth!.userId,
    decision: parsed.data.decision,
    reason: parsed.data.reason,
  });

  res.json({
    success: true,
    ...result,
  });
});

router.get('/notifications', async (req, res) => {
  const notifications = await NotificationLog.find({
    recipientUserId: req.auth!.userId,
  })
    .sort({ createdAt: -1 })
    .limit(25);

  res.json({
    success: true,
    notifications,
  });
});

router.patch('/notifications/:id/read', async (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  if (!isValidObjectId(id)) {
    throw new HttpError(400, 'Invalid notification ID', 'VALIDATION_ERROR');
  }

  await NotificationLog.updateOne(
    { _id: id, recipientUserId: req.auth!.userId },
    { $set: { readAt: new Date() } }
  );

  res.json({ success: true });
});

export default router;

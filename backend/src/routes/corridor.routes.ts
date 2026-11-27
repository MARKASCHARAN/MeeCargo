import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { Corridor } from '../models/Corridor.js';
import { Slot } from '../models/Slot.js';
import { geocodeAddress } from '../services/geocodingService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

router.get('/', async (_req, res) => {
  const now = new Date();
  const corridors = await Corridor.find({ isActive: true }).sort({ code: 1 }).lean();
  const corridorIds = corridors.map((c) => c._id);

  const slots = await Slot.find({
    corridorId: { $in: corridorIds },
    status: { $in: ['OPEN', 'LOCKING', 'LOCKED'] },
  })
    .sort({ plannedDepartureAt: 1 })
    .lean();

  const slotsByCorridor = new Map<string, unknown[]>();
  for (const slot of slots) {
    const key = String(slot.corridorId);
    const list = slotsByCorridor.get(key) ?? [];
    list.push({
      ...slot,
      availableWeightKg: Math.max(0, slot.capacityWeightKg - slot.reservedWeightKg),
      availableVolumeCbm: Math.max(
        0,
        Number((slot.capacityVolumeCbm - slot.reservedVolumeCbm).toFixed(4))
      ),
      isPastCutoff: now >= new Date(slot.cutoffAt),
    });
    slotsByCorridor.set(key, list);
  }

  res.json({
    success: true,
    corridors: corridors.map((c) => ({
      ...c,
      slots: slotsByCorridor.get(String(c._id)) ?? [],
    })),
  });
});

router.get('/:corridorId/slots', async (req, res) => {
  const { corridorId } = req.params;
  if (!isValidObjectId(corridorId)) {
    throw new HttpError(400, 'Invalid corridor ID', 'VALIDATION_ERROR');
  }

  const now = new Date();
  const slots = await Slot.find({ corridorId }).sort({ plannedDepartureAt: 1 }).lean();
  res.json({
    success: true,
    slots: slots.map((slot) => ({
      ...slot,
      availableWeightKg: Math.max(0, slot.capacityWeightKg - slot.reservedWeightKg),
      availableVolumeCbm: Math.max(
        0,
        Number((slot.capacityVolumeCbm - slot.reservedVolumeCbm).toFixed(4))
      ),
      isPastCutoff: now >= new Date(slot.cutoffAt),
    })),
  });
});

const geocodeInputSchema = z.object({
  addressLine: z.string().trim().optional(),
  villageOrTown: z.string().trim().min(2),
  district: z.string().trim().min(2),
  state: z.string().trim().default('Gujarat'),
  pincode: z.string().trim().optional(),
});

router.post('/geocode', requireAuth, async (req, res) => {
  const parsed = geocodeInputSchema.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, 'Invalid geocode request', 'VALIDATION_ERROR', parsed.error.flatten());
  }

  const result = await geocodeAddress(parsed.data);
  res.json({
    success: true,
    ...result,
  });
});

export default router;

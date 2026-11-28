import { Router } from 'express';
import { isValidObjectId } from 'mongoose';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { Corridor } from '../models/Corridor.js';
import { Pool } from '../models/Pool.js';
import { Slot } from '../models/Slot.js';
import { geocodeAddress } from '../services/geocodingService.js';
import {
  calculateDeterministicPrice,
  getActivePricingRules,
} from '../services/pricingEngine.js';
import { toServiceDateKey } from '../services/shipmentService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

function sanitizeSlotLabelForShipper(label: string, slotNumber?: number): string {
  const withoutReturn = label
    .replace(/\s*[•-]\s*(?:Mandatory\s*)?(?:\d{2}:\d{2}\s*)?Return.*$/i, '')
    .trim();
  if (withoutReturn) {
    // Ensure clean parenthesis closure if stripped inside parens
    if (withoutReturn.includes('(') && !withoutReturn.includes(')')) {
      return `${withoutReturn})`;
    }
    return withoutReturn;
  }
  return slotNumber ? `Outbound Pickup Slot ${slotNumber}` : 'Outbound Pickup Slot';
}

router.get('/', async (_req, res) => {
  const now = new Date();
  const corridors = await Corridor.find({ isActive: true }).sort({ code: 1 }).lean();
  const corridorIds = corridors.map((c) => c._id);

  const [slots, pools, rules] = await Promise.all([
    Slot.find({
      corridorId: { $in: corridorIds },
      status: { $in: ['OPEN', 'LOCKING', 'LOCKED'] },
    })
      .sort({ plannedDepartureAt: 1 })
      .lean(),
    Pool.find({
      corridorId: { $in: corridorIds },
      status: { $in: ['OPEN', 'LOCKING', 'LOCKED', 'AWAITING_VIABILITY_DECISION'] },
    })
      .select('slotId status shipmentIds')
      .lean(),
    getActivePricingRules(),
  ]);

  type SanitizedSlotEntry = {
    _id: unknown;
    corridorId: unknown;
    slotNumber?: number;
    slotCode: string;
    label: string;
    departureDate: Date;
    cutoffAt: Date;
    plannedDepartureAt: Date;
    capacityWeightKg: number;
    capacityVolumeCbm: number;
    reservedWeightKg: number;
    reservedVolumeCbm: number;
    status: string;
    availableWeightKg: number;
    availableVolumeCbm: number;
    isPastCutoff: boolean;
    isFull: boolean;
  };

  const poolBySlotId = new Map(pools.map((p) => [String(p.slotId), p]));
  const slotsByCorridor = new Map<string, SanitizedSlotEntry[]>();
  for (const slot of slots) {
    const key = String(slot.corridorId);
    const list = slotsByCorridor.get(key) ?? [];
    const availableWeightKg = Math.max(0, slot.capacityWeightKg - slot.reservedWeightKg);
    const availableVolumeCbm = Math.max(
      0,
      Number((slot.capacityVolumeCbm - slot.reservedVolumeCbm).toFixed(4))
    );
    const isPastCutoff = now >= new Date(slot.cutoffAt);
    const isFull = availableWeightKg <= 0 || availableVolumeCbm <= 0;

    list.push({
      _id: slot._id,
      corridorId: slot.corridorId,
      slotNumber: slot.slotNumber,
      slotCode: slot.slotCode,
      label: sanitizeSlotLabelForShipper(slot.label, slot.slotNumber),
      departureDate: slot.departureDate,
      cutoffAt: slot.cutoffAt,
      plannedDepartureAt: slot.plannedDepartureAt,
      capacityWeightKg: slot.capacityWeightKg,
      capacityVolumeCbm: slot.capacityVolumeCbm,
      reservedWeightKg: slot.reservedWeightKg,
      reservedVolumeCbm: slot.reservedVolumeCbm,
      status: slot.status,
      availableWeightKg,
      availableVolumeCbm,
      isPastCutoff,
      isFull,
    });
    slotsByCorridor.set(key, list);
  }

  res.json({
    success: true,
    corridors: corridors.map((c) => {
      const corridorSlots = slotsByCorridor.get(String(c._id)) ?? [];

      const corridorTz = (c as { timezone?: string }).timezone ?? 'Asia/Kolkata';
      const byDate = new Map<string, typeof corridorSlots>();
      for (const s of corridorSlots) {
        const dateKey = toServiceDateKey(s.departureDate, corridorTz);
        const group = byDate.get(dateKey) ?? [];
        group.push(s);
        byDate.set(dateKey, group);
      }

      const serviceDates = Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([serviceDate, dateSlots]) => {
          const openBeforeCutoff = dateSlots.filter(
            (s) => s.status === 'OPEN' && !s.isPastCutoff
          );
          const bookableSlots = openBeforeCutoff.filter((s) => !s.isFull);
          const bookable = bookableSlots.length > 0;
          const status: 'OPEN' | 'LOCKED' | 'FULL' | 'CLOSED' = bookable
            ? 'OPEN'
            : dateSlots.some((s) => s.status === 'LOCKED' || s.status === 'LOCKING')
              ? 'LOCKED'
              : openBeforeCutoff.length > 0
                ? 'FULL'
                : 'CLOSED';

          const metricSlots = openBeforeCutoff.length > 0 ? openBeforeCutoff : dateSlots;
          const capacityWeightKg = Number(
            metricSlots.reduce((acc, s) => acc + s.capacityWeightKg, 0).toFixed(2)
          );
          const capacityVolumeCbm = Number(
            metricSlots.reduce((acc, s) => acc + s.capacityVolumeCbm, 0).toFixed(4)
          );
          const reservedWeightKg = Number(
            metricSlots.reduce((acc, s) => acc + s.reservedWeightKg, 0).toFixed(2)
          );
          const reservedVolumeCbm = Number(
            metricSlots.reduce((acc, s) => acc + s.reservedVolumeCbm, 0).toFixed(4)
          );
          const availableWeightKg = Math.max(0, Number((capacityWeightKg - reservedWeightKg).toFixed(2)));
          const availableVolumeCbm = Math.max(0, Number((capacityVolumeCbm - reservedVolumeCbm).toFixed(4)));
          const maxSinglePoolAvailableWeightKg = Math.max(
            0,
            ...(bookable ? bookableSlots : metricSlots).map((s) => s.availableWeightKg)
          );
          const maxSinglePoolAvailableVolumeCbm = Math.max(
            0,
            ...(bookable ? bookableSlots : metricSlots).map((s) => s.availableVolumeCbm)
          );
          const weightUtilizationPct =
            capacityWeightKg > 0
              ? Math.min(100, Math.round((reservedWeightKg / capacityWeightKg) * 100))
              : 0;
          const volumeUtilizationPct =
            capacityVolumeCbm > 0
              ? Math.min(100, Math.round((reservedVolumeCbm / capacityVolumeCbm) * 100))
              : 0;
          const pooledShipmentCount = dateSlots.reduce(
            (sum, s) => sum + (poolBySlotId.get(String(s._id))?.shipmentIds?.length ?? 0),
            0
          );

          // Representative rate uses the most utilized active slot on this date (consolidatable pool)
          const repSlot = [...metricSlots].sort((a, b) => {
            const utilA = a.capacityWeightKg > 0 ? a.reservedWeightKg / a.capacityWeightKg : 0;
            const utilB = b.capacityWeightKg > 0 ? b.reservedWeightKg / b.capacityWeightKg : 0;
            return utilB - utilA;
          })[0];
          const repWeightPct =
            repSlot && repSlot.capacityWeightKg > 0
              ? (repSlot.reservedWeightKg / repSlot.capacityWeightKg) * 100
              : 0;
          const repVolPct =
            repSlot && repSlot.capacityVolumeCbm > 0
              ? (repSlot.reservedVolumeCbm / repSlot.capacityVolumeCbm) * 100
              : 0;

          const pricePreview = calculateDeterministicPrice({
            chargeableWeightKg: 100,
            baseRatePaisePerKg: c.baseRatePaisePerKg,
            guaranteedCeilingPaisePerKg: c.guaranteedCeilingPaisePerKg,
            weightUtilizationPct: repWeightPct,
            volumeUtilizationPct: repVolPct,
            isAnchorEligible: false,
            rules,
            allowSubsidy: true,
          });

          const earliestCutoffAt = (bookable ? bookableSlots : dateSlots)
            .map((s) => new Date(s.cutoffAt).getTime())
            .sort((a, b) => a - b)[0];

          return {
            serviceDate,
            departureDate: dateSlots[0].departureDate,
            status,
            bookable,
            pooledShipmentCount,
            capacityWeightKg,
            capacityVolumeCbm,
            reservedWeightKg,
            reservedVolumeCbm,
            availableWeightKg,
            availableVolumeCbm,
            maxSinglePoolAvailableWeightKg,
            maxSinglePoolAvailableVolumeCbm,
            weightUtilizationPct,
            volumeUtilizationPct,
            projectedRatePaisePerKg: pricePreview.effectiveRatePaisePerKg,
            cutoffAt: new Date(earliestCutoffAt).toISOString(),
          };
        });

      return {
        _id: c._id,
        code: c.code,
        name: c.name,
        description: c.description,
        stops: c.stops,
        operatingDays: c.operatingDays,
        guaranteedCeilingPaisePerKg: c.guaranteedCeilingPaisePerKg,
        baseRatePaisePerKg: c.baseRatePaisePerKg,
        isActive: c.isActive,
        serviceDates,
        slots: corridorSlots.map((slot) => ({
          _id: slot._id,
          corridorId: slot.corridorId,
          slotNumber: slot.slotNumber,
          slotCode: slot.slotCode,
          label: sanitizeSlotLabelForShipper(slot.label, slot.slotNumber),
          departureDate: slot.departureDate,
          cutoffAt: slot.cutoffAt,
          plannedDepartureAt: slot.plannedDepartureAt,
          capacityWeightKg: slot.capacityWeightKg,
          capacityVolumeCbm: slot.capacityVolumeCbm,
          reservedWeightKg: slot.reservedWeightKg,
          reservedVolumeCbm: slot.reservedVolumeCbm,
          status: slot.status,
          availableWeightKg: slot.availableWeightKg,
          availableVolumeCbm: slot.availableVolumeCbm,
          isPastCutoff: slot.isPastCutoff,
          isFull: slot.isFull,
        })),
      };
    }),
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
    slots: slots.map((slot) => {
      const availableWeightKg = Math.max(0, slot.capacityWeightKg - slot.reservedWeightKg);
      const availableVolumeCbm = Math.max(
        0,
        Number((slot.capacityVolumeCbm - slot.reservedVolumeCbm).toFixed(4))
      );
      return {
        _id: slot._id,
        corridorId: slot.corridorId,
        slotNumber: slot.slotNumber,
        slotCode: slot.slotCode,
        label: sanitizeSlotLabelForShipper(slot.label, slot.slotNumber),
        departureDate: slot.departureDate,
        cutoffAt: slot.cutoffAt,
        plannedDepartureAt: slot.plannedDepartureAt,
        capacityWeightKg: slot.capacityWeightKg,
        capacityVolumeCbm: slot.capacityVolumeCbm,
        reservedWeightKg: slot.reservedWeightKg,
        reservedVolumeCbm: slot.reservedVolumeCbm,
        status: slot.status,
        availableWeightKg,
        availableVolumeCbm,
        isPastCutoff: now >= new Date(slot.cutoffAt),
        isFull: availableWeightKg <= 0 || availableVolumeCbm <= 0,
      };
    }),
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

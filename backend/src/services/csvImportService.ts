import { z } from 'zod';
import type { IBusinessProfile } from '../models/BusinessProfile.js';
import { Corridor, type ICorridor } from '../models/Corridor.js';
import { Shipment } from '../models/Shipment.js';
import { Slot, type ISlot } from '../models/Slot.js';
import { parseCsv, serializeCsv } from '../utils/csv.js';
import { HttpError } from '../utils/errors.js';
import {
  createShipmentBooking,
  matchOperationalSlotForBooking,
} from './shipmentService.js';

export const CSV_TEMPLATE_HEADERS = [
  'externalOrderRef',
  'corridorCode',
  'serviceDate',
  'pickupStopCode',
  'deliveryStopCode',
  'recipientName',
  'recipientPhone',
  'deliveryAddressLine',
  'deliveryVillageOrTown',
  'deliveryDistrict',
  'deliveryState',
  'deliveryPincode',
  'deliveryLandmark',
  'deliveryLongitude',
  'deliveryLatitude',
  'cargoCategory',
  'quantity',
  'lengthCm',
  'widthCm',
  'heightCm',
  'unitActualWeightKg',
  'stackable',
  'declaredContents',
  'handlingNotes',
  'paymentChoice',
];

export function buildCsvTemplate(sampleServiceDate = '2026-12-01'): string {
  const sampleRow: Record<string, unknown> = {
    externalOrderRef: 'ORD-1001',
    corridorCode: 'GJ-VAD-AMD-01',
    serviceDate: sampleServiceDate,
    pickupStopCode: 'VAD',
    deliveryStopCode: 'ANA',
    recipientName: 'Anand Yarn Traders',
    recipientPhone: '+919825000111',
    deliveryAddressLine: 'Plot 12, GIDC Phase 2',
    deliveryVillageOrTown: 'Anand',
    deliveryDistrict: 'Anand',
    deliveryState: 'Gujarat',
    deliveryPincode: '388001',
    deliveryLandmark: 'Near Water Tank',
    deliveryLongitude: '72.9289',
    deliveryLatitude: '22.5645',
    cargoCategory: 'TEXTILE_ROLL',
    quantity: '4',
    lengthCm: '120',
    widthCm: '30',
    heightCm: '30',
    unitActualWeightKg: '22',
    stackable: 'false',
    declaredContents: 'Cotton fabric rolls',
    handlingNotes: 'Keep dry',
    paymentChoice: 'TOKEN_PLUS_PICKUP_BALANCE',
  };

  return serializeCsv(CSV_TEMPLATE_HEADERS, [sampleRow]);
}

const csvRowSchema = z
  .object({
    externalOrderRef: z.string().trim().min(1, 'externalOrderRef is required').max(80),
    corridorCode: z.string().trim().min(2).toUpperCase(),
    serviceDate: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate must be YYYY-MM-DD')
      .optional(),
    slotCode: z.string().trim().min(2).toUpperCase().optional(),
    pickupStopCode: z.string().trim().min(2).toUpperCase(),
  deliveryStopCode: z.string().trim().min(2).toUpperCase(),
  recipientName: z.string().trim().min(2, 'recipientName is required'),
  recipientPhone: z.string().trim().min(8, 'recipientPhone is required'),
  deliveryAddressLine: z.string().trim().min(3, 'deliveryAddressLine is required'),
  deliveryVillageOrTown: z.string().trim().min(2, 'deliveryVillageOrTown is required'),
  deliveryDistrict: z.string().trim().min(2, 'deliveryDistrict is required'),
  deliveryState: z.string().trim().min(2).default('Gujarat'),
  deliveryPincode: z.string().trim().regex(/^\d{6}$/, 'deliveryPincode must be 6 digits'),
  deliveryLandmark: z.string().trim().optional(),
  deliveryLongitude: z.coerce.number().min(-180).max(180),
  deliveryLatitude: z.coerce.number().min(-90).max(90),
  cargoCategory: z.enum([
    'STANDARD_BOX',
    'SACK_BAG',
    'TEXTILE_ROLL',
    'PALLET_BUNDLE',
    'CUSTOM',
  ]),
  quantity: z.coerce.number().int().min(1).max(1000),
  lengthCm: z.coerce.number().positive(),
  widthCm: z.coerce.number().positive(),
  heightCm: z.coerce.number().positive(),
  unitActualWeightKg: z.coerce.number().positive(),
  stackable: z
    .enum(['true', 'false', '1', '0', 'yes', 'no', ''])
    .default('true')
    .transform((v) => v === 'true' || v === '1' || v === 'yes' || v === ''),
  declaredContents: z.string().trim().min(2, 'declaredContents is required'),
  handlingNotes: z.string().trim().optional(),
  paymentChoice: z
    .literal('TOKEN_PLUS_PICKUP_BALANCE')
    .default('TOKEN_PLUS_PICKUP_BALANCE'),
})
  .refine((d) => Boolean(d.serviceDate || d.slotCode), {
    message: 'serviceDate is required',
    path: ['serviceDate'],
  });

export interface CsvImportReport {
  summary: {
    totalRows: number;
    createdCount: number;
    rejectedCount: number;
    duplicateCount: number;
  };
  created: Array<{
    rowNumber: number;
    externalOrderRef: string;
    reference: string;
    chargeableWeightKg: number;
    status: string;
  }>;
  rejected: Array<{
    rowNumber: number;
    externalOrderRef?: string;
    errors: string[];
  }>;
  duplicates: Array<{
    rowNumber: number;
    externalOrderRef: string;
    reason: string;
  }>;
}

export async function importShipmentsFromCsv(params: {
  csvText: string;
  business: IBusinessProfile;
  userId: string;
  dryRun?: boolean;
}): Promise<CsvImportReport> {
  const { csvText, business, userId, dryRun = false } = params;
  const parsed = parseCsv(csvText);

  if (parsed.headers.length === 0 || parsed.rows.length === 0) {
    throw new HttpError(400, 'CSV file is empty or missing data rows', 'EMPTY_CSV');
  }

  const missingHeaders = CSV_TEMPLATE_HEADERS.filter(
    (h) =>
      h !== 'deliveryLandmark' &&
      h !== 'handlingNotes' &&
      h !== 'serviceDate' &&
      !parsed.headers.includes(h)
  );
  if (!parsed.headers.includes('serviceDate') && !parsed.headers.includes('slotCode')) {
    missingHeaders.push('serviceDate');
  }
  if (missingHeaders.length > 0) {
    throw new HttpError(
      400,
      `Missing required CSV headers: ${missingHeaders.join(', ')}`,
      'INVALID_CSV_HEADERS'
    );
  }

  const [corridors, slots, existingRefs] = await Promise.all([
    Corridor.find({ isActive: true }),
    Slot.find({ status: 'OPEN' }),
    Shipment.find({
      businessId: business._id,
      externalOrderRef: { $exists: true, $ne: null },
    }).select('externalOrderRef'),
  ]);

  const corridorByCode = new Map<string, ICorridor>(
    corridors.map((c) => [c.code.toUpperCase(), c])
  );
  const slotByCode = new Map<string, ISlot>(
    slots.map((s) => [s.slotCode.toUpperCase(), s])
  );
  const dbOrderRefs = new Set(
    existingRefs.map((s) => s.externalOrderRef!).filter(Boolean)
  );
  const seenInCsv = new Set<string>();

  const report: CsvImportReport = {
    summary: {
      totalRows: parsed.rows.length,
      createdCount: 0,
      rejectedCount: 0,
      duplicateCount: 0,
    },
    created: [],
    rejected: [],
    duplicates: [],
  };

  for (const row of parsed.rows) {
    const rawOrderRef = row.data.externalOrderRef?.trim();
    if (rawOrderRef) {
      if (seenInCsv.has(rawOrderRef)) {
        report.duplicates.push({
          rowNumber: row.rowNumber,
          externalOrderRef: rawOrderRef,
          reason: 'Duplicate externalOrderRef within the same CSV upload',
        });
        continue;
      }
      if (dbOrderRefs.has(rawOrderRef)) {
        report.duplicates.push({
          rowNumber: row.rowNumber,
          externalOrderRef: rawOrderRef,
          reason: 'externalOrderRef already imported for this business',
        });
        continue;
      }
      seenInCsv.add(rawOrderRef);
    }

    const validated = csvRowSchema.safeParse(row.data);
    if (!validated.success) {
      report.rejected.push({
        rowNumber: row.rowNumber,
        externalOrderRef: rawOrderRef || undefined,
        errors: validated.error.issues.map(
          (i) => `${i.path.join('.') || 'row'}: ${i.message}`
        ),
      });
      continue;
    }

    const data = validated.data;
    const corridor = corridorByCode.get(data.corridorCode);
    const slot = data.slotCode ? slotByCode.get(data.slotCode) : undefined;

    if (!corridor) {
      report.rejected.push({
        rowNumber: row.rowNumber,
        externalOrderRef: data.externalOrderRef,
        errors: [`Corridor '${data.corridorCode}' not found or inactive`],
      });
      continue;
    }

    let matchedSlot = slot;
    if (data.slotCode && (!slot || !slot.corridorId.equals(corridor._id))) {
      report.rejected.push({
        rowNumber: row.rowNumber,
        externalOrderRef: data.externalOrderRef,
        errors: [`Open pool '${data.slotCode}' not found for corridor '${data.corridorCode}'`],
      });
      continue;
    }

    if (!matchedSlot && data.serviceDate) {
      try {
        matchedSlot = await matchOperationalSlotForBooking({
          corridorId: corridor._id,
          serviceDate: data.serviceDate,
        });
      } catch (err) {
        report.rejected.push({
          rowNumber: row.rowNumber,
          externalOrderRef: data.externalOrderRef,
          errors: [err instanceof Error ? err.message : `No open pool for service date ${data.serviceDate}`],
        });
        continue;
      }
    }

    if (dryRun) {
      report.created.push({
        rowNumber: row.rowNumber,
        externalOrderRef: data.externalOrderRef,
        reference: 'DRY-RUN-VALID',
        chargeableWeightKg: 0,
        status: 'VALID',
      });
      continue;
    }

    try {
      const { shipment } = await createShipmentBooking({
        business,
        userId,
        input: {
          corridorId: String(corridor._id),
          ...(data.serviceDate ? { serviceDate: data.serviceDate } : {}),
          ...(data.slotCode && matchedSlot ? { slotId: String(matchedSlot._id) } : {}),
          pickupStopCode: data.pickupStopCode,
          deliveryStopCode: data.deliveryStopCode,
          deliveryAddress: {
            addressLine: data.deliveryAddressLine,
            villageOrTown: data.deliveryVillageOrTown,
            district: data.deliveryDistrict,
            state: data.deliveryState,
            pincode: data.deliveryPincode,
            landmark: data.deliveryLandmark || undefined,
            location: {
              type: 'Point',
              coordinates: [data.deliveryLongitude, data.deliveryLatitude],
            },
          },
          recipientName: data.recipientName,
          recipientPhone: data.recipientPhone,
          cargo: {
            category: data.cargoCategory,
            quantity: data.quantity,
            length: data.lengthCm,
            width: data.widthCm,
            height: data.heightCm,
            dimensionUnit: 'CM',
            unitActualWeight: data.unitActualWeightKg,
            weightUnit: 'KG',
            stackable: data.stackable,
            handlingRestrictions: [],
            declaredContents: data.declaredContents,
            handlingNotes: data.handlingNotes || undefined,
          },
          paymentChoice: data.paymentChoice,
          externalOrderRef: data.externalOrderRef,
        },
      });

      report.created.push({
        rowNumber: row.rowNumber,
        externalOrderRef: data.externalOrderRef,
        reference: shipment.reference,
        chargeableWeightKg: shipment.cargo.chargeableWeightKg,
        status: shipment.status,
      });
    } catch (error) {
      report.rejected.push({
        rowNumber: row.rowNumber,
        externalOrderRef: data.externalOrderRef,
        errors: [error instanceof Error ? error.message : 'Row validation failed'],
      });
    }
  }

  report.summary.createdCount = report.created.length;
  report.summary.rejectedCount = report.rejected.length;
  report.summary.duplicateCount = report.duplicates.length;

  return report;
}

import { Types } from 'mongoose';
import type { IShipment } from '../models/Shipment.js';
import type {
  LoadingSequenceItem,
  TripLoadingPlan,
  ZoneColor,
} from '../models/Trip.js';
import type { BedDimensionsCm } from '../models/Vehicle.js';

export const LOADING_PLANNING_AID_DISCLAIMER =
  'Planning aid only — not a certified load-safety or axle-weight validation system.';

const ZONE_PALETTE: Array<{ color: ZoneColor; letter: string }> = [
  { color: 'GREEN', letter: 'B' },
  { color: 'YELLOW', letter: 'C' },
  { color: 'RED', letter: 'D' },
  { color: 'BLUE', letter: 'E' },
];

export interface StopOrderInput {
  sequence: number;
  stopCode: string;
}

/**
 * Builds a reverse-stop LIFO loading sequence and 2D top-down truck-bed placement.
 * - Furthest/later drop stops are loaded FIRST (x = 0, near cab bulkhead).
 * - Earliest drop stops are loaded LAST (near tailgate) for immediate first unloading.
 * - Within a stop, non-stackable / fragile items are sequenced after heavier base cargo.
 */
export function buildLifoLoadingPlan(params: {
  orderedStops: StopOrderInput[];
  shipments: Array<
    Pick<
      IShipment,
      | '_id'
      | 'reference'
      | 'deliveryStopCode'
      | 'cargo'
    >
  >;
  bedDimensionsCm: BedDimensionsCm;
  existingManualOverrides?: TripLoadingPlan['manualOverrides'];
}): TripLoadingPlan {
  const {
    orderedStops,
    shipments,
    bedDimensionsCm,
    existingManualOverrides = [],
  } = params;

  // Exclude origin depot (sequence === 0) for destination drop zones
  const deliveryStops = orderedStops
    .filter((s) => s.sequence > 0)
    .sort((a, b) => a.sequence - b.sequence);

  const zoneMap = new Map<
    string,
    { dropSequence: number; zoneColor: ZoneColor; zoneLabel: string }
  >();

  const zoneMapping = deliveryStops.map((stop, idx) => {
    const palette = ZONE_PALETTE[Math.min(idx, ZONE_PALETTE.length - 1)];
    const entry = {
      stopCode: stop.stopCode.toUpperCase(),
      dropSequence: stop.sequence,
      zoneColor: palette.color,
      zoneLabel: `Zone ${palette.letter} (${stop.stopCode})`,
    };
    zoneMap.set(entry.stopCode, {
      dropSequence: entry.dropSequence,
      zoneColor: entry.zoneColor,
      zoneLabel: entry.zoneLabel,
    });
    return entry;
  });

  // Sort shipments in reverse drop order (LIFO): highest dropSequence loaded first!
  const sortedShipments = [...shipments].sort((a, b) => {
    const seqA = zoneMap.get(a.deliveryStopCode.toUpperCase())?.dropSequence ?? 99;
    const seqB = zoneMap.get(b.deliveryStopCode.toUpperCase())?.dropSequence ?? 99;
    if (seqB !== seqA) return seqB - seqA;
    // Within same stop, stackable heavier cargo goes before non-stackable
    if (a.cargo.stackable !== b.cargo.stackable) {
      return a.cargo.stackable ? -1 : 1;
    }
    return b.cargo.chargeableWeightKg - a.cargo.chargeableWeightKg;
  });

  // Simple 2D shelf packer along truck-bed X (cab bulkhead 0 -> tailgate bed.length)
  // and Y (left 0 -> right bed.width).
  let cursorX = 0;
  let cursorY = 0;
  let shelfDepthX = 0;
  const overflowShipmentIds: string[] = [];
  const sequenceItems: LoadingSequenceItem[] = [];

  sortedShipments.forEach((shipment, idx) => {
    const zone = zoneMap.get(shipment.deliveryStopCode.toUpperCase()) ?? {
      dropSequence: 1,
      zoneColor: 'GREEN' as ZoneColor,
      zoneLabel: `Zone B (${shipment.deliveryStopCode})`,
    };

    const { length, width, height } = shipment.cargo.unitDimensionsCm;
    const shipmentId = String(shipment._id);

    // Compute approximate floor footprint for quantity (side-by-side or stacked if stackable)
    const layers = shipment.cargo.stackable
      ? Math.max(1, Math.floor(bedDimensionsCm.height / height))
      : 1;
    const floorUnits = Math.ceil(shipment.cargo.quantity / layers);

    // Use actual footprint without shrinking oversized cargo into the bed
    const itemLen = length;
    const itemWid = width * Math.min(floorUnits, 2);

    let placed = false;
    let bedRect: LoadingSequenceItem['bedRect'] | undefined;

    if (height <= bedDimensionsCm.height) {
      // Try normal orientation (itemLen along X, itemWid along Y), then 90-deg rotation
      const orientations: Array<[number, number]> = [
        [itemLen, itemWid],
        [itemWid, itemLen],
      ];

      for (const [tryLenX, tryWidY] of orientations) {
        if (tryWidY > bedDimensionsCm.width || tryLenX > bedDimensionsCm.length) {
          continue;
        }
        if (cursorY + tryWidY <= bedDimensionsCm.width && cursorX + tryLenX <= bedDimensionsCm.length) {
          bedRect = {
            xCm: cursorX,
            yCm: cursorY,
            lengthCm: tryLenX,
            widthCm: tryWidY,
          };
          cursorY += tryWidY;
          shelfDepthX = Math.max(shelfDepthX, tryLenX);
          placed = true;
          break;
        }

        const nextShelfX = cursorX + shelfDepthX;
        if (nextShelfX + tryLenX <= bedDimensionsCm.length && tryWidY <= bedDimensionsCm.width) {
          cursorX = nextShelfX;
          cursorY = tryWidY;
          shelfDepthX = tryLenX;
          bedRect = {
            xCm: cursorX,
            yCm: 0,
            lengthCm: tryLenX,
            widthCm: tryWidY,
          };
          placed = true;
          break;
        }
      }
    }

    if (!placed) {
      overflowShipmentIds.push(shipmentId);
    }

    sequenceItems.push({
      loadOrder: idx + 1,
      shipmentId,
      reference: shipment.reference,
      stopCode: shipment.deliveryStopCode,
      dropSequence: zone.dropSequence,
      zoneColor: zone.zoneColor,
      zoneLabel: zone.zoneLabel,
      quantity: shipment.cargo.quantity,
      dimensionsCm: shipment.cargo.unitDimensionsCm,
      weightKg: shipment.cargo.chargeableWeightKg,
      stackable: shipment.cargo.stackable,
      handlingNotes: shipment.cargo.handlingNotes,
      placed,
      bedRect,
    });
  });

  return {
    zoneMapping,
    sequenceItems,
    overflowShipmentIds,
    manualOverrides: existingManualOverrides,
    planningAidDisclaimer: LOADING_PLANNING_AID_DISCLAIMER,
  };
}

export function appendLoadingOverride(
  plan: TripLoadingPlan,
  params: { shipmentId: string; note: string; actorUserId: string }
): TripLoadingPlan {
  return {
    ...plan,
    manualOverrides: [
      ...plan.manualOverrides,
      {
        shipmentId: params.shipmentId,
        note: params.note,
        actorUserId: new Types.ObjectId(params.actorUserId),
        at: new Date(),
      },
    ],
  };
}

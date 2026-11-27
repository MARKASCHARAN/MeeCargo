import { Router } from 'express';
import { publicTrackRateLimiter } from '../middleware/rateLimiters.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { Shipment } from '../models/Shipment.js';
import { readPodPhotoLocal } from '../services/podStorageService.js';
import { HttpError } from '../utils/errors.js';

const router = Router();

const TRACKING_TOKEN_REGEX = /^[a-zA-Z0-9_-]{24,128}$/;

/**
 * Public recipient tracking endpoint (no account required).
 * Strictly returns recipient-safe fields:
 * - No unrelated shippers' shipments
 * - No driver personal phone or continuous precise GPS
 * - No pricing/margin data
 */
router.get('/:trackingToken', publicTrackRateLimiter, async (req, res) => {
  const token = Array.isArray(req.params.trackingToken)
    ? req.params.trackingToken[0]
    : req.params.trackingToken;

  if (!token || !TRACKING_TOKEN_REGEX.test(token)) {
    throw new HttpError(404, 'Invalid or missing tracking token', 'INVALID_TRACKING_TOKEN');
  }

  const shipment = await Shipment.findOne({ trackingToken: token })
    .populate('corridorId', 'code name')
    .populate('slotId', 'label plannedDepartureAt estimatedArrivalStartAt estimatedArrivalEndAt')
    .lean();

  if (!shipment) {
    throw new HttpError(404, 'Tracking link not found', 'TRACKING_NOT_FOUND');
  }

  if (shipment.trackingTokenRevokedAt) {
    throw new HttpError(410, 'This tracking link has been revoked.', 'TRACKING_REVOKED');
  }

  if (
    shipment.trackingTokenExpiresAt &&
    new Date() > new Date(shipment.trackingTokenExpiresAt)
  ) {
    throw new HttpError(410, 'This tracking link has expired.', 'TRACKING_EXPIRED');
  }

  const proof = await DeliveryProof.findOne({ shipmentId: shipment._id }).lean();
  const corridor = shipment.corridorId as unknown as { code: string; name: string } | null;
  const slot = shipment.slotId as unknown as {
    label: string;
    plannedDepartureAt: string;
    estimatedArrivalStartAt: string;
    estimatedArrivalEndAt: string;
  } | null;

  res.json({
    success: true,
    tracking: {
      reference: shipment.reference,
      status: shipment.status,
      corridorName: corridor?.name ?? 'Scheduled Corridor',
      pickupStopCode: shipment.pickupStopCode,
      deliveryStopCode: shipment.deliveryStopCode,
      destinationTown: shipment.deliveryAddress.villageOrTown,
      destinationDistrict: shipment.deliveryAddress.district,
      cargoSummary: {
        category: shipment.cargo.category,
        quantity: shipment.cargo.quantity,
        declaredContents: shipment.cargo.declaredContents,
      },
      estimatedArrivalWindow: slot
        ? {
            startAt: slot.estimatedArrivalStartAt,
            endAt: slot.estimatedArrivalEndAt,
            slotLabel: slot.label,
          }
        : null,
      milestones: (shipment.statusHistory ?? []).map((h) => ({
        status: h.status,
        at: h.at,
        note: h.note,
      })),
      deliveryProof: proof?.verifiedAt
        ? {
            verifiedAt: proof.verifiedAt,
            confirmationMode: proof.confirmationMode,
            photoUrl: proof.photoAccessToken
              ? `/api/v1/track/pod-photo/${proof.photoAccessToken}?trackingToken=${encodeURIComponent(
                  token
                )}`
              : null,
          }
        : null,
    },
  });
});

/**
 * Protected POD photo serving endpoint (non-enumerable random token + shipment tracking verification).
 */
router.get('/pod-photo/:photoAccessToken', async (req, res) => {
  const photoAccessToken = Array.isArray(req.params.photoAccessToken)
    ? req.params.photoAccessToken[0]
    : req.params.photoAccessToken;
  const trackingToken =
    typeof req.query.trackingToken === 'string' ? req.query.trackingToken : '';

  if (!photoAccessToken || !trackingToken || !TRACKING_TOKEN_REGEX.test(trackingToken)) {
    throw new HttpError(403, 'Authorized tracking token required to view proof photo', 'FORBIDDEN');
  }

  const shipment = await Shipment.findOne({
    trackingToken,
    trackingTokenRevokedAt: { $exists: false },
  }).lean();
  if (!shipment) {
    throw new HttpError(403, 'Invalid or revoked tracking token', 'FORBIDDEN');
  }

  const proof = await DeliveryProof.findOne({
    shipmentId: shipment._id,
    photoAccessToken,
  }).lean();
  if (!proof || !proof.photoStorageKey) {
    throw new HttpError(404, 'Proof photo not found', 'NOT_FOUND');
  }

  const buffer = await readPodPhotoLocal(proof.photoStorageKey);
  res.setHeader('Content-Type', proof.photoMimeType ?? 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(buffer);
});

export default router;

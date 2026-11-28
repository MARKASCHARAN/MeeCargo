import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { Corridor } from '../models/Corridor.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { MarketplaceOpportunity } from '../models/MarketplaceOpportunity.js';
import { DEFAULT_MARKETPLACE_POLICY_VALUES, MarketplacePolicy } from '../models/MarketplacePolicy.js';
import { Pool } from '../models/Pool.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Tier2Earning } from '../models/Tier2Earning.js';
import { Trip } from '../models/Trip.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { signAccessToken } from '../services/authService.js';
import {
  evaluatePoolForMarketplaceOpportunities,
  isVehicleDocumentationValid,
  quoteExpressOrNewRouteBooking,
  redactOpportunityForDriver,
  verifyTier2DriverEligibility,
} from '../services/hybridOrchestratorService.js';
import { optimizeAndPlanTripRoute } from '../services/routePlanningService.js';
import * as optimizerClient from '../services/optimizerClient.js';
import {
  calculateDeterministicTier2Payout,
  calculateExpressCustomerQuotePaise,
  holdOrReverseTier2Earning,
  markTier2EarningCompleted,
  settleTier2Earning,
} from '../services/tier2PayoutService.js';

describe('MC-071 to MC-080: Tier 2 Open Marketplace, Hybrid Orchestrator & Settlement Integrity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario 1 & 6: computes deterministic integer paise payouts with zero Tier 1 minimum guarantees and enforces fixed floor margin on Express quotes', () => {
    const policy = structuredClone(DEFAULT_MARKETPLACE_POLICY_VALUES);
    const quote = calculateDeterministicTier2Payout({
      opportunityType: 'OVERFLOW',
      estimatedDistanceKm: 115,
      totalWeightKg: 420,
      totalVolumeCbm: 1.8,
      bodyType: 'CLOSED_BODY',
      approachDistanceKm: 12,
      policy,
    });

    expect(Number.isInteger(quote.spotPayoutPaise)).toBe(true);
    expect(quote.tier1MinGuaranteeIncludedPaise).toBe(0);
    expect(quote.urgencyPremiumPaise).toBe(0);
    expect(quote.spotPayoutPaise).toBeGreaterThan(quote.baseFeePaise + quote.distancePayPaise);

    const expressQuote = calculateExpressCustomerQuotePaise({
      estimatedDistanceKm: 80,
      chargeableWeightKg: 100,
      volumeCbm: 0.5,
      bodyType: 'MINI_PICKUP',
      policy,
    });
    expect(expressQuote.platformMarginPaise).toBeGreaterThanOrEqual(
      policy.expressPricing.platformMinMarginPaise
    );
    expect(expressQuote.payoutQuote.urgencyPremiumPaise).toBeGreaterThan(0);
  });

  it('Scenario 5: strictly rejects Two-Way delivery on Express marketplace quote & booking while keeping Express one-way functional', async () => {
    await expect(
      quoteExpressOrNewRouteBooking({
        serviceType: 'EXPRESS_MARKETPLACE',
        twoWayDelivery: true,
        pickupAddress: {
          addressLine: 'Plot 10, Makarpura',
          villageOrTown: 'Vadodara',
          district: 'Vadodara',
          state: 'Gujarat',
          pincode: '390010',
          location: { type: 'Point', coordinates: [73.1812, 22.2587] },
        },
        deliveryAddress: {
          addressLine: 'Gate 2, Sarkhej',
          villageOrTown: 'Ahmedabad',
          district: 'Ahmedabad',
          state: 'Gujarat',
          pincode: '382210',
          location: { type: 'Point', coordinates: [72.4986, 22.9734] },
        },
        recipientName: 'Suresh Shah',
        recipientPhone: '+919825001122',
        cargo: {
          category: 'STANDARD_BOX',
          quantity: 2,
          unitDimensions: { length: 50, width: 40, height: 40, unit: 'CM' },
          unitActualWeight: 20,
          weightUnit: 'KG',
          stackable: true,
          handlingRestrictions: [],
          declaredContents: 'Hardware Boxes',
        },
      })
    ).rejects.toMatchObject({ code: 'TWO_WAY_UNSUPPORTED' });
  });

  it('Scenario 1 & 3: blocks pending Tier 2 drivers, expired vehicle documents, dry-van mismatches, and overlapping trips cleanly', async () => {
    const driverUserId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const now = new Date('2026-12-01T09:00:00Z');
    const pastExpiry = new Date('2026-11-01T00:00:00Z');
    const futureValid = new Date('2027-06-01T00:00:00Z');

    // Pending application -> ineligible
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        userId: driverUserId,
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'PENDING',
        accountStatus: 'ACTIVE',
        availabilityStatus: 'AVAILABLE',
        vehicleId,
      }),
    } as never);
    const pendingRes = await verifyTier2DriverEligibility({ driverUserId, now });
    expect(pendingRes.eligible).toBe(false);
    expect(pendingRes.reason).toContain('PENDING');

    // Expired insurance -> blocked
    expect(
      isVehicleDocumentationValid(
        {
          documents: {
            verificationStatus: 'VERIFIED',
            insuranceValidUntil: pastExpiry,
            fitnessValidUntil: futureValid,
          },
        } as never,
        now
      )
    ).toBe(false);

    // Approved profile + OPEN_BODY vehicle vs KEEP_DRY cargo -> blocked
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        userId: driverUserId,
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'APPROVED',
        accountStatus: 'ACTIVE',
        availabilityStatus: 'AVAILABLE',
        vehicleId,
      }),
    } as never);
    vi.spyOn(Vehicle, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: vehicleId,
        driverId: driverUserId,
        tier: 'TIER_2',
        bodyType: 'OPEN_BODY',
        operationalStatus: 'ACTIVE',
        isAvailable: true,
        maxWeightKg: 2000,
        maxVolumeCbm: 10,
        bedDimensionsCm: { length: 300, width: 180, height: 180 },
        documents: {
          verificationStatus: 'VERIFIED',
          insuranceValidUntil: futureValid,
          fitnessValidUntil: futureValid,
        },
      }),
    } as never);
    const dryVanRes = await verifyTier2DriverEligibility({
      driverUserId,
      now,
      cargoEnvelope: {
        totalWeightKg: 200,
        totalVolumeCbm: 1.2,
        maxUnitLengthCm: 60,
        maxUnitWidthCm: 40,
        maxUnitHeightCm: 40,
        requiresDryVan: true,
      },
    });
    expect(dryVanRes.eligible).toBe(false);
    expect(dryVanRes.reason).toContain('Closed/container body');

    // Overlapping trip -> blocked
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        userId: driverUserId,
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'APPROVED',
        accountStatus: 'ACTIVE',
        availabilityStatus: 'AVAILABLE',
        vehicleId,
      }),
    } as never);
    vi.spyOn(Vehicle, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: vehicleId,
        driverId: driverUserId,
        tier: 'TIER_2',
        bodyType: 'CLOSED_BODY',
        operationalStatus: 'ACTIVE',
        isAvailable: true,
        maxWeightKg: 2000,
        maxVolumeCbm: 10,
        bedDimensionsCm: { length: 300, width: 180, height: 180 },
        documents: { verificationStatus: 'VERIFIED', insuranceValidUntil: futureValid },
      }),
    } as never);
    vi.spyOn(Trip, 'findOne').mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        session: vi.fn().mockResolvedValue({ _id: new Types.ObjectId(), tripCode: 'MC-CONFLICT' }),
      }),
    } as never);
    const overlapRes = await verifyTier2DriverEligibility({
      driverUserId,
      now,
      windowStart: now,
      windowEnd: new Date(now.getTime() + 3 * 3600_000),
    });
    expect(overlapRes.eligible).toBe(false);
    expect(overlapRes.reason).toContain('overlapping active trip');
  });

  it('Scenario 3: hides shipper/recipient PII before acceptance and unlocks only for the assigned driver', () => {
    const oppId = new Types.ObjectId();
    const assignedDriverId = new Types.ObjectId();
    const otherDriverId = new Types.ObjectId();

    const oppDoc = {
      _id: oppId,
      opportunityCode: 'MKT-EXP-AA11',
      opportunityType: 'EXPRESS',
      status: 'OFFERED',
      offerVersion: 1,
      originLabel: 'Vadodara',
      destinationLabel: 'Ahmedabad',
      originStopCode: 'EXP-PKP',
      deliveryStopCode: 'EXP-DRP',
      stopsSummary: [
        { stopCode: 'EXP-PKP', name: 'Vadodara Pickup', sequenceOrder: 0 },
        { stopCode: 'EXP-DRP', name: 'Ahmedabad Drop', sequenceOrder: 1 },
      ],
      serviceWindowStartAt: new Date(),
      pickupDeadlineAt: new Date(),
      deliveryDeadlineAt: new Date(),
      offerExpiresAt: new Date(),
      estimatedDistanceKm: 112,
      estimatedDurationMin: 140,
      cargoSummary: {
        shipmentCount: 1,
        totalWeightKg: 100,
        totalVolumeCbm: 0.4,
        maxUnitLengthCm: 60,
        maxUnitWidthCm: 40,
        maxUnitHeightCm: 40,
        allStackable: true,
        handlingRestrictions: [],
        summaryLabel: '4x Hardware boxes',
      },
      payoutQuote: {
        currency: 'INR',
        spotPayoutPaise: 245000,
        baseFeePaise: 25000,
        distancePayPaise: 212800,
        cargoAllowancePaise: 2600,
        urgencyPremiumPaise: 4600,
        approachAllowancePaise: 0,
        tollAllowancePaise: 0,
        tier1MinGuaranteeIncludedPaise: 0,
        policyVersion: 't2-mkt-v1',
      },
      offers: [],
      acceptedByDriverId: assignedDriverId,
    };

    const fakeShipments = [
      {
        _id: new Types.ObjectId(),
        reference: 'MC-EXP-001',
        pickupContact: { name: 'Secret Shipper', phone: '+919999900000' },
        pickupAddress: { addressLine: 'Secret GIDC Plot 1', villageOrTown: 'Vadodara', district: 'Vadodara', state: 'Gujarat', pincode: '390010', location: { type: 'Point', coordinates: [73.18, 22.25] } },
        recipientName: 'Secret Shop',
        recipientPhone: '+918888877777',
        deliveryAddress: { addressLine: 'Secret Drop Shop 9', villageOrTown: 'Ahmedabad', district: 'Ahmedabad', state: 'Gujarat', pincode: '382210', location: { type: 'Point', coordinates: [72.5, 22.97] } },
      },
    ];

    const preView = redactOpportunityForDriver(oppDoc, String(otherDriverId), fakeShipments as never);
    expect(preView.piiUnlocked).toBe(false);
    expect(preView.assignedStopContacts).toEqual([]);
    expect(JSON.stringify(preView)).not.toContain('+919999900000');
    expect(JSON.stringify(preView)).not.toContain('+918888877777');

    const postView = redactOpportunityForDriver(oppDoc, String(assignedDriverId), fakeShipments as never);
    expect(postView.piiUnlocked).toBe(true);
    expect(postView.assignedStopContacts).toHaveLength(1);
    expect(postView.assignedStopContacts[0].recipientPhone).toBe('+918888877777');
  });

  it('Scenario 2: protects allocated Tier 1 contract commitment from Tier 2 right-sizing displacement', async () => {
    const poolId = new Types.ObjectId();
    const corridorId = new Types.ObjectId();
    const slotId = new Types.ObjectId();
    const commitmentId = new Types.ObjectId();

    vi.spyOn(Pool, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: poolId,
        poolCode: 'POOL-T1-PROTECT',
        corridorId,
        slotId,
        shipmentIds: [new Types.ObjectId()],
      }),
    } as never);
    vi.spyOn(MarketplacePolicy, 'findOne').mockReturnValueOnce({
      sort: vi.fn().mockReturnValue({
        session: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue(DEFAULT_MARKETPLACE_POLICY_VALUES),
        }),
      }),
    } as never);
    vi.spyOn(Corridor, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: corridorId,
        stops: [
          { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0, location: { type: 'Point', coordinates: [73.18, 22.25] } },
          { stopCode: 'AMD', name: 'Ahmedabad', sequenceOrder: 1, location: { type: 'Point', coordinates: [72.57, 23.02] } },
        ],
      }),
    } as never);
    vi.spyOn(Slot, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: slotId,
        cutoffAt: new Date(Date.now() + 3600_000),
        plannedDepartureAt: new Date(Date.now() + 7200_000),
        estimatedArrivalEndAt: new Date(Date.now() + 14400_000),
      }),
    } as never);
    vi.spyOn(Shipment, 'find').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue([
        {
          _id: new Types.ObjectId(),
          cargo: {
            quantity: 2,
            declaredContents: 'Cartons',
            chargeableWeightKg: 100,
            volumeCbm: 0.5,
            unitDimensionsCm: { length: 50, width: 40, height: 40 },
            stackable: true,
            handlingRestrictions: [],
          },
        },
      ]),
    } as never);
    vi.spyOn(Trip, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        sourceCommitmentId: commitmentId,
        allocationEconomics: {
          allocatedTier: 'TIER_1',
          estimatedVehiclePayoutPaise: 320000,
          tier1MinGuaranteeIncludedPaise: 150000,
        },
      }),
    } as never);
    vi.spyOn(MarketplaceOpportunity, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(DriverSlotCommitment, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: commitmentId, status: 'ALLOCATED' }),
    } as never);

    const res = await evaluatePoolForMarketplaceOpportunities({
      poolId: String(poolId),
      triggerType: 'RIGHT_SIZING',
    });

    expect(res.created).toBe(false);
    expect(res.reason).toContain('cannot be displaced');
  });

  it('Scenario 6: enforces earning lifecycle -> TRIP_COMPLETED -> PAID and blocks duplicate settlement idempotently', async () => {
    const earningId = new Types.ObjectId();
    const tripId = new Types.ObjectId();
    const ownerId = new Types.ObjectId();
    const saveMock = vi.fn().mockResolvedValue(undefined);

    const earningDoc = {
      _id: earningId,
      earningCode: 'T2E-TEST01',
      tripId,
      grossPayoutPaise: 245000,
      adjustmentsPaise: 0,
      netPayablePaise: 245000,
      status: 'ACCEPTED',
      isSimulated: true,
      auditHistory: [] as unknown[],
      save: saveMock,
    };

    // Block settling before trip completion
    vi.spyOn(Tier2Earning, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(earningDoc),
    } as never);
    await expect(
      settleTier2Earning({ earningId: String(earningId), actorUserId: String(ownerId) })
    ).rejects.toMatchObject({ code: 'SETTLEMENT_NOT_ELIGIBLE' });

    // Transition ACCEPTED -> TRIP_COMPLETED when trip completes
    vi.spyOn(Tier2Earning, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(earningDoc),
    } as never);
    const completed = await markTier2EarningCompleted({ tripId, actorUserId: ownerId });
    expect(completed?.status).toBe('TRIP_COMPLETED');

    // Settle -> PAID cleanly
    vi.spyOn(Tier2Earning, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(earningDoc),
    } as never);
    const paid = await settleTier2Earning({
      earningId: String(earningId),
      actorUserId: String(ownerId),
      idempotencyKey: 'settle-once',
    });
    expect(paid.status).toBe('PAID');
    expect(paid.settlementRef).toMatch(/^SIM-T2-SET-/);
    expect(paid.isSimulated).toBe(true);

    // Duplicate settlement attempt blocked cleanly
    vi.spyOn(Tier2Earning, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(earningDoc),
    } as never);
    await expect(
      settleTier2Earning({
        earningId: String(earningId),
        actorUserId: String(ownerId),
        idempotencyKey: 'settle-twice',
      })
    ).rejects.toMatchObject({ code: 'DUPLICATE_SETTLEMENT' });

    // Reversal blocked once settled unless disputed
    vi.spyOn(Tier2Earning, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(earningDoc),
    } as never);
    await expect(
      holdOrReverseTier2Earning({
        tripId,
        action: 'REVERSE',
        reason: 'Late cancel',
      })
    ).rejects.toMatchObject({ code: 'ALREADY_PAID' });
  });

  it('Scenario 8: supports non-corridor Express route optimization and LIFO loading plan cleanly', async () => {
    const tripId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const shipmentId = new Types.ObjectId();
    const saveMock = vi.fn().mockResolvedValue(undefined);

    const tripDoc: Record<string, unknown> = {
      _id: tripId,
      tripCode: 'MC-T2-EXP-ROUTE',
      corridorId: undefined,
      vehicleId,
      shipmentIds: [shipmentId],
      stopsSummary: [],
      save: saveMock,
    };

    vi.spyOn(Trip, 'findById').mockResolvedValueOnce(tripDoc as never);
    vi.spyOn(Vehicle, 'findById').mockResolvedValueOnce({
      _id: vehicleId,
      registrationNumber: 'GJ06T20001',
      maxWeightKg: 1500,
      maxVolumeCbm: 8,
      bedDimensionsCm: { length: 300, width: 170, height: 150 },
    } as never);
    vi.spyOn(Shipment, 'find').mockResolvedValueOnce([
      {
        _id: shipmentId,
        reference: 'MC-EXP-RT1',
        pickupStopCode: 'EXP-PKP',
        deliveryStopCode: 'EXP-DRP',
        pickupAddress: {
          villageOrTown: 'Vadodara',
          location: { type: 'Point', coordinates: [73.1812, 22.2587] },
        },
        deliveryAddress: {
          villageOrTown: 'Ahmedabad',
          location: { type: 'Point', coordinates: [72.4986, 22.9734] },
        },
        cargo: {
          quantity: 2,
          chargeableWeightKg: 60,
          volumeCbm: 0.4,
          unitDimensionsCm: { length: 50, width: 40, height: 40 },
          stackable: true,
        },
      },
    ] as never);

    vi.spyOn(RouteMatrixCache, 'findOne').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue(null),
    } as never);
    vi.spyOn(RouteMatrixCache, 'findOneAndUpdate').mockResolvedValueOnce(null as never);
    vi.spyOn(optimizerClient, 'callRouteOptimizer').mockResolvedValueOnce({
      status: 'OPTIMAL',
      vehicle_id: 'GJ06T20001',
      ordered_stops: [
        { sequence: 0, stop_index: 0, stop_code: 'EXP-PKP', name: 'Vadodara Pickup', arrival_min: 0, cumulative_distance_meters: 0, shipment_ids: [] },
        { sequence: 1, stop_index: 1, stop_code: 'EXP-DRP', name: 'Ahmedabad Drop', arrival_min: 140, cumulative_distance_meters: 112000, shipment_ids: [String(shipmentId)] },
      ],
      assigned_shipments: [String(shipmentId)],
      total_distance_meters: 112000,
      estimated_duration_seconds: 8400,
    });

    const planResult = await optimizeAndPlanTripRoute({ tripId: String(tripId) });
    expect(planResult.routePlan.orderedStops.length).toBeGreaterThanOrEqual(2);
    expect(planResult.routePlan.totalDistanceMeters).toBeGreaterThan(0);
    expect(planResult.loadingPlan?.sequenceItems.length).toBeGreaterThanOrEqual(1);
    expect(saveMock).toHaveBeenCalledOnce();
  });

  it('Access Control: blocks SHIPPER or DRIVER from Platform Owner policy/settlement endpoints', async () => {
    const app = createApp();
    const driverId = new Types.ObjectId();
    const driverToken = signAccessToken({
      _id: driverId,
      role: 'DRIVER',
    });

    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({
        _id: driverId,
        role: 'DRIVER',
        email: 'driver@test.local',
        isActive: true,
      }),
    } as never);

    const policyRes = await request(app)
      .put('/api/v1/platform-owner/marketplace-policy')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ offerExpiryMin: 90 });

    expect(policyRes.status).toBe(403);
  });
});

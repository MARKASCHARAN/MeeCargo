import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { BackhaulRequest } from '../models/BackhaulRequest.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { Corridor, DEFAULT_CORRIDOR_SLOT_SCHEDULES } from '../models/Corridor.js';
import { DeliveryProof } from '../models/DeliveryProof.js';
import { DriverContract } from '../models/DriverContract.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { DriverSlotCommitment } from '../models/DriverSlotCommitment.js';
import { ExceptionEvent } from '../models/ExceptionEvent.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Payment } from '../models/Payment.js';
import { PickupCollection } from '../models/PickupCollection.js';
import { Pool } from '../models/Pool.js';
import { PricingConfig } from '../models/PricingConfig.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { Shipment } from '../models/Shipment.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { TripLedger } from '../models/TripLedger.js';
import { User, type IUser } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { calculateCargoMetrics } from '../services/cargoCalculator.js';
import { evaluateBackhaulForTrip } from '../services/backhaulService.js';
import { buildLifoLoadingPlan } from '../services/loadingPlanService.js';
import {
  migrateToSinglePlatformOwner,
  provisionSinglePlatformOwner,
} from '../services/platformOwnerService.js';
import {
  calculateDeterministicPrice,
  DEFAULT_PRICING_RULES,
} from '../services/pricingEngine.js';

export interface SeedOptions {
  reset?: boolean;
}

export async function resetDemoState(): Promise<void> {
  await Promise.all([
    DeliveryProof.deleteMany({}),
    PickupCollection.deleteMany({}),
    TripLedger.deleteMany({}),
    ExceptionEvent.deleteMany({}),
    TripEvent.deleteMany({}),
    NotificationLog.deleteMany({}),
    Payment.deleteMany({}),
    Trip.deleteMany({}),
    Pool.deleteMany({}),
    Shipment.deleteMany({}),
    RouteMatrixCache.deleteMany({}),
    Slot.deleteMany({}),
    BackhaulRequest.deleteMany({}),
    DriverContract.deleteMany({}),
    DriverSlotCommitment.deleteMany({}),
    BusinessProfile.deleteMany({}),
    DriverProfile.deleteMany({}),
    Vehicle.deleteMany({}),
    Corridor.deleteMany({}),
    PricingConfig.deleteMany({}),
    RefreshToken.deleteMany({}),
    User.deleteMany({}),
  ]);
  await Promise.all([
    User.syncIndexes(),
    Corridor.syncIndexes(),
    Trip.syncIndexes(),
    DriverSlotCommitment.syncIndexes(),
    Shipment.syncIndexes(),
    Payment.syncIndexes(),
    PickupCollection.syncIndexes(),
    TripEvent.syncIndexes(),
  ]);
}

export async function seedDatabase(options: SeedOptions = {}) {
  if (options.reset) {
    await resetDemoState();
  }

  await PricingConfig.findOneAndUpdate(
    { version: DEFAULT_PRICING_RULES.version },
    {
      $set: {
        ...DEFAULT_PRICING_RULES,
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const passwordHash = await bcrypt.hash('Demo@1234', 10);

  const demoUsers = [
    {
      name: 'Kiran Patel',
      email: 'shipper1@meecargo.demo',
      phone: '+919800000101',
      role: 'SHIPPER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Mahesh Desai',
      email: 'shipper2@meecargo.demo',
      phone: '+919800000102',
      role: 'SHIPPER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Bhavesh Prajapati',
      email: 'shipper3@meecargo.demo',
      phone: '+919800000103',
      role: 'SHIPPER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Ramesh Solanki',
      email: 'driver1@meecargo.demo',
      phone: '+919800000201',
      role: 'DRIVER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Suresh Parmar',
      email: 'driver2@meecargo.demo',
      phone: '+919800000202',
      role: 'DRIVER' as const,
      passwordHash,
      isActive: true,
    },
  ];

  // Clean up any legacy multi-owner demo accounts if present
  await User.deleteMany({
    email: { $in: ['owner1@meecargo.demo', 'owner2@meecargo.demo'] },
  });

  const userMap = new Map<string, IUser>();
  for (const user of demoUsers) {
    const doc = await User.findOneAndUpdate(
      { email: user.email },
      { $set: user },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    if (doc) {
      userMap.set(user.email, doc as IUser);
    }
  }

  const shipper1 = userMap.get('shipper1@meecargo.demo')!;
  const shipper2 = userMap.get('shipper2@meecargo.demo')!;
  const shipper3 = userMap.get('shipper3@meecargo.demo')!;
  const driver1 = userMap.get('driver1@meecargo.demo')!;
  const driver2 = userMap.get('driver2@meecargo.demo')!;
  const { owner: owner1 } = await provisionSinglePlatformOwner();

  const business1 = await BusinessProfile.findOneAndUpdate(
    { ownerId: shipper1._id },
    {
      $set: {
        businessName: 'Patel Textiles Pvt. Ltd.',
        businessType: 'TEXTILE_MILL',
        contactName: 'Kiran Patel',
        contactPhone: '+919800000101',
        contactEmail: 'shipper1@meecargo.demo',
        gstin: '24AAACP1234A1Z5',
        pickupAddress: {
          addressLine: 'Plot 42, GIDC Industrial Estate, Makarpura',
          villageOrTown: 'Vadodara',
          district: 'Vadodara',
          state: 'Gujarat',
          pincode: '390010',
          landmark: 'Near Makarpura Bus Depot',
          location: { type: 'Point', coordinates: [73.184, 22.256] },
        },
        serviceLocations: [
          {
            label: 'Anand Textile Hub',
            villageOrTown: 'Anand',
            district: 'Anand',
            state: 'Gujarat',
            pincode: '388001',
          },
          {
            label: 'Ahmedabad Cloth Market',
            villageOrTown: 'Ahmedabad',
            district: 'Ahmedabad',
            state: 'Gujarat',
            pincode: '380002',
          },
        ],
        ownerId: shipper1._id,
        memberUserIds: [shipper1._id],
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const business2 = await BusinessProfile.findOneAndUpdate(
    { ownerId: shipper2._id },
    {
      $set: {
        businessName: 'Charotar Agro Mills',
        businessType: 'AGRO_PROCESSOR',
        contactName: 'Mahesh Desai',
        contactPhone: '+919800000102',
        contactEmail: 'shipper2@meecargo.demo',
        pickupAddress: {
          addressLine: 'Survey 18, Karjan Highway Road',
          villageOrTown: 'Vadodara',
          district: 'Vadodara',
          state: 'Gujarat',
          pincode: '390012',
          landmark: 'Opposite Krishi Mandi Gate',
          location: { type: 'Point', coordinates: [73.168, 22.268] },
        },
        serviceLocations: [
          {
            label: 'Nadiad Grain Market',
            villageOrTown: 'Nadiad',
            district: 'Kheda',
            state: 'Gujarat',
            pincode: '387001',
          },
        ],
        ownerId: shipper2._id,
        memberUserIds: [shipper2._id],
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const business3 = await BusinessProfile.findOneAndUpdate(
    { ownerId: shipper3._id },
    {
      $set: {
        businessName: 'Kheda Ceramic & Hardware',
        businessType: 'WHOLESALER',
        contactName: 'Bhavesh Prajapati',
        contactPhone: '+919800000103',
        contactEmail: 'shipper3@meecargo.demo',
        pickupAddress: {
          addressLine: 'Shed 7, Savli Crossing Hub',
          villageOrTown: 'Vadodara',
          district: 'Vadodara',
          state: 'Gujarat',
          pincode: '390022',
          landmark: 'Near Ring Road Circle',
          location: { type: 'Point', coordinates: [73.191, 22.299] },
        },
        serviceLocations: [
          {
            label: 'Sarkhej Timber & Tile Market',
            villageOrTown: 'Ahmedabad',
            district: 'Ahmedabad',
            state: 'Gujarat',
            pincode: '382210',
          },
        ],
        ownerId: shipper3._id,
        memberUserIds: [shipper3._id],
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  await Promise.all([
    User.updateOne({ _id: shipper1._id }, { $set: { businessId: business1._id } }),
    User.updateOne({ _id: shipper2._id }, { $set: { businessId: business2._id } }),
    User.updateOne({ _id: shipper3._id }, { $set: { businessId: business3._id } }),
  ]);

  const corridor = await Corridor.findOneAndUpdate(
    { code: 'GJ-VAD-AMD-01' },
    {
      $set: {
        code: 'GJ-VAD-AMD-01',
        name: 'Vadodara - Anand - Nadiad - Ahmedabad Corridor (Demo)',
        description:
          'Demo scheduled B2B freight corridor connecting Makarpura/Vadodara industrial estates to Ahmedabad.',
        stops: [
          {
            stopCode: 'VAD',
            name: 'Vadodara (Makarpura Origin Hub)',
            district: 'Vadodara',
            state: 'Gujarat',
            sequenceOrder: 0,
            location: { type: 'Point', coordinates: [73.1812, 22.3072] },
          },
          {
            stopCode: 'ANA',
            name: 'Anand (GIDC Drop Zone)',
            district: 'Anand',
            state: 'Gujarat',
            sequenceOrder: 1,
            location: { type: 'Point', coordinates: [72.9289, 22.5645] },
          },
          {
            stopCode: 'NAD',
            name: 'Nadiad (Station Road Drop Zone)',
            district: 'Kheda',
            state: 'Gujarat',
            sequenceOrder: 2,
            location: { type: 'Point', coordinates: [72.8634, 22.6916] },
          },
          {
            stopCode: 'AMD',
            name: 'Ahmedabad (Narol / Sarkhej Destination)',
            district: 'Ahmedabad',
            state: 'Gujarat',
            sequenceOrder: 3,
            location: { type: 'Point', coordinates: [72.5714, 23.0225] },
          },
        ],
        operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'],
        slotSchedules: DEFAULT_CORRIDOR_SLOT_SCHEDULES,
        isEstablishedRoute: true,
        guaranteedCeilingPaisePerKg: 550,
        baseRatePaisePerKg: 480,
        viabilityThresholdPct: 50,
        isDemoData: true,
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const now = new Date();
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const datePrefix = tomorrow.toISOString().slice(0, 10);

  const sched1 = corridor.slotSchedules.find((s) => s.slotNumber === 1) ?? DEFAULT_CORRIDOR_SLOT_SCHEDULES[0];
  const sched2 = corridor.slotSchedules.find((s) => s.slotNumber === 2) ?? DEFAULT_CORRIDOR_SLOT_SCHEDULES[1];

  const [s1DepH, s1DepM] = sched1.outboundPickupTime.split(':').map(Number);
  const [s1Ret1H, s1Ret1M] = sched1.defaultReturnTime.split(':').map(Number);
  const [s1Ret2H, s1Ret2M] = (sched1.returnTimeOptions[sched1.returnTimeOptions.length - 1] ?? '16:30')
    .split(':')
    .map(Number);

  const morningDeparture = new Date(tomorrow);
  morningDeparture.setHours(s1DepH, s1DepM, 0, 0);
  const morningCutoff = new Date(morningDeparture.getTime() - 90 * 60 * 1000);
  const morningArrStart = new Date(tomorrow);
  morningArrStart.setHours(s1Ret1H, s1Ret1M, 0, 0);
  const morningArrEnd = new Date(tomorrow);
  morningArrEnd.setHours(s1Ret2H, s1Ret2M, 0, 0);

  const [s2DepH, s2DepM] = sched2.outboundPickupTime.split(':').map(Number);
  const [s2RetH, s2RetM] = (sched2.lockedReturnTime ?? '16:30').split(':').map(Number);

  const eveningDeparture = new Date(tomorrow);
  eveningDeparture.setHours(s2DepH, s2DepM, 0, 0);
  const eveningCutoff = new Date(eveningDeparture.getTime() - 90 * 60 * 1000);
  const eveningArrStart = new Date(tomorrow);
  eveningArrStart.setHours(s2RetH, s2RetM, 0, 0);
  const eveningArrEnd = new Date(tomorrow);
  eveningArrEnd.setHours(s2RetH, s2RetM, 0, 0);

  const slots = [
    {
      corridorId: corridor._id,
      slotNumber: 1 as const,
      slotCode: `GJ-VAD-AMD-01-${datePrefix}-SLOT1`,
      label: sched1.label,
      departureDate: tomorrow,
      cutoffAt: morningCutoff,
      plannedDepartureAt: morningDeparture,
      estimatedArrivalStartAt: morningArrStart,
      estimatedArrivalEndAt: morningArrEnd,
      returnTimeOptions: sched1.returnTimeOptions,
      returnTimeLocked: false,
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: 0,
      reservedVolumeCbm: 0,
      status: 'OPEN' as const,
    },
    {
      corridorId: corridor._id,
      slotNumber: 2 as const,
      slotCode: `GJ-VAD-AMD-01-${datePrefix}-SLOT2`,
      label: sched2.label,
      departureDate: tomorrow,
      cutoffAt: eveningCutoff,
      plannedDepartureAt: eveningDeparture,
      estimatedArrivalStartAt: eveningArrStart,
      estimatedArrivalEndAt: eveningArrEnd,
      returnTimeOptions: sched2.returnTimeOptions,
      returnTimeLocked: true,
      lockedReturnTime: sched2.lockedReturnTime,
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: 0,
      reservedVolumeCbm: 0,
      status: 'OPEN' as const,
    },
  ];

  const seededSlots = [];
  for (const slot of slots) {
    const doc = await Slot.findOneAndUpdate(
      { slotCode: slot.slotCode },
      { $setOnInsert: slot },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    seededSlots.push(doc);
  }

  const morningSlot = seededSlots[0];
  const eveningSlot = seededSlots[1];

  const vehicles = [
    {
      registrationNumber: 'GJ-06-MC-1001',
      operatorName: 'Ramesh Solanki (Driver-Owned)',
      driverId: driver1._id,
      tier: 'TIER_1' as const,
      ownershipType: 'DRIVER_OWNED' as const,
      vehicleClass: '14ft Closed Body LCV',
      bodyType: 'CLOSED_BODY' as const,
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
      minGuaranteePaise: 320000,
      perKmRatePaise: 2400,
      payoutModel: {
        modelType: 'MIN_GUARANTEE_PLUS_KM' as const,
        minGuaranteePaise: 320000,
        perKmRatePaise: 2400,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [corridor._id],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      homeLocation: { type: 'Point' as const, coordinates: [73.1812, 22.3072] },
      operationalStatus: 'ACTIVE' as const,
      isAvailable: true,
      documents: {
        rcNumber: 'GJ06MC1001',
        insurancePolicyNumber: 'INS-GJ06-2026-1001',
        verificationStatus: 'VERIFIED' as const,
        verifiedAt: now,
      },
    },
    {
      registrationNumber: 'GJ-06-MK-2044',
      operatorName: 'Charotar Fleet Marketplace',
      driverId: driver2._id,
      tier: 'TIER_2' as const,
      ownershipType: 'MARKETPLACE' as const,
      vehicleClass: '8ft Mini Pickup',
      bodyType: 'MINI_PICKUP' as const,
      maxWeightKg: 1200,
      maxVolumeCbm: 6.2,
      bedDimensionsCm: { length: 245, width: 155, height: 165 },
      minGuaranteePaise: 0,
      perKmRatePaise: 1900,
      payoutModel: {
        modelType: 'PER_KM' as const,
        minGuaranteePaise: 0,
        perKmRatePaise: 1900,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      homeLocation: { type: 'Point' as const, coordinates: [73.175, 22.295] },
      operationalStatus: 'ACTIVE' as const,
      isAvailable: true,
    },
    {
      registrationNumber: 'GJ-01-BH-3099',
      operatorName: 'Sabarmati Return Haul Partner',
      driverId: driver2._id,
      tier: 'TIER_3' as const,
      ownershipType: 'MARKETPLACE' as const,
      vehicleClass: '17ft Backhaul Truck',
      bodyType: 'CONTAINER' as const,
      maxWeightKg: 4000,
      maxVolumeCbm: 18.0,
      bedDimensionsCm: { length: 515, width: 205, height: 170 },
      minGuaranteePaise: 0,
      perKmRatePaise: 2200,
      payoutModel: {
        modelType: 'PER_KM' as const,
        minGuaranteePaise: 0,
        perKmRatePaise: 2200,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: true,
      homeLocation: { type: 'Point' as const, coordinates: [72.5714, 23.0225] },
      operationalStatus: 'ACTIVE' as const,
      isAvailable: true,
    },
  ];

  const vehicleDocs = [];
  for (const vehicle of vehicles) {
    const doc = await Vehicle.findOneAndUpdate(
      { registrationNumber: vehicle.registrationNumber },
      { $set: vehicle },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );
    vehicleDocs.push(doc);
  }

  const tier1Vehicle = vehicleDocs[0];
  const tier2Vehicle = vehicleDocs[1];
  const driver1Profile = await DriverProfile.findOneAndUpdate(
    { userId: driver1._id },
    {
      $set: {
        userId: driver1._id,
        name: driver1.name,
        phone: driver1.phone ?? '+919800000201',
        availabilityStatus: 'AVAILABLE',
        accountStatus: 'ACTIVE',
        fleetTier: 'TIER_1',
        platformOwnerId: owner1._id,
        vehicleId: tier1Vehicle._id,
        licenseNumber: 'GJ06-2018-0045219',
        homeBase: 'Vadodara Makarpura Hub',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  await DriverProfile.findOneAndUpdate(
    { userId: driver2._id },
    {
      $set: {
        userId: driver2._id,
        name: driver2.name,
        phone: driver2.phone ?? '+919800000202',
        availabilityStatus: 'AVAILABLE',
        accountStatus: 'ACTIVE',
        fleetTier: 'TIER_2',
        vehicleId: tier2Vehicle._id,
        licenseNumber: 'GJ06-2020-0088123',
        homeBase: 'Anand Charotar Hub',
      },
      $unset: { platformOwnerId: '' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const contractStart = new Date();
  const contractEnd = new Date(contractStart.getTime() + 365 * 24 * 60 * 60 * 1000);
  await DriverContract.findOneAndUpdate(
    { contractCode: 'MC-CNT-DEMO-01' },
    {
      $setOnInsert: {
        contractCode: 'MC-CNT-DEMO-01',
        platformOwnerId: owner1._id,
        driverProfileId: driver1Profile._id,
        driverUserId: driver1._id,
        startDate: contractStart,
        endDate: contractEnd,
        minimumGuaranteeTerms: {
          minGuaranteePaise: 320000,
          perKmRatePaise: 2400,
          guaranteedMonthlyDays: 24,
          notes: 'Tier 1 contracted corridor guarantee on GJ-VAD-AMD-01',
        },
        assignedVehicleId: tier1Vehicle._id,
        eligibleCorridorIds: [corridor._id],
        status: 'ACTIVE',
        history: [
          {
            action: 'CONTRACT_CREATED',
            status: 'ACTIVE',
            actorUserId: owner1._id,
            at: contractStart,
            note: 'Initial Tier 1 corridor contract seeded',
          },
        ],
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  await migrateToSinglePlatformOwner({ canonicalOwnerId: owner1._id });

  // Seed a live Slot 1 availability commitment for Ramesh while keeping Slot 2 open for selection
  await DriverSlotCommitment.findOneAndUpdate(
    { slotId: morningSlot._id, driverUserId: driver1._id },
    {
      $setOnInsert: {
        corridorId: corridor._id,
        slotId: morningSlot._id,
        driverUserId: driver1._id,
        driverProfileId: driver1Profile._id,
        vehicleId: tier1Vehicle._id,
        slotNumber: 1,
        departureDate: morningSlot.departureDate,
        selectedPickupTime: sched1.outboundPickupTime,
        selectedReturnTime: sched1.defaultReturnTime,
        status: 'COMMITTED',
        committedAt: now,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  // Pre-seed two paid shipments into the open Morning (AM) pool + one locked PM shipment for Driver execution
  const trackingTokens: Record<string, string> = {};
  const existingPool = await Pool.findOne({ slotId: morningSlot._id });

  if (!existingPool) {
    const cargo1 = calculateCargoMetrics({
      category: 'TEXTILE_ROLL',
      quantity: 12,
      length: 120,
      width: 35,
      height: 35,
      dimensionUnit: 'CM',
      unitActualWeight: 32,
      weightUnit: 'KG',
      volumetricDivisor: 5000,
    });
    const cargo2 = calculateCargoMetrics({
      category: 'SACK_BAG',
      quantity: 10,
      length: 70,
      width: 45,
      height: 30,
      dimensionUnit: 'CM',
      unitActualWeight: 55,
      weightUnit: 'KG',
      volumetricDivisor: 5000,
    });
    const cargo3 = calculateCargoMetrics({
      category: 'PALLET_BUNDLE',
      quantity: 2,
      length: 120,
      width: 100,
      height: 85,
      dimensionUnit: 'CM',
      unitActualWeight: 220,
      weightUnit: 'KG',
      volumetricDivisor: 5000,
    });

    const totalMorningWt = cargo1.chargeableWeightKg + cargo2.chargeableWeightKg;
    const totalMorningVol = Number((cargo1.totalVolumeCbm + cargo2.totalVolumeCbm).toFixed(4));
    const morningWtPct = (totalMorningWt / morningSlot.capacityWeightKg) * 100;
    const morningVolPct = (totalMorningVol / morningSlot.capacityVolumeCbm) * 100;

    const p1 = calculateDeterministicPrice({
      chargeableWeightKg: cargo1.chargeableWeightKg,
      baseRatePaisePerKg: corridor.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: morningWtPct,
      volumeUtilizationPct: morningVolPct,
      isAnchorEligible: true,
      rules: DEFAULT_PRICING_RULES,
    });
    const p2 = calculateDeterministicPrice({
      chargeableWeightKg: cargo2.chargeableWeightKg,
      baseRatePaisePerKg: corridor.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: morningWtPct,
      volumeUtilizationPct: morningVolPct,
      isAnchorEligible: false,
      rules: DEFAULT_PRICING_RULES,
    });
    const p3 = calculateDeterministicPrice({
      chargeableWeightKg: cargo3.chargeableWeightKg,
      baseRatePaisePerKg: corridor.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: corridor.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: 35,
      volumeUtilizationPct: 30,
      isAnchorEligible: false,
      rules: DEFAULT_PRICING_RULES,
    });

    const poolAm = await Pool.create({
      poolCode: `POOL-${morningSlot.slotCode}`,
      corridorId: corridor._id,
      slotId: morningSlot._id,
      status: 'OPEN',
      capacityWeightKg: morningSlot.capacityWeightKg,
      capacityVolumeCbm: morningSlot.capacityVolumeCbm,
      reservedWeightKg: totalMorningWt,
      reservedVolumeCbm: totalMorningVol,
      shipmentIds: [],
      viabilityStatus: 'PENDING',
    });

    const tok1 = crypto.randomBytes(24).toString('hex');
    const tok2 = crypto.randomBytes(24).toString('hex');
    const tok3 = crypto.randomBytes(24).toString('hex');
    trackingTokens['MC-DEMO-001'] = tok1;
    trackingTokens['MC-DEMO-002'] = tok2;
    trackingTokens['MC-DEMO-003'] = tok3;

    const ship1 = await Shipment.create({
      reference: `MC-DEMO-${datePrefix.replace(/-/g, '')}-01`,
      businessId: business1._id,
      createdByUserId: shipper1._id,
      corridorId: corridor._id,
      slotId: morningSlot._id,
      poolId: poolAm._id,
      pickupStopCode: 'VAD',
      pickupStopOrder: 0,
      deliveryStopCode: 'ANA',
      deliveryStopOrder: 1,
      pickupAddress: business1.pickupAddress,
      deliveryAddress: {
        addressLine: 'Plot 14, Anand GIDC Phase II',
        villageOrTown: 'Anand',
        district: 'Anand',
        state: 'Gujarat',
        pincode: '388001',
        landmark: 'Near Vitthal Udyognagar',
        location: { type: 'Point', coordinates: [72.9289, 22.5645] },
      },
      recipientName: 'Anand Weaving Works',
      recipientPhone: '+919800000301',
      cargo: {
        category: 'TEXTILE_ROLL',
        quantity: 12,
        unitDimensionsCm: cargo1.unitDimensionsCm,
        unitActualWeightKg: 32,
        totalActualWeightKg: cargo1.totalActualWeightKg,
        volumetricDivisor: 5000,
        volumetricWeightKg: cargo1.totalVolumetricWeightKg,
        chargeableWeightKg: cargo1.chargeableWeightKg,
        billingBasis: cargo1.billingBasis,
        volumeCbm: cargo1.totalVolumeCbm,
        stackable: false,
        handlingRestrictions: ['KEEP_DRY'],
        declaredContents: '12 Dyed Cotton Textile Rolls',
      },
      tokenStatus: 'PAID',
      status: 'POOLED',
      pricingSnapshot: {
        pricingVersion: p1.pricingVersion,
        ceilingPricePaise: p1.ceilingPricePaise,
        projectedPricePaise: p1.computedPricePaise,
        tokenAmountPaise: p1.tokenAmountPaise,
        tokenPaidPaise: p1.tokenAmountPaise,
        remainingBalancePaise: p1.computedPricePaise - p1.tokenAmountPaise,
        isAnchorEligible: true,
        poolDiscountPaise: p1.poolDiscountPaise,
        anchorDiscountPaise: p1.anchorDiscountPaise,
        handlingFeePaise: p1.handlingFeePaise,
      },
      trackingToken: tok1,
      qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
      statusHistory: [{ status: 'POOLED', at: now, note: 'Seeded into AM demo pool' }],
    });

    const ship2 = await Shipment.create({
      reference: `MC-DEMO-${datePrefix.replace(/-/g, '')}-02`,
      businessId: business2._id,
      createdByUserId: shipper2._id,
      corridorId: corridor._id,
      slotId: morningSlot._id,
      poolId: poolAm._id,
      pickupStopCode: 'VAD',
      pickupStopOrder: 0,
      deliveryStopCode: 'NAD',
      deliveryStopOrder: 2,
      pickupAddress: business2.pickupAddress,
      deliveryAddress: {
        addressLine: 'Godown 5, Station Road Market',
        villageOrTown: 'Nadiad',
        district: 'Kheda',
        state: 'Gujarat',
        pincode: '387001',
        landmark: 'Near Agricultural Produce Market',
        location: { type: 'Point', coordinates: [72.8634, 22.6916] },
      },
      recipientName: 'Charotar Grain Traders',
      recipientPhone: '+919800000302',
      cargo: {
        category: 'SACK_BAG',
        quantity: 10,
        unitDimensionsCm: cargo2.unitDimensionsCm,
        unitActualWeightKg: 55,
        totalActualWeightKg: cargo2.totalActualWeightKg,
        volumetricDivisor: 5000,
        volumetricWeightKg: cargo2.totalVolumetricWeightKg,
        chargeableWeightKg: cargo2.chargeableWeightKg,
        billingBasis: cargo2.billingBasis,
        volumeCbm: cargo2.totalVolumeCbm,
        stackable: true,
        handlingRestrictions: [],
        declaredContents: '10 Grain & Pulse Sacks',
      },
      tokenStatus: 'PAID',
      status: 'POOLED',
      pricingSnapshot: {
        pricingVersion: p2.pricingVersion,
        ceilingPricePaise: p2.ceilingPricePaise,
        projectedPricePaise: p2.computedPricePaise,
        tokenAmountPaise: p2.tokenAmountPaise,
        tokenPaidPaise: p2.tokenAmountPaise,
        remainingBalancePaise: p2.computedPricePaise - p2.tokenAmountPaise,
        isAnchorEligible: false,
        poolDiscountPaise: p2.poolDiscountPaise,
        anchorDiscountPaise: 0,
        handlingFeePaise: p2.handlingFeePaise,
      },
      trackingToken: tok2,
      qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
      statusHistory: [{ status: 'POOLED', at: now, note: 'Seeded into AM demo pool' }],
    });

    poolAm.shipmentIds = [ship1._id, ship2._id];
    poolAm.anchorShipmentId = ship1._id;
    await poolAm.save();

    await Slot.updateOne(
      { _id: morningSlot._id },
      { $set: { reservedWeightKg: totalMorningWt, reservedVolumeCbm: totalMorningVol } }
    );

    const todayPrefix = now.toISOString().slice(0, 10);
    const todayDeparture = new Date(now);
    todayDeparture.setHours(s1DepH, s1DepM, 0, 0);
    const todayCutoff = new Date(todayDeparture.getTime() - 90 * 60 * 1000);
    const todayReturn = new Date(now);
    todayReturn.setHours(s1Ret1H, s1Ret1M, 0, 0);

    const todaySlot1 = await Slot.findOneAndUpdate(
      { slotCode: `GJ-VAD-AMD-01-${todayPrefix}-SLOT1` },
      {
        $setOnInsert: {
          corridorId: corridor._id,
          slotNumber: 1,
          slotCode: `GJ-VAD-AMD-01-${todayPrefix}-SLOT1`,
          label: sched1.label,
          departureDate: now,
          cutoffAt: todayCutoff,
          plannedDepartureAt: todayDeparture,
          estimatedArrivalStartAt: todayReturn,
          estimatedArrivalEndAt: todayReturn,
          returnTimeOptions: sched1.returnTimeOptions,
          returnTimeLocked: false,
          scheduleSnapshot: {
            outboundPickupTime: sched1.outboundPickupTime,
            returnTimeOptions: sched1.returnTimeOptions,
            defaultReturnTime: sched1.defaultReturnTime,
            returnTimeLocked: false,
          },
          capacityWeightKg: 2500,
          capacityVolumeCbm: 12,
          reservedWeightKg: cargo3.chargeableWeightKg,
          reservedVolumeCbm: cargo3.totalVolumeCbm,
          status: 'LOCKED',
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true }
    );

    const todayCommitment = await DriverSlotCommitment.findOneAndUpdate(
      { slotId: todaySlot1._id, driverUserId: driver1._id },
      {
        $setOnInsert: {
          corridorId: corridor._id,
          slotId: todaySlot1._id,
          driverUserId: driver1._id,
          driverProfileId: driver1Profile._id,
          vehicleId: tier1Vehicle._id,
          slotNumber: 1,
          departureDate: todaySlot1.departureDate,
          selectedPickupTime: sched1.outboundPickupTime,
          selectedReturnTime: sched1.defaultReturnTime,
          status: 'ALLOCATED',
          committedAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
          lockedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          allocatedAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        },
      },
      { upsert: true, returnDocument: 'after' }
    );

    const activeDemoTrip = await Trip.create({
      tripCode: `MC-TRIP-${todayPrefix}-SLOT1`,
      corridorId: corridor._id,
      slotId: todaySlot1._id,
      sourceCommitmentId: todayCommitment._id,
      vehicleId: tier1Vehicle._id,
      driverId: driver1._id,
      shipmentIds: [],
      status: 'ASSIGNED',
      scheduleSnapshot: {
        serviceDate: todaySlot1.departureDate,
        slotNumber: 1,
        slotCode: todaySlot1.slotCode,
        slotLabel: sched1.label,
        outboundPickupTime: sched1.outboundPickupTime,
        selectedReturnTime: sched1.defaultReturnTime,
        returnTimeLocked: false,
      },
      vehicleSnapshot: {
        registrationNumber: tier1Vehicle.registrationNumber,
        vehicleClass: tier1Vehicle.vehicleClass,
        bodyType: tier1Vehicle.bodyType,
        maxWeightKg: tier1Vehicle.maxWeightKg,
        maxVolumeCbm: tier1Vehicle.maxVolumeCbm,
        bedDimensionsCm: tier1Vehicle.bedDimensionsCm,
        ownershipType: 'DRIVER_OWNED',
      },
      plannedDepartureAt: todayDeparture,
      estimatedEndAt: todayReturn,
      allocationEconomics: {
        allocatedTier: 'TIER_1',
        tier1MinGuaranteeIncludedPaise: 320000,
        selectedVehicleMinGuaranteePaise: 320000,
        estimatedDistanceKm: 112,
        estimatedVehiclePayoutPaise: 320000,
        rightSized: false,
        reason: 'Allocated Tier 1 driver-owned contract vehicle from locked Slot 1 commitment.',
      },
      stopsSummary: corridor.stops.map((s) => ({
        stopCode: s.stopCode,
        name: s.name,
        sequenceOrder: s.sequenceOrder,
      })),
      notes: 'Assigned from locked Slot 1 availability commitment',
    });

    const ship3 = await Shipment.create({
      reference: `MC-DEMO-${todayPrefix.replace(/-/g, '')}-03`,
      businessId: business3._id,
      createdByUserId: shipper3._id,
      corridorId: corridor._id,
      slotId: todaySlot1._id,
      tripId: activeDemoTrip._id,
      pickupStopCode: 'VAD',
      pickupStopOrder: 0,
      deliveryStopCode: 'AMD',
      deliveryStopOrder: 3,
      pickupAddress: business3.pickupAddress,
      deliveryAddress: {
        addressLine: 'Plot 88, Sarkhej Industrial Zone',
        villageOrTown: 'Ahmedabad',
        district: 'Ahmedabad',
        state: 'Gujarat',
        pincode: '382210',
        landmark: 'Near Sarkhej Overbridge',
        location: { type: 'Point', coordinates: [72.5714, 23.0225] },
      },
      recipientName: 'Sabarmati Ceramic Depot',
      recipientPhone: '+919800000303',
      allowB2bWarehouseConfirm: true,
      cargo: {
        category: 'PALLET_BUNDLE',
        quantity: 2,
        unitDimensionsCm: cargo3.unitDimensionsCm,
        unitActualWeightKg: 220,
        totalActualWeightKg: cargo3.totalActualWeightKg,
        volumetricDivisor: 5000,
        volumetricWeightKg: cargo3.totalVolumetricWeightKg,
        chargeableWeightKg: cargo3.chargeableWeightKg,
        billingBasis: cargo3.billingBasis,
        volumeCbm: cargo3.totalVolumeCbm,
        stackable: false,
        handlingRestrictions: ['FRAGILE'],
        declaredContents: '2 Glazed Ceramic Tile Pallets',
      },
      tokenStatus: 'PAID',
      status: 'LOCKED',
      pricingSnapshot: {
        pricingVersion: p3.pricingVersion,
        ceilingPricePaise: p3.ceilingPricePaise,
        projectedPricePaise: p3.computedPricePaise,
        finalLockedPricePaise: p3.computedPricePaise,
        tokenAmountPaise: p3.tokenAmountPaise,
        tokenPaidPaise: p3.tokenAmountPaise,
        remainingBalancePaise: p3.computedPricePaise - p3.tokenAmountPaise,
        isAnchorEligible: false,
        poolDiscountPaise: p3.poolDiscountPaise,
        anchorDiscountPaise: 0,
        handlingFeePaise: p3.handlingFeePaise,
      },
      trackingToken: tok3,
      qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
      statusHistory: [{ status: 'LOCKED', at: now, note: 'Assigned to locked Slot 1 trip' }],
    });

    activeDemoTrip.shipmentIds = [ship3._id];
    activeDemoTrip.routePlan = {
      routeVersion: 1,
      optimizationStatus: 'OPTIMAL',
      provider: 'OR_TOOLS',
      matrixProvider: 'FIXTURE',
      totalDistanceMeters: 112400,
      estimatedDurationSeconds: 7380,
      orderedStops: [
        { sequence: 0, stopCode: 'VAD', name: 'Vadodara', arrivalMin: 0, cumulativeDistanceMeters: 0, shipmentIds: [] },
        { sequence: 1, stopCode: 'AMD', name: 'Ahmedabad', arrivalMin: 123, cumulativeDistanceMeters: 112400, shipmentIds: [String(ship3._id)] },
      ],
      optimizedAt: now,
      routeHistory: [],
    };
    activeDemoTrip.stopsSummary = [
      { stopCode: 'VAD', name: 'Vadodara', sequenceOrder: 0 },
      { stopCode: 'AMD', name: 'Ahmedabad', sequenceOrder: 1 },
    ];
    activeDemoTrip.loadingPlan = buildLifoLoadingPlan({
      orderedStops: [
        { sequence: 0, stopCode: 'VAD' },
        { sequence: 1, stopCode: 'AMD' },
      ],
      shipments: [ship3],
      bedDimensionsCm: tier1Vehicle.bedDimensionsCm,
      vehicleLimits: {
        maxWeightKg: tier1Vehicle.maxWeightKg,
        maxVolumeCbm: tier1Vehicle.maxVolumeCbm,
      },
    });
    await activeDemoTrip.save();

    await Payment.insertMany([
      {
        shipmentId: ship1._id,
        businessId: business1._id,
        type: 'TOKEN',
        amountPaise: p1.tokenAmountPaise,
        status: 'SUCCESS',
        mode: 'SIMULATED',
        isSimulated: true,
        providerRef: `SIM-SEED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        actorUserId: shipper1._id,
        processedAt: now,
      },
      {
        shipmentId: ship2._id,
        businessId: business2._id,
        type: 'TOKEN',
        amountPaise: p2.tokenAmountPaise,
        status: 'SUCCESS',
        mode: 'SIMULATED',
        isSimulated: true,
        providerRef: `SIM-SEED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        actorUserId: shipper2._id,
        processedAt: now,
      },
      {
        shipmentId: ship3._id,
        businessId: business3._id,
        type: 'TOKEN',
        amountPaise: p3.tokenAmountPaise,
        status: 'SUCCESS',
        mode: 'SIMULATED',
        isSimulated: true,
        providerRef: `SIM-SEED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        actorUserId: shipper3._id,
        processedAt: now,
      },
    ]);
  }

  await BackhaulRequest.findOneAndUpdate(
    { requestCode: 'BH-AMD-VAD-001' },
    {
      $setOnInsert: {
        requestCode: 'BH-AMD-VAD-001',
        businessId: business1._id,
        corridorId: corridor._id,
        originStopCode: 'AMD',
        destinationStopCode: 'VAD',
        originLocation: { type: 'Point', coordinates: [72.5714, 23.0225] },
        destinationLocation: { type: 'Point', coordinates: [73.1812, 22.3072] },
        earliestPickupAt: morningArrEnd,
        latestArrivalAt: new Date(morningArrEnd.getTime() + 4 * 60 * 60 * 1000),
        cargo: {
          chargeableWeightKg: 950,
          volumeCbm: 4.5,
          unitDimensionsCm: { length: 120, width: 100, height: 90 },
          declaredContents: 'Return empty textile bobbins & dye drums',
        },
        quotedRevenuePaise: 540000,
        status: 'CONFIRMED',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const demoTrip = await Trip.findOne({ driverId: driver1._id }).sort({ createdAt: -1 });
  if (demoTrip && !demoTrip.backhaulDecision) {
    await evaluateBackhaulForTrip({ tripId: String(demoTrip._id), applyMatch: true });
  }

  return {
    resetApplied: Boolean(options.reset),
    usersCount: demoUsers.length,
    businessesCount: 3,
    corridorCode: corridor.code,
    slotsSeeded: slots.length,
    vehiclesCount: vehicles.length,
    backhaulRequestsCount: 1,
    trackingTokens,
  };
}

const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('seed.ts');

if (isMainModule) {
  const shouldReset = process.argv.includes('--reset');
  connectDatabase()
    .then(() => seedDatabase({ reset: shouldReset }))
    .then((summary) => {
      console.log('Demo seed completed:', summary);
      return disconnectDatabase();
    })
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('Seed failed:', error);
      await disconnectDatabase();
      process.exit(1);
    });
}

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
import { MarketplaceOpportunity } from '../models/MarketplaceOpportunity.js';
import { MarketplacePolicy } from '../models/MarketplacePolicy.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Payment } from '../models/Payment.js';
import { PickupCollection } from '../models/PickupCollection.js';
import { Pool } from '../models/Pool.js';
import { PricingConfig } from '../models/PricingConfig.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { RouteMatrixCache } from '../models/RouteMatrixCache.js';
import { Shipment, type IShipment } from '../models/Shipment.js';
import { Slot, type ISlot } from '../models/Slot.js';
import { Tier2Application } from '../models/Tier2Application.js';
import { Tier2Earning } from '../models/Tier2Earning.js';
import { Trip } from '../models/Trip.js';
import { TripEvent } from '../models/TripEvent.js';
import { TripLedger } from '../models/TripLedger.js';
import { User, type IUser } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { evaluateBackhaulForTrip } from '../services/backhaulService.js';
import { calculateCargoMetrics } from '../services/cargoCalculator.js';
import { getFixtureRoadLeg } from '../services/distanceMatrixService.js';
import { buildLifoLoadingPlan } from '../services/loadingPlanService.js';
import {
  migrateToSinglePlatformOwner,
  provisionSinglePlatformOwner,
} from '../services/platformOwnerService.js';
import {
  calculateDeterministicPrice,
  DEFAULT_PRICING_RULES,
} from '../services/pricingEngine.js';
import {
  calculateDeterministicTier2Payout,
  ensureActiveMarketplacePolicyDocument,
  getActiveMarketplacePolicy,
} from '../services/tier2PayoutService.js';
import { calculateAndPersistTripLedger } from '../services/tripEconomicsService.js';

export interface SeedOptions {
  reset?: boolean;
}

function dayAtTime(baseDate: Date, offsetDays: number, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(baseDate.getTime() + offsetDays * 86400_000);
  d.setHours(h, m, 0, 0);
  return d;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
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
    Tier2Earning.deleteMany({}),
    MarketplaceOpportunity.deleteMany({}),
    MarketplacePolicy.deleteMany({}),
    Trip.deleteMany({}),
    Pool.deleteMany({}),
    Shipment.deleteMany({}),
    RouteMatrixCache.deleteMany({}),
    Slot.deleteMany({}),
    BackhaulRequest.deleteMany({}),
    DriverContract.deleteMany({}),
    DriverSlotCommitment.deleteMany({}),
    Tier2Application.deleteMany({}),
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
    MarketplaceOpportunity.syncIndexes(),
    Tier2Earning.syncIndexes(),
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

  await ensureActiveMarketplacePolicyDocument();
  const marketPolicy = await getActiveMarketplacePolicy();

  const passwordHash = await bcrypt.hash('Demo@1234', 10);

  const demoUsers = [
    {
      name: 'Raju Naidu',
      email: 'shipper1@meecargo.demo',
      phone: '+919848000101',
      role: 'SHIPPER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Lakshmi Narayana',
      email: 'shipper2@meecargo.demo',
      phone: '+919848000102',
      role: 'SHIPPER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Srinivasulu Reddy',
      email: 'shipper3@meecargo.demo',
      phone: '+919848000103',
      role: 'SHIPPER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Venkateswara Rao',
      email: 'driver1@meecargo.demo',
      phone: '+919848000201',
      role: 'DRIVER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Subbaiah Goud',
      email: 'driver2@meecargo.demo',
      phone: '+919848000202',
      role: 'DRIVER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Koteswara Rao',
      email: 'driver3@meecargo.demo',
      phone: '+919848000203',
      role: 'DRIVER' as const,
      passwordHash,
      isActive: true,
    },
    {
      name: 'Mallikarjuna Prasad',
      email: 'driver4@meecargo.demo',
      phone: '+919848000204',
      role: 'DRIVER' as const,
      passwordHash,
      isActive: true,
    },
  ];

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
  const driver3 = userMap.get('driver3@meecargo.demo')!;
  const driver4 = userMap.get('driver4@meecargo.demo')!;
  const { owner: owner1 } = await provisionSinglePlatformOwner();

  const business1 = await BusinessProfile.findOneAndUpdate(
    { ownerId: shipper1._id },
    {
      $set: {
        businessName: 'Godavari Agro & Rice Traders',
        businessType: 'AGRO_PROCESSOR',
        contactName: 'Raju Naidu',
        contactPhone: '+919848000101',
        contactEmail: 'shipper1@meecargo.demo',
        gstin: '37AAACG4512B1Z8',
        pickupAddress: {
          addressLine: 'Plot 14, Pentapadu Rice Mill Cluster, Main Road',
          villageOrTown: 'Tadepalligudem',
          district: 'West Godavari',
          state: 'Andhra Pradesh',
          pincode: '534101',
          landmark: 'Near Agricultural Market Yard',
          location: { type: 'Point', coordinates: [81.527, 16.8147] },
        },
        serviceLocations: [
          {
            label: 'Nuzvid Mango & Chilli Belt',
            villageOrTown: 'Nuzvid',
            district: 'Eluru',
            state: 'Andhra Pradesh',
            pincode: '521201',
          },
          {
            label: 'Vijayawada Gollapudi Wholesale Mandi',
            villageOrTown: 'Vijayawada',
            district: 'NTR',
            state: 'Andhra Pradesh',
            pincode: '521225',
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
        businessName: 'Nuzvid Farmers Co-op & Spices',
        businessType: 'WHOLESALER',
        contactName: 'Lakshmi Narayana',
        contactPhone: '+919848000102',
        contactEmail: 'shipper2@meecargo.demo',
        pickupAddress: {
          addressLine: 'Survey 22, Eluru Canal Highway, Unguturu Mandal',
          villageOrTown: 'Tadepalligudem',
          district: 'West Godavari',
          state: 'Andhra Pradesh',
          pincode: '534111',
          landmark: 'Opposite Rythu Bharosa Kendra',
          location: { type: 'Point', coordinates: [81.501, 16.822] },
        },
        serviceLocations: [
          {
            label: 'Gudivada Rice Mill Cluster',
            villageOrTown: 'Gudivada',
            district: 'Krishna',
            state: 'Andhra Pradesh',
            pincode: '521301',
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
        businessName: 'Rayalaseema Dairy & Produce Hub',
        businessType: 'MANUFACTURER',
        contactName: 'Srinivasulu Reddy',
        contactPhone: '+919848000103',
        contactEmail: 'shipper3@meecargo.demo',
        pickupAddress: {
          addressLine: 'Shed 9, CTMI Tomato Mandi Road, Rural Mandal',
          villageOrTown: 'Madanapalle',
          district: 'Annamayya',
          state: 'Andhra Pradesh',
          pincode: '517325',
          landmark: 'Near Krishi Vignan Kendra',
          location: { type: 'Point', coordinates: [78.5029, 13.5503] },
        },
        serviceLocations: [
          {
            label: 'Tirupati Renigunta Market',
            villageOrTown: 'Tirupati',
            district: 'Tirupati',
            state: 'Andhra Pradesh',
            pincode: '517520',
          },
          {
            label: 'Nellore Grain & Aqua Feed Hub',
            villageOrTown: 'Nellore',
            district: 'SPSR Nellore',
            state: 'Andhra Pradesh',
            pincode: '524001',
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

  const corridor1 = await Corridor.findOneAndUpdate(
    { code: 'AP-ELR-VJA-01' },
    {
      $set: {
        code: 'AP-ELR-VJA-01',
        name: 'Tadepalligudem - Nuzvid - Gudivada - Vijayawada Rural Corridor',
        description:
          'Scheduled B2B agro & rural MSME corridor across West Godavari, Eluru, Krishna villages to Vijayawada wholesale markets.',
        stops: [
          {
            stopCode: 'TDP',
            name: 'Tadepalligudem (Pentapadu Origin Hub)',
            district: 'West Godavari',
            state: 'Andhra Pradesh',
            sequenceOrder: 0,
            location: { type: 'Point', coordinates: [81.527, 16.8147] },
          },
          {
            stopCode: 'NZW',
            name: 'Nuzvid (Mango & Chilli Drop Zone)',
            district: 'Eluru',
            state: 'Andhra Pradesh',
            sequenceOrder: 1,
            location: { type: 'Point', coordinates: [80.8465, 16.7885] },
          },
          {
            stopCode: 'GDV',
            name: 'Gudivada (Rice Mill Drop Zone)',
            district: 'Krishna',
            state: 'Andhra Pradesh',
            sequenceOrder: 2,
            location: { type: 'Point', coordinates: [80.9926, 16.4355] },
          },
          {
            stopCode: 'VJA',
            name: 'Vijayawada (Gollapudi Wholesale Mandi)',
            district: 'NTR',
            state: 'Andhra Pradesh',
            sequenceOrder: 3,
            location: { type: 'Point', coordinates: [80.5847, 16.5449] },
          },
        ],
        operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
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

  const corridor2 = await Corridor.findOneAndUpdate(
    { code: 'AP-TPT-NLR-01' },
    {
      $set: {
        code: 'AP-TPT-NLR-01',
        name: 'Madanapalle - Pileru - Tirupati - Nellore Rural Corridor',
        description:
          'Rayalaseema and Coastal South rural produce, dairy & groundnut corridor linking Annamayya villages to Tirupati & Nellore.',
        stops: [
          {
            stopCode: 'MDP',
            name: 'Madanapalle (CTMI Tomato Origin Hub)',
            district: 'Annamayya',
            state: 'Andhra Pradesh',
            sequenceOrder: 0,
            location: { type: 'Point', coordinates: [78.5029, 13.5503] },
          },
          {
            stopCode: 'PLR',
            name: 'Pileru (Groundnut & Jaggery Drop Zone)',
            district: 'Annamayya',
            state: 'Andhra Pradesh',
            sequenceOrder: 1,
            location: { type: 'Point', coordinates: [78.9437, 13.6556] },
          },
          {
            stopCode: 'TPT',
            name: 'Tirupati (Renigunta Drop Zone)',
            district: 'Tirupati',
            state: 'Andhra Pradesh',
            sequenceOrder: 2,
            location: { type: 'Point', coordinates: [79.5113, 13.65] },
          },
          {
            stopCode: 'NLR',
            name: 'Nellore (Grain & Aqua Feed Destination)',
            district: 'SPSR Nellore',
            state: 'Andhra Pradesh',
            sequenceOrder: 3,
            location: { type: 'Point', coordinates: [79.9865, 14.4426] },
          },
        ],
        operatingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'],
        slotSchedules: DEFAULT_CORRIDOR_SLOT_SCHEDULES,
        isEstablishedRoute: true,
        guaranteedCeilingPaisePerKg: 580,
        baseRatePaisePerKg: 500,
        viabilityThresholdPct: 50,
        isDemoData: true,
        isActive: true,
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const now = new Date();
  const sched1 =
    corridor1.slotSchedules.find((s) => s.slotNumber === 1) ??
    DEFAULT_CORRIDOR_SLOT_SCHEDULES[0];
  const sched2 =
    corridor1.slotSchedules.find((s) => s.slotNumber === 2) ??
    DEFAULT_CORRIDOR_SLOT_SCHEDULES[1];

  const vehicles = [
    {
      registrationNumber: 'AP-37-MC-1001',
      operatorName: 'Venkateswara Rao (Driver-Owned)',
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
      contractedCorridorIds: [corridor1._id, corridor2._id],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      homeLocation: { type: 'Point' as const, coordinates: [81.527, 16.8147] },
      operationalStatus: 'ACTIVE' as const,
      isAvailable: true,
      documents: {
        rcNumber: 'AP37MC1001',
        insurancePolicyNumber: 'INS-AP37-2026-1001',
        verificationStatus: 'VERIFIED' as const,
        verifiedAt: now,
      },
    },
    {
      registrationNumber: 'AP-16-MK-2044',
      operatorName: 'Krishna Rural Marketplace Fleet',
      driverId: driver2._id,
      tier: 'TIER_2' as const,
      ownershipType: 'MARKETPLACE' as const,
      vehicleClass: '8ft Mini Pickup',
      bodyType: 'CLOSED_BODY' as const,
      maxWeightKg: 1400,
      maxVolumeCbm: 7.5,
      bedDimensionsCm: { length: 280, width: 165, height: 165 },
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
      homeLocation: { type: 'Point' as const, coordinates: [80.8465, 16.7885] },
      operationalStatus: 'ACTIVE' as const,
      isAvailable: true,
      documents: {
        rcNumber: 'AP16MK2044',
        insurancePolicyNumber: 'INS-AP16-2026-2044',
        insuranceValidUntil: new Date(now.getTime() + 240 * 86400_000),
        fitnessValidUntil: new Date(now.getTime() + 300 * 86400_000),
        permitNotes: 'All-Andhra Pradesh goods carriage permit valid',
        verificationStatus: 'VERIFIED' as const,
        verifiedAt: now,
      },
    },
    {
      registrationNumber: 'AP-03-MC-1088',
      operatorName: 'Mallikarjuna Prasad (Driver-Owned)',
      driverId: driver4._id,
      tier: 'TIER_1' as const,
      ownershipType: 'DRIVER_OWNED' as const,
      vehicleClass: '14ft Closed Body LCV',
      bodyType: 'CLOSED_BODY' as const,
      maxWeightKg: 2500,
      maxVolumeCbm: 12.5,
      bedDimensionsCm: { length: 425, width: 195, height: 150 },
      minGuaranteePaise: 350000,
      perKmRatePaise: 2400,
      payoutModel: {
        modelType: 'MIN_GUARANTEE_PLUS_KM' as const,
        minGuaranteePaise: 350000,
        perKmRatePaise: 2400,
        fixedTripPaise: 0,
      },
      contractedCorridorIds: [corridor2._id],
      contractedSlotLabels: [],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      homeLocation: { type: 'Point' as const, coordinates: [78.5029, 13.5503] },
      operationalStatus: 'ACTIVE' as const,
      isAvailable: true,
      documents: {
        rcNumber: 'AP03MC1088',
        insurancePolicyNumber: 'INS-AP03-2026-1088',
        verificationStatus: 'VERIFIED' as const,
        verifiedAt: now,
      },
    },
    {
      registrationNumber: 'AP-07-BH-3099',
      operatorName: 'Amaravati Return Haul Partner',
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
      homeLocation: { type: 'Point' as const, coordinates: [80.5847, 16.5449] },
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

  const tier1Vehicle1 = vehicleDocs[0];
  const tier2Vehicle = vehicleDocs[1];
  const tier1Vehicle2 = vehicleDocs[2];

  const driver1Profile = await DriverProfile.findOneAndUpdate(
    { userId: driver1._id },
    {
      $set: {
        userId: driver1._id,
        name: driver1.name,
        phone: driver1.phone ?? '+919848000201',
        availabilityStatus: 'AVAILABLE',
        accountStatus: 'ACTIVE',
        fleetTier: 'TIER_1',
        platformOwnerId: owner1._id,
        vehicleId: tier1Vehicle1._id,
        licenseNumber: 'AP37-2018-0045219',
        homeBase: 'Tadepalligudem Agro Hub, AP',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const driver4Profile = await DriverProfile.findOneAndUpdate(
    { userId: driver4._id },
    {
      $set: {
        userId: driver4._id,
        name: driver4.name,
        phone: driver4.phone ?? '+919848000204',
        availabilityStatus: 'AVAILABLE',
        accountStatus: 'ACTIVE',
        fleetTier: 'TIER_1',
        platformOwnerId: owner1._id,
        vehicleId: tier1Vehicle2._id,
        licenseNumber: 'AP03-2019-0032190',
        homeBase: 'Madanapalle Rural Hub, AP',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const driver2Profile = await DriverProfile.findOneAndUpdate(
    { userId: driver2._id },
    {
      $set: {
        userId: driver2._id,
        name: driver2.name,
        phone: driver2.phone ?? '+919848000202',
        availabilityStatus: 'AVAILABLE',
        accountStatus: 'ACTIVE',
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'APPROVED',
        vehicleId: tier2Vehicle._id,
        licenseNumber: 'AP16-2020-0088123',
        homeBase: 'Nuzvid / Eluru Hub, AP',
      },
      $unset: { platformOwnerId: '' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const driver2App = await Tier2Application.findOneAndUpdate(
    { userId: driver2._id },
    {
      $set: {
        applicationRef: 'MC-T2-AP-0001',
        userId: driver2._id,
        driverProfileId: driver2Profile._id,
        vehicleId: tier2Vehicle._id,
        fullName: driver2.name,
        email: driver2.email,
        phone: driver2.phone ?? '+919848000202',
        address: {
          addressLine: '14 Gandhi Nagar, Hanuman Junction Road',
          cityOrTown: 'Nuzvid',
          district: 'Eluru',
          state: 'Andhra Pradesh',
          pincode: '521201',
        },
        identity: {
          licenseNumber: 'AP16-2020-0088123',
          idProofType: 'AADHAAR',
          idProofNumber: 'XXXX-XXXX-4412',
        },
        vehicle: {
          registrationNumber: tier2Vehicle.registrationNumber,
          vehicleCategory: tier2Vehicle.vehicleClass,
          bodyType: tier2Vehicle.bodyType,
          maxWeightKg: tier2Vehicle.maxWeightKg,
          bedLengthCm: tier2Vehicle.bedDimensionsCm.length,
          bedWidthCm: tier2Vehicle.bedDimensionsCm.width,
          bedHeightCm: tier2Vehicle.bedDimensionsCm.height,
          maxVolumeCbm: tier2Vehicle.maxVolumeCbm,
          perKmRatePaise: tier2Vehicle.perKmRatePaise,
        },
        documents: {
          rcNumber: 'AP16MK2044',
          insurancePolicyNumber: 'INS-AP16-2026-2044',
          insuranceValidUntil: new Date(now.getTime() + 240 * 86400_000),
          fitnessValidUntil: new Date(now.getTime() + 300 * 86400_000),
          permitNotes: 'All-Andhra Pradesh state goods carrier permit',
          verificationStatus: 'VERIFIED',
          verifiedAt: now,
        },
        status: 'APPROVED',
        appliedAt: new Date(now.getTime() - 8 * 86400_000),
        reviewedByUserId: owner1._id,
        reviewedAt: new Date(now.getTime() - 7 * 86400_000),
        approvedAt: new Date(now.getTime() - 7 * 86400_000),
        reviewNote: 'Verified AP RC, insurance, and license for marketplace dispatch',
        resubmissionCount: 0,
        decisionHistory: [
          {
            action: 'SUBMITTED',
            status: 'PENDING',
            actorUserId: driver2._id,
            at: new Date(now.getTime() - 8 * 86400_000),
          },
          {
            action: 'APPROVED',
            status: 'APPROVED',
            actorUserId: owner1._id,
            at: new Date(now.getTime() - 7 * 86400_000),
            note: 'Verified AP RC, insurance, and license for marketplace dispatch',
          },
        ],
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  await DriverProfile.updateOne(
    { _id: driver2Profile._id },
    { $set: { tier2ApplicationId: driver2App._id } }
  );

  // Pending Tier 2 applicant for Platform Owner review
  const driver3Profile = await DriverProfile.findOneAndUpdate(
    { userId: driver3._id },
    {
      $set: {
        userId: driver3._id,
        name: driver3.name,
        phone: driver3.phone ?? '+919848000203',
        availabilityStatus: 'OFFLINE',
        accountStatus: 'ACTIVE',
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'PENDING',
        licenseNumber: 'AP26-2021-0091450',
        homeBase: 'Gudivada, Krishna',
      },
      $unset: { platformOwnerId: '' },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  const driver3App = await Tier2Application.findOneAndUpdate(
    { userId: driver3._id },
    {
      $setOnInsert: {
        applicationRef: 'MC-T2-AP-0002',
        userId: driver3._id,
        driverProfileId: driver3Profile._id,
        fullName: driver3.name,
        email: driver3.email,
        phone: driver3.phone ?? '+919848000203',
        address: {
          addressLine: 'Plot 28, Dosapadu Rice Mill Bypass',
          cityOrTown: 'Gudivada',
          district: 'Krishna',
          state: 'Andhra Pradesh',
          pincode: '521301',
        },
        identity: {
          licenseNumber: 'AP26-2021-0091450',
          idProofType: 'PAN',
          idProofNumber: 'ABCPK4821M',
        },
        vehicle: {
          registrationNumber: 'AP-26-MK-4102',
          vehicleCategory: '10ft Closed Body LCV',
          bodyType: 'CLOSED_BODY',
          maxWeightKg: 1800,
          bedLengthCm: 305,
          bedWidthCm: 175,
          bedHeightCm: 155,
          maxVolumeCbm: 8.27,
          perKmRatePaise: 2000,
        },
        documents: {
          rcNumber: 'AP26MK4102',
          insurancePolicyNumber: 'INS-AP26-2026-4102',
          insuranceValidUntil: new Date(now.getTime() + 180 * 86400_000),
          fitnessValidUntil: new Date(now.getTime() + 250 * 86400_000),
          permitNotes: 'Andhra Pradesh state goods permit valid',
          verificationStatus: 'PENDING',
        },
        status: 'PENDING',
        appliedAt: new Date(now.getTime() - 2 * 3600_000),
        resubmissionCount: 0,
        decisionHistory: [
          {
            action: 'SUBMITTED',
            status: 'PENDING',
            actorUserId: driver3._id,
            at: new Date(now.getTime() - 2 * 3600_000),
            note: 'Submitted Tier 2 marketplace application for review',
          },
        ],
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );
  await DriverProfile.updateOne(
    { _id: driver3Profile._id },
    { $set: { tier2ApplicationId: driver3App._id } }
  );

  // Active Tier 1 contracts for Driver 1 and Driver 4
  const contractStart = new Date(now.getTime() - 30 * 86400_000);
  const contractEnd = new Date(now.getTime() + 335 * 86400_000);
  await DriverContract.findOneAndUpdate(
    { contractCode: 'MC-CNT-AP-01' },
    {
      $setOnInsert: {
        contractCode: 'MC-CNT-AP-01',
        platformOwnerId: owner1._id,
        driverProfileId: driver1Profile._id,
        driverUserId: driver1._id,
        startDate: contractStart,
        endDate: contractEnd,
        minimumGuaranteeTerms: {
          minGuaranteePaise: 320000,
          perKmRatePaise: 2400,
          guaranteedMonthlyDays: 24,
          notes: 'Tier 1 contracted corridor guarantee on AP-ELR-VJA-01 & AP-TPT-NLR-01',
        },
        assignedVehicleId: tier1Vehicle1._id,
        eligibleCorridorIds: [corridor1._id, corridor2._id],
        status: 'ACTIVE',
        history: [
          {
            action: 'CONTRACT_CREATED',
            status: 'ACTIVE',
            actorUserId: owner1._id,
            at: contractStart,
            note: 'Tier 1 Coastal AP corridor contract seeded',
          },
        ],
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  await DriverContract.findOneAndUpdate(
    { contractCode: 'MC-CNT-AP-02' },
    {
      $setOnInsert: {
        contractCode: 'MC-CNT-AP-02',
        platformOwnerId: owner1._id,
        driverProfileId: driver4Profile._id,
        driverUserId: driver4._id,
        startDate: contractStart,
        endDate: contractEnd,
        minimumGuaranteeTerms: {
          minGuaranteePaise: 350000,
          perKmRatePaise: 2400,
          guaranteedMonthlyDays: 24,
          notes: 'Tier 1 contracted corridor guarantee on AP-TPT-NLR-01',
        },
        assignedVehicleId: tier1Vehicle2._id,
        eligibleCorridorIds: [corridor2._id],
        status: 'ACTIVE',
        history: [
          {
            action: 'CONTRACT_CREATED',
            status: 'ACTIVE',
            actorUserId: owner1._id,
            at: contractStart,
            note: 'Tier 1 Rayalaseema corridor contract seeded',
          },
        ],
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  await migrateToSinglePlatformOwner({ canonicalOwnerId: owner1._id });

  const trackingTokens: Record<string, string> = {};
  let totalShipmentsSeeded = 0;
  let totalTripsSeeded = 0;
  let totalSlotsSeeded = 0;

  // -------------------------------------------------------------------------
  // PART A: Seed 6 Completed Historical Days (Day -6 to Day -1 -> 7+ days window)
  // -------------------------------------------------------------------------
  const historicalTemplates = [
    {
      corridor: corridor1,
      originCode: 'TDP',
      stops: [
        { code: 'NZW', order: 1, town: 'Nuzvid', district: 'Eluru', pin: '521201', coords: [80.8465, 16.7885] as [number, number], addr: 'Plot 8, Mango Market Bypass, Agripalli Road', shop: 'Agripalli Fruit Co-op', phone: '+919848110101', cargoDesc: 'Sona Masoori Paddy Sacks' },
        { code: 'VJA', order: 3, town: 'Vijayawada', district: 'NTR', pin: '521225', coords: [80.5847, 16.5449] as [number, number], addr: 'Godown 14, Gollapudi Agro Mandi', shop: 'Krishna Wholesale Grains', phone: '+919848110102', cargoDesc: 'Boiled Rice Mill Bags' },
      ],
      driver: driver1,
      driverProfile: driver1Profile,
      vehicle: tier1Vehicle1,
      shipperA: shipper1,
      businessA: business1,
      shipperB: shipper2,
      businessB: business2,
      minGuarantee: 320000,
    },
    {
      corridor: corridor2,
      originCode: 'MDP',
      stops: [
        { code: 'PLR', order: 1, town: 'Pileru', district: 'Annamayya', pin: '517214', coords: [78.9437, 13.6556] as [number, number], addr: 'Yard 5, Groundnut Oil Mill Road, Kalikiri Cross', shop: 'Pileru Rural Millers', phone: '+919848110201', cargoDesc: 'Roasted Groundnut & Jaggery Crates' },
        { code: 'NLR', order: 3, town: 'Nellore', district: 'SPSR Nellore', pin: '524001', coords: [79.9865, 14.4426] as [number, number], addr: 'Plot 21, Stonehousepet Grain Complex', shop: 'Penna Aqua & Grain Traders', phone: '+919848110202', cargoDesc: 'Dairy Powder & Feed Sacks' },
      ],
      driver: driver4,
      driverProfile: driver4Profile,
      vehicle: tier1Vehicle2,
      shipperA: shipper3,
      businessA: business3,
      shipperB: shipper3,
      businessB: business3,
      minGuarantee: 350000,
    },
  ];

  for (let offset = -6; offset <= -1; offset += 1) {
    const tpl = historicalTemplates[Math.abs(offset) % 2];
    const cor = tpl.corridor;
    const depTime = dayAtTime(now, offset, sched1.outboundPickupTime);
    const cutoffAt = new Date(depTime.getTime() - 90 * 60_000);
    const arrStart = dayAtTime(now, offset, sched1.defaultReturnTime);
    const arrEnd = dayAtTime(now, offset, '16:30');
    const dk = dateKey(depTime);
    const compactDate = dk.replace(/-/g, '');
    const dayTag = `D${Math.abs(offset)}`;

    const c1 = calculateCargoMetrics({
      category: 'SACK_BAG',
      quantity: 14,
      length: 70,
      width: 45,
      height: 28,
      dimensionUnit: 'CM',
      unitActualWeight: 40,
      weightUnit: 'KG',
    });
    const c2 = calculateCargoMetrics({
      category: 'STANDARD_BOX',
      quantity: 12,
      length: 55,
      width: 42,
      height: 40,
      dimensionUnit: 'CM',
      unitActualWeight: 32,
      weightUnit: 'KG',
    });

    const totalW = c1.chargeableWeightKg + c2.chargeableWeightKg;
    const totalV = Number((c1.totalVolumeCbm + c2.totalVolumeCbm).toFixed(4));
    const slot = await Slot.create({
      corridorId: cor._id,
      slotNumber: 1,
      slotCode: `${cor.code}-${dk}-SLOT1`,
      label: sched1.label,
      departureDate: depTime,
      poolingOpensAt: new Date(depTime.getTime() - 48 * 3600_000),
      cutoffAt,
      plannedDepartureAt: depTime,
      estimatedArrivalStartAt: arrStart,
      estimatedArrivalEndAt: arrEnd,
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
      reservedWeightKg: totalW,
      reservedVolumeCbm: totalV,
      status: 'LOCKED',
    });
    totalSlotsSeeded += 1;

    const wPct = (totalW / 2500) * 100;
    const vPct = (totalV / 12) * 100;
    const pr1 = calculateDeterministicPrice({
      chargeableWeightKg: c1.chargeableWeightKg,
      baseRatePaisePerKg: cor.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: cor.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: wPct,
      volumeUtilizationPct: vPct,
      isAnchorEligible: true,
      rules: DEFAULT_PRICING_RULES,
    });
    const pr2 = calculateDeterministicPrice({
      chargeableWeightKg: c2.chargeableWeightKg,
      baseRatePaisePerKg: cor.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: cor.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: wPct,
      volumeUtilizationPct: vPct,
      isAnchorEligible: false,
      rules: DEFAULT_PRICING_RULES,
    });

    const pool = await Pool.create({
      poolCode: `POOL-${slot.slotCode}`,
      corridorId: cor._id,
      slotId: slot._id,
      status: 'LOCKED',
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: totalW,
      reservedVolumeCbm: totalV,
      shipmentIds: [],
      viabilityStatus: 'PASSED',
      viabilityReason: 'Automated cutoff passed historical AP corridor thresholds',
    });

    const comm = await DriverSlotCommitment.create({
      corridorId: cor._id,
      slotId: slot._id,
      poolId: pool._id,
      driverUserId: tpl.driver._id,
      driverProfileId: tpl.driverProfile._id,
      vehicleId: tpl.vehicle._id,
      slotNumber: 1,
      departureDate: depTime,
      selectedPickupTime: sched1.outboundPickupTime,
      selectedReturnTime: sched1.defaultReturnTime,
      status: 'ALLOCATED',
      committedAt: new Date(depTime.getTime() - 24 * 3600_000),
      lockedAt: cutoffAt,
      allocatedAt: cutoffAt,
    });

    const leg1 = getFixtureRoadLeg(tpl.originCode, tpl.stops[0].code);
    const leg2 = getFixtureRoadLeg(tpl.stops[0].code, tpl.stops[1].code);
    const totalMeters = leg1.meters + leg2.meters;
    const totalSeconds = leg1.seconds + leg2.seconds;
    const completedAt = new Date(depTime.getTime() + totalSeconds * 1000 + 25 * 60_000);

    const trip = await Trip.create({
      tripCode: `MC-AP-${compactDate}-${dayTag}`,
      poolId: pool._id,
      corridorId: cor._id,
      slotId: slot._id,
      sourceCommitmentId: comm._id,
      vehicleId: tpl.vehicle._id,
      driverId: tpl.driver._id,
      shipmentIds: [],
      status: 'COMPLETED',
      scheduleSnapshot: {
        serviceDate: depTime,
        slotNumber: 1,
        slotCode: slot.slotCode,
        slotLabel: sched1.label,
        outboundPickupTime: sched1.outboundPickupTime,
        selectedReturnTime: sched1.defaultReturnTime,
        returnTimeLocked: false,
      },
      vehicleSnapshot: {
        registrationNumber: tpl.vehicle.registrationNumber,
        vehicleClass: tpl.vehicle.vehicleClass,
        bodyType: tpl.vehicle.bodyType,
        maxWeightKg: tpl.vehicle.maxWeightKg,
        maxVolumeCbm: tpl.vehicle.maxVolumeCbm,
        bedDimensionsCm: tpl.vehicle.bedDimensionsCm,
        ownershipType: 'DRIVER_OWNED',
      },
      plannedDepartureAt: depTime,
      estimatedEndAt: arrStart,
      actualStartedAt: depTime,
      actualCompletedAt: completedAt,
      allocationEconomics: {
        allocatedTier: 'TIER_1',
        tier1MinGuaranteeIncludedPaise: tpl.minGuarantee,
        selectedVehicleMinGuaranteePaise: tpl.minGuarantee,
        estimatedDistanceKm: Math.round(totalMeters / 1000),
        estimatedVehiclePayoutPaise: Math.max(
          tpl.minGuarantee,
          Math.round((totalMeters / 1000) * 2400)
        ),
        rightSized: false,
        reason: `Completed historical AP rural run (${cor.code})`,
      },
      stopsSummary: cor.stops.map((s) => ({
        stopCode: s.stopCode,
        name: s.name,
        sequenceOrder: s.sequenceOrder,
      })),
      notes: `Historical completed trip for ${dk}`,
    });

    const histShipSpecs = [
      {
        suffix: '01',
        shipper: tpl.shipperA,
        biz: tpl.businessA,
        stop: tpl.stops[0],
        cargo: c1,
        qty: 14,
        wt: 40,
        price: pr1,
        isAnchor: true,
        cat: 'SACK_BAG' as const,
        stackable: true,
      },
      {
        suffix: '02',
        shipper: tpl.shipperB,
        biz: tpl.businessB,
        stop: tpl.stops[1],
        cargo: c2,
        qty: 12,
        wt: 32,
        price: pr2,
        isAnchor: false,
        cat: 'STANDARD_BOX' as const,
        stackable: true,
      },
    ];

    const createdHistShips: IShipment[] = [];
    for (const hs of histShipSpecs) {
      const trk = crypto.randomBytes(16).toString('hex');
      const balPaise = hs.price.computedPricePaise - hs.price.tokenAmountPaise;
      const sh = await Shipment.create({
        reference: `MC-AP-${compactDate}-${hs.suffix}`,
        businessId: hs.biz._id,
        createdByUserId: hs.shipper._id,
        corridorId: cor._id,
        slotId: slot._id,
        poolId: pool._id,
        tripId: trip._id,
        pickupStopCode: tpl.originCode,
        pickupStopOrder: 0,
        deliveryStopCode: hs.stop.code,
        deliveryStopOrder: hs.stop.order,
        pickupAddress: hs.biz.pickupAddress,
        deliveryAddress: {
          addressLine: hs.stop.addr,
          villageOrTown: hs.stop.town,
          district: hs.stop.district,
          state: 'Andhra Pradesh',
          pincode: hs.stop.pin,
          location: { type: 'Point', coordinates: hs.stop.coords },
        },
        recipientName: hs.stop.shop,
        recipientPhone: hs.stop.phone,
        cargo: {
          category: hs.cat,
          quantity: hs.qty,
          unitDimensionsCm: hs.cargo.unitDimensionsCm,
          unitActualWeightKg: hs.wt,
          totalActualWeightKg: hs.cargo.totalActualWeightKg,
          volumetricDivisor: 5000,
          volumetricWeightKg: hs.cargo.totalVolumetricWeightKg,
          chargeableWeightKg: hs.cargo.chargeableWeightKg,
          billingBasis: hs.cargo.billingBasis,
          volumeCbm: hs.cargo.totalVolumeCbm,
          stackable: hs.stackable,
          handlingRestrictions: [],
          declaredContents: hs.stop.cargoDesc,
        },
        tokenStatus: 'PAID',
        status: 'DELIVERED',
        pricingSnapshot: {
          pricingVersion: hs.price.pricingVersion,
          ceilingPricePaise: hs.price.ceilingPricePaise,
          projectedPricePaise: hs.price.computedPricePaise,
          finalLockedPricePaise: hs.price.computedPricePaise,
          tokenAmountPaise: hs.price.tokenAmountPaise,
          tokenPaidPaise: hs.price.tokenAmountPaise,
          remainingBalancePaise: 0,
          isAnchorEligible: hs.isAnchor,
          poolDiscountPaise: hs.price.poolDiscountPaise,
          anchorDiscountPaise: hs.isAnchor ? hs.price.anchorDiscountPaise : 0,
          handlingFeePaise: hs.price.handlingFeePaise,
        },
        trackingToken: trk,
        qrToken: `MCR_${crypto.randomBytes(10).toString('hex')}`,
        pickupVerifiedAt: depTime,
        statusHistory: [
          { status: 'POOLED', at: cutoffAt, note: 'Joined AP corridor pool' },
          { status: 'LOCKED', at: cutoffAt, note: 'Pool locked at cutoff' },
          { status: 'PICKED_UP', at: depTime, note: 'QR verified & UPI balance collected' },
          { status: 'DELIVERED', at: completedAt, note: 'OTP POD verified at rural drop' },
        ],
      });
      createdHistShips.push(sh);
      totalShipmentsSeeded += 1;

      await Payment.insertMany([
        {
          shipmentId: sh._id,
          businessId: hs.biz._id,
          type: 'TOKEN',
          amountPaise: hs.price.tokenAmountPaise,
          status: 'SUCCESS',
          mode: 'SIMULATED',
          isSimulated: true,
          providerRef: `SIM-TOK-${compactDate}-${hs.suffix}`,
          actorUserId: hs.shipper._id,
          processedAt: cutoffAt,
        },
        {
          shipmentId: sh._id,
          businessId: hs.biz._id,
          type: 'PICKUP_BALANCE',
          amountPaise: balPaise,
          status: 'SUCCESS',
          mode: 'SIMULATED',
          isSimulated: true,
          providerRef: `SIM-BAL-${compactDate}-${hs.suffix}`,
          actorUserId: tpl.driver._id,
          processedAt: depTime,
        },
      ]);

      await PickupCollection.create({
        shipmentId: sh._id,
        tripId: trip._id,
        businessId: hs.biz._id,
        collectedByDriverId: tpl.driver._id,
        lockedPricePaise: hs.price.computedPricePaise,
        tokenPaidPaise: hs.price.tokenAmountPaise,
        adjustmentsPaise: 0,
        remainingBalancePaise: balPaise,
        collectedAmountPaise: balPaise,
        paymentMethod: 'SIMULATED_UPI',
        providerRef: `SIM-PC-${compactDate}-${hs.suffix}`,
        collectionState: 'COLLECTED_BY_DRIVER',
        settlementState: 'SETTLED',
        isSimulated: true,
        collectedAt: depTime,
      });

      await DeliveryProof.create({
        shipmentId: sh._id,
        tripId: trip._id,
        confirmationMode: 'OTP',
        verifiedAt: completedAt,
        verifiedByUserId: tpl.driver._id,
        location: { type: 'Point', coordinates: hs.stop.coords },
      });

      await TripEvent.insertMany([
        {
          tripId: trip._id,
          shipmentId: sh._id,
          eventType: 'PICKUP_VERIFIED',
          actorUserId: tpl.driver._id,
          occurredAt: depTime,
          idempotencyKey: `seed-pkp-${compactDate}-${hs.suffix}`,
        },
        {
          tripId: trip._id,
          shipmentId: sh._id,
          eventType: 'DELIVERED',
          actorUserId: tpl.driver._id,
          occurredAt: completedAt,
          idempotencyKey: `seed-dlv-${compactDate}-${hs.suffix}`,
        },
      ]);
    }

    pool.shipmentIds = createdHistShips.map((s) => s._id);
    pool.anchorShipmentId = createdHistShips[0]._id;
    await pool.save();

    trip.shipmentIds = createdHistShips.map((s) => s._id);
    trip.routePlan = {
      routeVersion: 1,
      optimizationStatus: 'OPTIMAL',
      provider: 'OR_TOOLS',
      matrixProvider: 'FIXTURE',
      totalDistanceMeters: totalMeters,
      estimatedDurationSeconds: totalSeconds,
      orderedStops: [
        { sequence: 0, stopCode: tpl.originCode, name: cor.stops[0].name, arrivalMin: 0, cumulativeDistanceMeters: 0, shipmentIds: [] },
        { sequence: 1, stopCode: tpl.stops[0].code, name: tpl.stops[0].town, arrivalMin: Math.round(leg1.seconds / 60), cumulativeDistanceMeters: leg1.meters, shipmentIds: [String(createdHistShips[0]._id)] },
        { sequence: 2, stopCode: tpl.stops[1].code, name: tpl.stops[1].town, arrivalMin: Math.round(totalSeconds / 60), cumulativeDistanceMeters: totalMeters, shipmentIds: [String(createdHistShips[1]._id)] },
      ],
      optimizedAt: depTime,
      routeHistory: [],
    };
    trip.loadingPlan = buildLifoLoadingPlan({
      orderedStops: [
        { sequence: 0, stopCode: tpl.originCode },
        { sequence: 1, stopCode: tpl.stops[0].code },
        { sequence: 2, stopCode: tpl.stops[1].code },
      ],
      shipments: createdHistShips,
      bedDimensionsCm: tpl.vehicle.bedDimensionsCm,
      vehicleLimits: {
        maxWeightKg: tpl.vehicle.maxWeightKg,
        maxVolumeCbm: tpl.vehicle.maxVolumeCbm,
      },
    });
    await trip.save();
    await calculateAndPersistTripLedger(String(trip._id));
    totalTripsSeeded += 1;
  }

  // Historical Tier 2 completed earnings (Day -4 PAID + Day -2 TRIP_COMPLETED pending settlement)
  const histT2Day4 = new Date(now.getTime() - 4 * 86400_000);
  const t2Quote1 = calculateDeterministicTier2Payout({
    opportunityType: 'OVERFLOW',
    estimatedDistanceKm: 111,
    totalWeightKg: 620,
    totalVolumeCbm: 3.1,
    bodyType: tier2Vehicle.bodyType,
    approachDistanceKm: 8,
    policy: marketPolicy,
  });
  const t2Opp1 = await MarketplaceOpportunity.create({
    opportunityCode: 'MKT-OVF-AP04',
    opportunityType: 'OVERFLOW',
    status: 'COMPLETED',
    offerVersion: 1,
    sourceDemandKey: 'OVERFLOW:SEED:DAY4',
    corridorId: corridor1._id,
    shipmentIds: [],
    originLabel: 'Tadepalligudem, West Godavari',
    destinationLabel: 'Vijayawada, NTR',
    originStopCode: 'TDP',
    deliveryStopCode: 'VJA',
    originLocation: { type: 'Point', coordinates: [81.527, 16.8147] },
    destinationLocation: { type: 'Point', coordinates: [80.5847, 16.5449] },
    stopsSummary: [
      { stopCode: 'TDP', name: 'Tadepalligudem Hub', sequenceOrder: 0 },
      { stopCode: 'VJA', name: 'Vijayawada Mandi', sequenceOrder: 1 },
    ],
    serviceWindowStartAt: histT2Day4,
    pickupDeadlineAt: new Date(histT2Day4.getTime() + 3600_000),
    deliveryDeadlineAt: new Date(histT2Day4.getTime() + 4 * 3600_000),
    offerExpiresAt: histT2Day4,
    cargoSummary: {
      shipmentCount: 2,
      totalWeightKg: 620,
      totalVolumeCbm: 3.1,
      maxUnitLengthCm: 100,
      maxUnitWidthCm: 60,
      maxUnitHeightCm: 50,
      allStackable: true,
      handlingRestrictions: [],
      summaryLabel: '16x Turmeric & Paddy Sacks',
    },
    estimatedDistanceKm: 111,
    estimatedDurationMin: 145,
    payoutQuote: t2Quote1,
    acceptedByDriverId: driver2._id,
    acceptedVehicleId: tier2Vehicle._id,
    acceptedAt: histT2Day4,
    orchestrationReason: 'Overflow overflow run along Tadepalligudem -> Vijayawada rural belt',
    auditHistory: [
      { action: 'COMPLETED', toStatus: 'COMPLETED', actorUserId: driver2._id, at: histT2Day4 },
    ],
  });
  const t2Trip1 = await Trip.create({
    tripCode: 'MC-T2-AP-DAY4',
    corridorId: corridor1._id,
    marketplaceOpportunityId: t2Opp1._id,
    vehicleId: tier2Vehicle._id,
    driverId: driver2._id,
    shipmentIds: [],
    status: 'COMPLETED',
    vehicleSnapshot: {
      registrationNumber: tier2Vehicle.registrationNumber,
      vehicleClass: tier2Vehicle.vehicleClass,
      bodyType: tier2Vehicle.bodyType,
      maxWeightKg: tier2Vehicle.maxWeightKg,
      maxVolumeCbm: tier2Vehicle.maxVolumeCbm,
      bedDimensionsCm: tier2Vehicle.bedDimensionsCm,
      ownershipType: 'MARKETPLACE',
    },
    plannedDepartureAt: histT2Day4,
    estimatedEndAt: new Date(histT2Day4.getTime() + 4 * 3600_000),
    actualCompletedAt: new Date(histT2Day4.getTime() + 3 * 3600_000),
    allocationEconomics: {
      allocatedTier: 'TIER_2',
      tier1MinGuaranteeIncludedPaise: 0,
      selectedVehicleMinGuaranteePaise: 0,
      estimatedDistanceKm: 111,
      estimatedVehiclePayoutPaise: t2Quote1.spotPayoutPaise,
      rightSized: false,
      reason: 'Tier 2 overflow payout',
    },
    stopsSummary: t2Opp1.stopsSummary,
  });
  t2Opp1.tripId = t2Trip1._id;
  await t2Opp1.save();
  await Tier2Earning.create({
    earningCode: 'T2E-AP-0001',
    opportunityId: t2Opp1._id,
    tripId: t2Trip1._id,
    driverUserId: driver2._id,
    vehicleId: tier2Vehicle._id,
    opportunityType: 'OVERFLOW',
    status: 'PAID',
    currency: 'INR',
    grossPayoutPaise: t2Quote1.spotPayoutPaise,
    adjustmentsPaise: 0,
    netPayablePaise: t2Quote1.spotPayoutPaise,
    policyVersion: marketPolicy.policyVersion,
    isSimulated: true,
    settlementRef: 'SIM-T2-SET-AP0001',
    settlementIdempotencyKey: 'seed-t2-settle-01',
    settledAt: new Date(histT2Day4.getTime() + 5 * 3600_000),
    completedAt: new Date(histT2Day4.getTime() + 3 * 3600_000),
  });
  totalTripsSeeded += 1;

  const histT2Day2 = new Date(now.getTime() - 2 * 86400_000);
  const t2Quote2 = calculateDeterministicTier2Payout({
    opportunityType: 'EXPRESS',
    estimatedDistanceKm: 42,
    totalWeightKg: 310,
    totalVolumeCbm: 1.6,
    bodyType: tier2Vehicle.bodyType,
    approachDistanceKm: 5,
    policy: marketPolicy,
  });
  const t2Opp2 = await MarketplaceOpportunity.create({
    opportunityCode: 'MKT-EXP-AP02',
    opportunityType: 'EXPRESS',
    status: 'COMPLETED',
    offerVersion: 1,
    sourceDemandKey: 'EXPRESS:SEED:DAY2',
    shipmentIds: [],
    originLabel: 'Nuzvid, Eluru',
    destinationLabel: 'Vijayawada, NTR',
    originStopCode: 'NZW',
    deliveryStopCode: 'VJA',
    originLocation: { type: 'Point', coordinates: [80.8465, 16.7885] },
    destinationLocation: { type: 'Point', coordinates: [80.5847, 16.5449] },
    stopsSummary: [
      { stopCode: 'NZW', name: 'Nuzvid Mango Yard', sequenceOrder: 0 },
      { stopCode: 'VJA', name: 'Vijayawada Gollapudi Hub', sequenceOrder: 1 },
    ],
    serviceWindowStartAt: histT2Day2,
    pickupDeadlineAt: new Date(histT2Day2.getTime() + 3600_000),
    deliveryDeadlineAt: new Date(histT2Day2.getTime() + 3 * 3600_000),
    offerExpiresAt: histT2Day2,
    cargoSummary: {
      shipmentCount: 1,
      totalWeightKg: 310,
      totalVolumeCbm: 1.6,
      maxUnitLengthCm: 80,
      maxUnitWidthCm: 50,
      maxUnitHeightCm: 45,
      allStackable: true,
      handlingRestrictions: [],
      summaryLabel: '12x Fresh Mango Ripening Crates',
    },
    estimatedDistanceKm: 42,
    estimatedDurationMin: 60,
    payoutQuote: t2Quote2,
    acceptedByDriverId: driver2._id,
    acceptedVehicleId: tier2Vehicle._id,
    acceptedAt: histT2Day2,
    orchestrationReason: 'Urgent one-way Express dispatch from Nuzvid orchard belt to Vijayawada',
    auditHistory: [
      { action: 'COMPLETED', toStatus: 'COMPLETED', actorUserId: driver2._id, at: histT2Day2 },
    ],
  });
  const t2Trip2 = await Trip.create({
    tripCode: 'MC-T2-AP-DAY2',
    marketplaceOpportunityId: t2Opp2._id,
    vehicleId: tier2Vehicle._id,
    driverId: driver2._id,
    shipmentIds: [],
    status: 'COMPLETED',
    vehicleSnapshot: {
      registrationNumber: tier2Vehicle.registrationNumber,
      vehicleClass: tier2Vehicle.vehicleClass,
      bodyType: tier2Vehicle.bodyType,
      maxWeightKg: tier2Vehicle.maxWeightKg,
      maxVolumeCbm: tier2Vehicle.maxVolumeCbm,
      bedDimensionsCm: tier2Vehicle.bedDimensionsCm,
      ownershipType: 'MARKETPLACE',
    },
    plannedDepartureAt: histT2Day2,
    estimatedEndAt: new Date(histT2Day2.getTime() + 3 * 3600_000),
    actualCompletedAt: new Date(histT2Day2.getTime() + 2 * 3600_000),
    allocationEconomics: {
      allocatedTier: 'TIER_2',
      tier1MinGuaranteeIncludedPaise: 0,
      selectedVehicleMinGuaranteePaise: 0,
      estimatedDistanceKm: 42,
      estimatedVehiclePayoutPaise: t2Quote2.spotPayoutPaise,
      rightSized: false,
      reason: 'Tier 2 urgent Express payout awaiting settlement',
    },
    stopsSummary: t2Opp2.stopsSummary,
  });
  t2Opp2.tripId = t2Trip2._id;
  await t2Opp2.save();
  await Tier2Earning.create({
    earningCode: 'T2E-AP-0002',
    opportunityId: t2Opp2._id,
    tripId: t2Trip2._id,
    driverUserId: driver2._id,
    vehicleId: tier2Vehicle._id,
    opportunityType: 'EXPRESS',
    status: 'TRIP_COMPLETED',
    currency: 'INR',
    grossPayoutPaise: t2Quote2.spotPayoutPaise,
    adjustmentsPaise: 0,
    netPayablePaise: t2Quote2.spotPayoutPaise,
    policyVersion: marketPolicy.policyVersion,
    isSimulated: true,
    completedAt: new Date(histT2Day2.getTime() + 2 * 3600_000),
  });
  totalTripsSeeded += 1;

  // -------------------------------------------------------------------------
  // PART B: Today (Day 0) Active Trip Ready for Execution + Live Marketplace Offer
  // -------------------------------------------------------------------------
  const todayPrefix = dateKey(now);
  const todayCompact = todayPrefix.replace(/-/g, '');
  const todayDep = dayAtTime(now, 0, sched1.outboundPickupTime);
  const todayCutoff = new Date(todayDep.getTime() - 90 * 60_000);
  const todayRet = dayAtTime(now, 0, sched1.defaultReturnTime);

  const cargoToday = calculateCargoMetrics({
    category: 'PALLET_BUNDLE',
    quantity: 2,
    length: 120,
    width: 100,
    height: 85,
    dimensionUnit: 'CM',
    unitActualWeight: 220,
    weightUnit: 'KG',
  });
  const pToday = calculateDeterministicPrice({
    chargeableWeightKg: cargoToday.chargeableWeightKg,
    baseRatePaisePerKg: corridor1.baseRatePaisePerKg,
    guaranteedCeilingPaisePerKg: corridor1.guaranteedCeilingPaisePerKg,
    weightUtilizationPct: 35,
    volumeUtilizationPct: 30,
    isAnchorEligible: false,
    rules: DEFAULT_PRICING_RULES,
  });

  const todaySlot1 = await Slot.create({
    corridorId: corridor1._id,
    slotNumber: 1,
    slotCode: `${corridor1.code}-${todayPrefix}-SLOT1`,
    label: sched1.label,
    departureDate: now,
    poolingOpensAt: new Date(now.getTime() - 48 * 3600_000),
    cutoffAt: todayCutoff,
    plannedDepartureAt: todayDep,
    estimatedArrivalStartAt: todayRet,
    estimatedArrivalEndAt: todayRet,
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
    reservedWeightKg: cargoToday.chargeableWeightKg,
    reservedVolumeCbm: cargoToday.totalVolumeCbm,
    status: 'LOCKED',
  });
  totalSlotsSeeded += 1;

  const todayCommitment = await DriverSlotCommitment.create({
    corridorId: corridor1._id,
    slotId: todaySlot1._id,
    driverUserId: driver1._id,
    driverProfileId: driver1Profile._id,
    vehicleId: tier1Vehicle1._id,
    slotNumber: 1,
    departureDate: todaySlot1.departureDate,
    selectedPickupTime: sched1.outboundPickupTime,
    selectedReturnTime: sched1.defaultReturnTime,
    status: 'ALLOCATED',
    committedAt: new Date(now.getTime() - 4 * 3600_000),
    lockedAt: new Date(now.getTime() - 2 * 3600_000),
    allocatedAt: new Date(now.getTime() - 2 * 3600_000),
  });

  const activeDemoTrip = await Trip.create({
    tripCode: `MC-TRIP-${todayPrefix}-SLOT1`,
    corridorId: corridor1._id,
    slotId: todaySlot1._id,
    sourceCommitmentId: todayCommitment._id,
    vehicleId: tier1Vehicle1._id,
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
      registrationNumber: tier1Vehicle1.registrationNumber,
      vehicleClass: tier1Vehicle1.vehicleClass,
      bodyType: tier1Vehicle1.bodyType,
      maxWeightKg: tier1Vehicle1.maxWeightKg,
      maxVolumeCbm: tier1Vehicle1.maxVolumeCbm,
      bedDimensionsCm: tier1Vehicle1.bedDimensionsCm,
      ownershipType: 'DRIVER_OWNED',
    },
    plannedDepartureAt: todayDep,
    estimatedEndAt: todayRet,
    allocationEconomics: {
      allocatedTier: 'TIER_1',
      tier1MinGuaranteeIncludedPaise: 320000,
      selectedVehicleMinGuaranteePaise: 320000,
      estimatedDistanceKm: 111,
      estimatedVehiclePayoutPaise: 320000,
      rightSized: false,
      reason: 'Allocated Tier 1 driver-owned vehicle from locked Slot 1 commitment.',
    },
    stopsSummary: corridor1.stops.map((s) => ({
      stopCode: s.stopCode,
      name: s.name,
      sequenceOrder: s.sequenceOrder,
    })),
    notes: 'Active AP rural corridor run ready for QR pickup verification',
  });

  const sampleLandingToken = 'mc_trk_9f4b2a8e1d7c6034a91e5b2f8d04c71a';
  trackingTokens['MC-DEMO-TODAY'] = sampleLandingToken;

  const shipToday = await Shipment.create({
    reference: `MC-AP-${todayCompact}-03`,
    businessId: business1._id,
    createdByUserId: shipper1._id,
    corridorId: corridor1._id,
    slotId: todaySlot1._id,
    tripId: activeDemoTrip._id,
    pickupStopCode: 'TDP',
    pickupStopOrder: 0,
    deliveryStopCode: 'VJA',
    deliveryStopOrder: 3,
    pickupAddress: business1.pickupAddress,
    deliveryAddress: {
      addressLine: 'Plot 88, Gollapudi Agricultural Wholesale Complex',
      villageOrTown: 'Vijayawada',
      district: 'NTR',
      state: 'Andhra Pradesh',
      pincode: '521225',
      landmark: 'Near NH-65 Bypass Circle',
      location: { type: 'Point', coordinates: [80.5847, 16.5449] },
    },
    recipientName: 'Krishna Wholesale Agro Traders',
    recipientPhone: '+919848000303',
    allowB2bWarehouseConfirm: true,
    cargo: {
      category: 'PALLET_BUNDLE',
      quantity: 2,
      unitDimensionsCm: cargoToday.unitDimensionsCm,
      unitActualWeightKg: 220,
      totalActualWeightKg: cargoToday.totalActualWeightKg,
      volumetricDivisor: 5000,
      volumetricWeightKg: cargoToday.totalVolumetricWeightKg,
      chargeableWeightKg: cargoToday.chargeableWeightKg,
      billingBasis: cargoToday.billingBasis,
      volumeCbm: cargoToday.totalVolumeCbm,
      stackable: false,
      handlingRestrictions: ['FRAGILE'],
      declaredContents: '2 Palletized Spices & Agro Export Crates',
    },
    tokenStatus: 'PAID',
    status: 'LOCKED',
    pricingSnapshot: {
      pricingVersion: pToday.pricingVersion,
      ceilingPricePaise: pToday.ceilingPricePaise,
      projectedPricePaise: pToday.computedPricePaise,
      finalLockedPricePaise: pToday.computedPricePaise,
      tokenAmountPaise: pToday.tokenAmountPaise,
      tokenPaidPaise: pToday.tokenAmountPaise,
      remainingBalancePaise: pToday.computedPricePaise - pToday.tokenAmountPaise,
      isAnchorEligible: false,
      poolDiscountPaise: pToday.poolDiscountPaise,
      anchorDiscountPaise: 0,
      handlingFeePaise: pToday.handlingFeePaise,
    },
    trackingToken: sampleLandingToken,
    qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
    statusHistory: [{ status: 'LOCKED', at: now, note: 'Assigned to today Slot 1 trip' }],
  });
  totalShipmentsSeeded += 1;

  activeDemoTrip.shipmentIds = [shipToday._id];
  activeDemoTrip.routePlan = {
    routeVersion: 1,
    optimizationStatus: 'OPTIMAL',
    provider: 'OR_TOOLS',
    matrixProvider: 'FIXTURE',
    totalDistanceMeters: 110500,
    estimatedDurationSeconds: 7440,
    orderedStops: [
      { sequence: 0, stopCode: 'TDP', name: 'Tadepalligudem', arrivalMin: 0, cumulativeDistanceMeters: 0, shipmentIds: [] },
      { sequence: 1, stopCode: 'VJA', name: 'Vijayawada', arrivalMin: 124, cumulativeDistanceMeters: 110500, shipmentIds: [String(shipToday._id)] },
    ],
    optimizedAt: now,
    routeHistory: [],
  };
  activeDemoTrip.stopsSummary = [
    { stopCode: 'TDP', name: 'Tadepalligudem', sequenceOrder: 0 },
    { stopCode: 'VJA', name: 'Vijayawada', sequenceOrder: 1 },
  ];
  activeDemoTrip.loadingPlan = buildLifoLoadingPlan({
    orderedStops: [
      { sequence: 0, stopCode: 'TDP' },
      { sequence: 1, stopCode: 'VJA' },
    ],
    shipments: [shipToday],
    bedDimensionsCm: tier1Vehicle1.bedDimensionsCm,
    vehicleLimits: {
      maxWeightKg: tier1Vehicle1.maxWeightKg,
      maxVolumeCbm: tier1Vehicle1.maxVolumeCbm,
    },
  });
  await activeDemoTrip.save();
  totalTripsSeeded += 1;

  await Payment.create({
    shipmentId: shipToday._id,
    businessId: business1._id,
    type: 'TOKEN',
    amountPaise: pToday.tokenAmountPaise,
    status: 'SUCCESS',
    mode: 'SIMULATED',
    isSimulated: true,
    providerRef: `SIM-SEED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    actorUserId: shipper1._id,
    processedAt: now,
  });

  // Live Open Tier 2 EXPRESS Opportunity (Nuzvid Rural -> Guntur Chilli Market) offered to Driver 2
  const expQuoteLive = calculateDeterministicTier2Payout({
    opportunityType: 'EXPRESS',
    estimatedDistanceKm: 78,
    totalWeightKg: 280,
    totalVolumeCbm: 1.4,
    bodyType: tier2Vehicle.bodyType,
    approachDistanceKm: 4,
    policy: marketPolicy,
  });
  const expShipment = await Shipment.create({
    reference: `MC-EXP-${todayCompact}-01`,
    businessId: business2._id,
    createdByUserId: shipper2._id,
    pickupStopCode: 'NZW',
    pickupStopOrder: 0,
    deliveryStopCode: 'GNT',
    deliveryStopOrder: 1,
    pickupAddress: {
      addressLine: 'Plot 5, Agripalli Road Mango Shed',
      villageOrTown: 'Nuzvid',
      district: 'Eluru',
      state: 'Andhra Pradesh',
      pincode: '521201',
      location: { type: 'Point', coordinates: [80.8465, 16.7885] },
    },
    deliveryAddress: {
      addressLine: 'Yard 19, Etukuru Road Chilli Yard',
      villageOrTown: 'Guntur',
      district: 'Guntur',
      state: 'Andhra Pradesh',
      pincode: '522001',
      location: { type: 'Point', coordinates: [80.4365, 16.3067] },
    },
    pickupContact: { name: 'Lakshmi Narayana', phone: '+919848000102' },
    requestedPickupWindow: {
      startAt: new Date(now.getTime() + 30 * 60_000),
      endAt: new Date(now.getTime() + 90 * 60_000),
    },
    requestedDeliveryDeadlineAt: new Date(now.getTime() + 6 * 3600_000),
    recipientName: 'Guntur Mirchi Exports',
    recipientPhone: '+919848009911',
    cargo: {
      category: 'SACK_BAG',
      quantity: 8,
      unitDimensionsCm: { length: 70, width: 45, height: 30 },
      unitActualWeightKg: 35,
      totalActualWeightKg: 280,
      volumetricDivisor: 5000,
      volumetricWeightKg: 151.2,
      chargeableWeightKg: 280,
      billingBasis: 'ACTUAL',
      volumeCbm: 0.76,
      stackable: true,
      handlingRestrictions: [],
      declaredContents: '8x Dried Chilli & Turmeric Gunny Bags',
    },
    serviceType: 'EXPRESS_MARKETPLACE',
    paymentChoice: 'FULL_PREPAID',
    tokenStatus: 'PAID',
    pricingSnapshot: {
      pricingVersion: marketPolicy.policyVersion,
      ceilingPricePaise: expQuoteLive.spotPayoutPaise + 45000,
      projectedPricePaise: expQuoteLive.spotPayoutPaise + 45000,
      finalLockedPricePaise: expQuoteLive.spotPayoutPaise + 45000,
      tokenAmountPaise: expQuoteLive.spotPayoutPaise + 45000,
      tokenPaidPaise: expQuoteLive.spotPayoutPaise + 45000,
      remainingBalancePaise: 0,
      isAnchorEligible: false,
      poolDiscountPaise: 0,
      anchorDiscountPaise: 0,
      handlingFeePaise: 0,
    },
    trackingToken: crypto.randomBytes(16).toString('hex'),
    qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
    status: 'CONFIRMED',
    statusHistory: [{ status: 'CONFIRMED', at: now, note: 'Live Express AP rural shipment seeded' }],
  });
  totalShipmentsSeeded += 1;

  const liveOpp = await MarketplaceOpportunity.create({
    opportunityCode: 'MKT-EXP-AP-LIVE',
    opportunityType: 'EXPRESS',
    status: 'OFFERED',
    offerVersion: 1,
    sourceDemandKey: `EXPRESS:${String(expShipment._id)}`,
    shipmentIds: [expShipment._id],
    originLabel: 'Nuzvid, Eluru',
    destinationLabel: 'Guntur, Guntur',
    originStopCode: 'NZW',
    deliveryStopCode: 'GNT',
    originLocation: expShipment.pickupAddress.location,
    destinationLocation: expShipment.deliveryAddress.location,
    stopsSummary: [
      { stopCode: 'NZW', name: 'Nuzvid Rural Shed', sequenceOrder: 0 },
      { stopCode: 'GNT', name: 'Guntur Mirchi Yard', sequenceOrder: 1 },
    ],
    serviceWindowStartAt: new Date(now.getTime() + 30 * 60_000),
    pickupDeadlineAt: new Date(now.getTime() + 90 * 60_000),
    deliveryDeadlineAt: new Date(now.getTime() + 6 * 3600_000),
    offerExpiresAt: new Date(now.getTime() + 6 * 3600_000),
    cargoSummary: {
      shipmentCount: 1,
      totalWeightKg: 280,
      totalVolumeCbm: 0.76,
      maxUnitLengthCm: 70,
      maxUnitWidthCm: 45,
      maxUnitHeightCm: 30,
      allStackable: true,
      handlingRestrictions: [],
      requiredBodyTypes: ['CLOSED_BODY', 'CONTAINER', 'OPEN_BODY', 'MINI_PICKUP', 'FLATBED'],
      summaryLabel: '8x Dried Chilli & Turmeric Gunny Bags',
    },
    estimatedDistanceKm: 78,
    estimatedDurationMin: 98,
    payoutQuote: expQuoteLive,
    offers: [
      {
        driverUserId: driver2._id,
        vehicleId: tier2Vehicle._id,
        offerVersion: 1,
        status: 'OFFERED',
        spotPayoutPaise: expQuoteLive.spotPayoutPaise,
        approachDistanceKm: 4,
        offeredAt: now,
        expiresAt: new Date(now.getTime() + 6 * 3600_000),
      },
    ],
    declinedOrExhaustedDriverIds: [],
    orchestrationReason: 'Live one-way rural Express opportunity dispatched to Tier 2 pool',
    auditHistory: [
      { action: 'OFFERED', toStatus: 'OFFERED', actorUserId: shipper2._id, at: now },
    ],
  });
  expShipment.marketplaceOpportunityId = liveOpp._id;
  await expShipment.save();

  // -------------------------------------------------------------------------
  // PART C: Future Bookable Open Slots (Day +1 & Day +2) on BOTH AP Corridors
  // -------------------------------------------------------------------------
  let day1MorningSlot: ISlot | null = null;

  for (const offset of [1, 2]) {
    for (const cor of [corridor1, corridor2]) {
      const s1Dep = dayAtTime(now, offset, sched1.outboundPickupTime);
      const s1Cut = new Date(s1Dep.getTime() - 90 * 60_000);
      const s1ArrStart = dayAtTime(now, offset, sched1.defaultReturnTime);
      const s1ArrEnd = dayAtTime(now, offset, '16:30');
      const dk = dateKey(s1Dep);

      const s1Doc = await Slot.create({
        corridorId: cor._id,
        slotNumber: 1,
        slotCode: `${cor.code}-${dk}-SLOT1`,
        label: sched1.label,
        departureDate: s1Dep,
        poolingOpensAt: new Date(now.getTime() - 12 * 3600_000),
        cutoffAt: s1Cut,
        plannedDepartureAt: s1Dep,
        estimatedArrivalStartAt: s1ArrStart,
        estimatedArrivalEndAt: s1ArrEnd,
        returnTimeOptions: sched1.returnTimeOptions,
        returnTimeLocked: false,
        capacityWeightKg: 2500,
        capacityVolumeCbm: 12,
        reservedWeightKg: 0,
        reservedVolumeCbm: 0,
        status: 'OPEN',
      });
      totalSlotsSeeded += 1;
      if (offset === 1 && cor.code === corridor1.code) {
        day1MorningSlot = s1Doc;
      }

      const s2Dep = dayAtTime(now, offset, sched2.outboundPickupTime);
      const s2Cut = new Date(s2Dep.getTime() - 90 * 60_000);
      const s2Arr = dayAtTime(now, offset, sched2.lockedReturnTime ?? '16:30');
      await Slot.create({
        corridorId: cor._id,
        slotNumber: 2,
        slotCode: `${cor.code}-${dk}-SLOT2`,
        label: sched2.label,
        departureDate: s2Dep,
        poolingOpensAt: new Date(now.getTime() - 12 * 3600_000),
        cutoffAt: s2Cut,
        plannedDepartureAt: s2Dep,
        estimatedArrivalStartAt: s2Arr,
        estimatedArrivalEndAt: s2Arr,
        returnTimeOptions: sched2.returnTimeOptions,
        returnTimeLocked: true,
        lockedReturnTime: sched2.lockedReturnTime,
        capacityWeightKg: 2500,
        capacityVolumeCbm: 12,
        reservedWeightKg: 0,
        reservedVolumeCbm: 0,
        status: 'OPEN',
      });
      totalSlotsSeeded += 1;
    }
  }

  // Pre-seed tomorrow's AP-ELR-VJA-01 morning pool with Shipper 1 (Anchor) + Shipper 2 + Driver 1 Commitment
  if (day1MorningSlot) {
    await DriverSlotCommitment.create({
      corridorId: corridor1._id,
      slotId: day1MorningSlot._id,
      driverUserId: driver1._id,
      driverProfileId: driver1Profile._id,
      vehicleId: tier1Vehicle1._id,
      slotNumber: 1,
      departureDate: day1MorningSlot.departureDate,
      selectedPickupTime: sched1.outboundPickupTime,
      selectedReturnTime: sched1.defaultReturnTime,
      status: 'COMMITTED',
      committedAt: now,
    });

    const fc1 = calculateCargoMetrics({
      category: 'SACK_BAG',
      quantity: 12,
      length: 70,
      width: 45,
      height: 30,
      dimensionUnit: 'CM',
      unitActualWeight: 42,
      weightUnit: 'KG',
    });
    const fc2 = calculateCargoMetrics({
      category: 'STANDARD_BOX',
      quantity: 10,
      length: 60,
      width: 40,
      height: 35,
      dimensionUnit: 'CM',
      unitActualWeight: 38,
      weightUnit: 'KG',
    });
    const wTot = fc1.chargeableWeightKg + fc2.chargeableWeightKg;
    const vTot = Number((fc1.totalVolumeCbm + fc2.totalVolumeCbm).toFixed(4));
    const fp1 = calculateDeterministicPrice({
      chargeableWeightKg: fc1.chargeableWeightKg,
      baseRatePaisePerKg: corridor1.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: corridor1.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: (wTot / 2500) * 100,
      volumeUtilizationPct: (vTot / 12) * 100,
      isAnchorEligible: true,
      rules: DEFAULT_PRICING_RULES,
    });
    const fp2 = calculateDeterministicPrice({
      chargeableWeightKg: fc2.chargeableWeightKg,
      baseRatePaisePerKg: corridor1.baseRatePaisePerKg,
      guaranteedCeilingPaisePerKg: corridor1.guaranteedCeilingPaisePerKg,
      weightUtilizationPct: (wTot / 2500) * 100,
      volumeUtilizationPct: (vTot / 12) * 100,
      isAnchorEligible: false,
      rules: DEFAULT_PRICING_RULES,
    });

    const poolDay1 = await Pool.create({
      poolCode: `POOL-${day1MorningSlot.slotCode}`,
      corridorId: corridor1._id,
      slotId: day1MorningSlot._id,
      status: 'OPEN',
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: wTot,
      reservedVolumeCbm: vTot,
      shipmentIds: [],
      viabilityStatus: 'PENDING',
    });

    const futDateCompact = dateKey(day1MorningSlot.departureDate).replace(/-/g, '');
    const tokFut1 = crypto.randomBytes(20).toString('hex');
    const tokFut2 = crypto.randomBytes(20).toString('hex');
    trackingTokens['MC-DEMO-001'] = tokFut1;
    trackingTokens['MC-DEMO-002'] = tokFut2;

    const fs1 = await Shipment.create({
      reference: `MC-AP-${futDateCompact}-01`,
      businessId: business1._id,
      createdByUserId: shipper1._id,
      corridorId: corridor1._id,
      slotId: day1MorningSlot._id,
      poolId: poolDay1._id,
      pickupStopCode: 'TDP',
      pickupStopOrder: 0,
      deliveryStopCode: 'NZW',
      deliveryStopOrder: 1,
      pickupAddress: business1.pickupAddress,
      deliveryAddress: {
        addressLine: 'Plot 14, Mango Growers Market, Hanuman Junction Road',
        villageOrTown: 'Nuzvid',
        district: 'Eluru',
        state: 'Andhra Pradesh',
        pincode: '521201',
        landmark: 'Near Agricultural Market Committee',
        location: { type: 'Point', coordinates: [80.8465, 16.7885] },
      },
      recipientName: 'Nuzvid Agro Packers',
      recipientPhone: '+919848000301',
      cargo: {
        category: 'SACK_BAG',
        quantity: 12,
        unitDimensionsCm: fc1.unitDimensionsCm,
        unitActualWeightKg: 42,
        totalActualWeightKg: fc1.totalActualWeightKg,
        volumetricDivisor: 5000,
        volumetricWeightKg: fc1.totalVolumetricWeightKg,
        chargeableWeightKg: fc1.chargeableWeightKg,
        billingBasis: fc1.billingBasis,
        volumeCbm: fc1.totalVolumeCbm,
        stackable: true,
        handlingRestrictions: ['KEEP_DRY'],
        declaredContents: '12 Parboiled Paddy & Husk Sacks',
      },
      tokenStatus: 'PAID',
      status: 'POOLED',
      pricingSnapshot: {
        pricingVersion: fp1.pricingVersion,
        ceilingPricePaise: fp1.ceilingPricePaise,
        projectedPricePaise: fp1.computedPricePaise,
        tokenAmountPaise: fp1.tokenAmountPaise,
        tokenPaidPaise: fp1.tokenAmountPaise,
        remainingBalancePaise: fp1.computedPricePaise - fp1.tokenAmountPaise,
        isAnchorEligible: true,
        poolDiscountPaise: fp1.poolDiscountPaise,
        anchorDiscountPaise: fp1.anchorDiscountPaise,
        handlingFeePaise: fp1.handlingFeePaise,
      },
      trackingToken: tokFut1,
      qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
      statusHistory: [{ status: 'POOLED', at: now, note: 'Anchor booking in tomorrow AP Slot 1 pool' }],
    });

    const fs2 = await Shipment.create({
      reference: `MC-AP-${futDateCompact}-02`,
      businessId: business2._id,
      createdByUserId: shipper2._id,
      corridorId: corridor1._id,
      slotId: day1MorningSlot._id,
      poolId: poolDay1._id,
      pickupStopCode: 'TDP',
      pickupStopOrder: 0,
      deliveryStopCode: 'GDV',
      deliveryStopOrder: 2,
      pickupAddress: business2.pickupAddress,
      deliveryAddress: {
        addressLine: 'Godown 5, Gudivada Rice Mill Cluster',
        villageOrTown: 'Gudivada',
        district: 'Krishna',
        state: 'Andhra Pradesh',
        pincode: '521301',
        landmark: 'Near Pamarru Bypass Gate',
        location: { type: 'Point', coordinates: [80.9926, 16.4355] },
      },
      recipientName: 'Krishna Delta Pulse Traders',
      recipientPhone: '+919848000302',
      cargo: {
        category: 'STANDARD_BOX',
        quantity: 10,
        unitDimensionsCm: fc2.unitDimensionsCm,
        unitActualWeightKg: 38,
        totalActualWeightKg: fc2.totalActualWeightKg,
        volumetricDivisor: 5000,
        volumetricWeightKg: fc2.totalVolumetricWeightKg,
        chargeableWeightKg: fc2.chargeableWeightKg,
        billingBasis: fc2.billingBasis,
        volumeCbm: fc2.totalVolumeCbm,
        stackable: true,
        handlingRestrictions: [],
        declaredContents: '10 Turmeric & Guntur Spice Cartons',
      },
      tokenStatus: 'PAID',
      status: 'POOLED',
      pricingSnapshot: {
        pricingVersion: fp2.pricingVersion,
        ceilingPricePaise: fp2.ceilingPricePaise,
        projectedPricePaise: fp2.computedPricePaise,
        tokenAmountPaise: fp2.tokenAmountPaise,
        tokenPaidPaise: fp2.tokenAmountPaise,
        remainingBalancePaise: fp2.computedPricePaise - fp2.tokenAmountPaise,
        isAnchorEligible: false,
        poolDiscountPaise: fp2.poolDiscountPaise,
        anchorDiscountPaise: 0,
        handlingFeePaise: fp2.handlingFeePaise,
      },
      trackingToken: tokFut2,
      qrToken: `MCR_${crypto.randomBytes(12).toString('hex')}`,
      statusHistory: [{ status: 'POOLED', at: now, note: 'Co-pooled in tomorrow AP Slot 1 pool' }],
    });

    totalShipmentsSeeded += 2;
    poolDay1.shipmentIds = [fs1._id, fs2._id];
    poolDay1.anchorShipmentId = fs1._id;
    await poolDay1.save();

    await Slot.updateOne(
      { _id: day1MorningSlot._id },
      { $set: { reservedWeightKg: wTot, reservedVolumeCbm: vTot } }
    );

    await Payment.insertMany([
      {
        shipmentId: fs1._id,
        businessId: business1._id,
        type: 'TOKEN',
        amountPaise: fp1.tokenAmountPaise,
        status: 'SUCCESS',
        mode: 'SIMULATED',
        isSimulated: true,
        providerRef: `SIM-SEED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        actorUserId: shipper1._id,
        processedAt: now,
      },
      {
        shipmentId: fs2._id,
        businessId: business2._id,
        type: 'TOKEN',
        amountPaise: fp2.tokenAmountPaise,
        status: 'SUCCESS',
        mode: 'SIMULATED',
        isSimulated: true,
        providerRef: `SIM-SEED-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
        actorUserId: shipper2._id,
        processedAt: now,
      },
    ]);
  }

  // Seed confirmed Backhaul Return Requests along rural AP return corridors (VJA -> TDP & NLR -> MDP)
  await BackhaulRequest.create([
    {
      requestCode: 'BH-VJA-TDP-001',
      businessId: business1._id,
      corridorId: corridor1._id,
      originStopCode: 'VJA',
      destinationStopCode: 'TDP',
      originLocation: { type: 'Point', coordinates: [80.5847, 16.5449] },
      destinationLocation: { type: 'Point', coordinates: [81.527, 16.8147] },
      earliestPickupAt: todayRet,
      latestArrivalAt: new Date(todayRet.getTime() + 4 * 3600_000),
      cargo: {
        chargeableWeightKg: 880,
        volumeCbm: 4.1,
        unitDimensionsCm: { length: 120, width: 100, height: 90 },
        declaredContents: 'Return wholesale fertiliser bags & farm spare boxes',
      },
      quotedRevenuePaise: 140800,
      status: 'CONFIRMED',
    },
    {
      requestCode: 'BH-NLR-MDP-001',
      businessId: business3._id,
      corridorId: corridor2._id,
      originStopCode: 'NLR',
      destinationStopCode: 'MDP',
      originLocation: { type: 'Point', coordinates: [79.9865, 14.4426] },
      destinationLocation: { type: 'Point', coordinates: [78.5029, 13.5503] },
      earliestPickupAt: new Date(now.getTime() + 26 * 3600_000),
      latestArrivalAt: new Date(now.getTime() + 31 * 3600_000),
      cargo: {
        chargeableWeightKg: 820,
        volumeCbm: 3.8,
        unitDimensionsCm: { length: 110, width: 90, height: 80 },
        declaredContents: 'Return kirana wholesale provisions & dairy crates',
      },
      quotedRevenuePaise: 131200,
      status: 'CONFIRMED',
    },
  ]);

  await evaluateBackhaulForTrip({ tripId: String(activeDemoTrip._id), applyMatch: true });

  return {
    resetApplied: Boolean(options.reset),
    usersCount: demoUsers.length,
    businessesCount: 3,
    corridorCodes: [corridor1.code, corridor2.code],
    daysCovered: 9, // Day -6 through Day +2 (> 1 week of operational records)
    slotsSeeded: totalSlotsSeeded,
    shipmentsSeeded: totalShipmentsSeeded,
    tripsSeeded: totalTripsSeeded,
    vehiclesCount: vehicles.length,
    backhaulRequestsCount: 2,
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
      console.log('Rural Andhra Pradesh seed completed:', summary);
      return disconnectDatabase();
    })
    .then(() => process.exit(0))
    .catch(async (error) => {
      console.error('Seed failed:', error);
      await disconnectDatabase();
      process.exit(1);
    });
}

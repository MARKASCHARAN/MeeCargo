import bcrypt from 'bcryptjs';
import { connectDatabase, disconnectDatabase } from '../config/database.js';
import { BusinessProfile } from '../models/BusinessProfile.js';
import { Corridor } from '../models/Corridor.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { PricingConfig } from '../models/PricingConfig.js';
import { Slot } from '../models/Slot.js';
import { Trip } from '../models/Trip.js';
import { User, type IUser } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { DEFAULT_PRICING_RULES } from '../services/pricingEngine.js';

export async function seedDatabase() {
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
  const driver1 = userMap.get('driver1@meecargo.demo')!;
  const driver2 = userMap.get('driver2@meecargo.demo')!;

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

  await User.updateOne({ _id: shipper1._id }, { $set: { businessId: business1._id } });
  await User.updateOne({ _id: shipper2._id }, { $set: { businessId: business2._id } });

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

  const morningCutoff = new Date(tomorrow);
  morningCutoff.setHours(7, 30, 0, 0);
  const morningDeparture = new Date(tomorrow);
  morningDeparture.setHours(9, 0, 0, 0);
  const morningArrStart = new Date(tomorrow);
  morningArrStart.setHours(12, 0, 0, 0);
  const morningArrEnd = new Date(tomorrow);
  morningArrEnd.setHours(13, 30, 0, 0);

  const eveningCutoff = new Date(tomorrow);
  eveningCutoff.setHours(15, 30, 0, 0);
  const eveningDeparture = new Date(tomorrow);
  eveningDeparture.setHours(17, 0, 0, 0);
  const eveningArrStart = new Date(tomorrow);
  eveningArrStart.setHours(20, 0, 0, 0);
  const eveningArrEnd = new Date(tomorrow);
  eveningArrEnd.setHours(21, 30, 0, 0);

  const slots = [
    {
      corridorId: corridor._id,
      slotCode: `GJ-VAD-AMD-01-${datePrefix}-AM`,
      label: 'Morning Express Pool (09:00 Departure)',
      departureDate: tomorrow,
      cutoffAt: morningCutoff,
      plannedDepartureAt: morningDeparture,
      estimatedArrivalStartAt: morningArrStart,
      estimatedArrivalEndAt: morningArrEnd,
      capacityWeightKg: 2500,
      capacityVolumeCbm: 12,
      reservedWeightKg: 0,
      reservedVolumeCbm: 0,
      status: 'OPEN' as const,
    },
    {
      corridorId: corridor._id,
      slotCode: `GJ-VAD-AMD-01-${datePrefix}-PM`,
      label: 'Evening Standard Pool (17:00 Departure)',
      departureDate: tomorrow,
      cutoffAt: eveningCutoff,
      plannedDepartureAt: eveningDeparture,
      estimatedArrivalStartAt: eveningArrStart,
      estimatedArrivalEndAt: eveningArrEnd,
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

  const vehicles = [
    {
      registrationNumber: 'GJ-06-MC-1001',
      operatorName: 'MeeCargo Attached Partner (Vadodara)',
      driverId: driver1._id,
      tier: 'TIER_1' as const,
      vehicleClass: '14ft Closed Body LCV',
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
      contractedSlotLabels: ['AM', 'PM'],
      unavailableDates: [],
      blockedSlotIds: [],
      operatingRestrictions: [],
      supportsBackhaul: false,
      homeLocation: { type: 'Point' as const, coordinates: [73.1812, 22.3072] },
      isAvailable: true,
    },
    {
      registrationNumber: 'GJ-06-MK-2044',
      operatorName: 'Charotar Fleet Marketplace',
      driverId: driver2._id,
      tier: 'TIER_2' as const,
      vehicleClass: '8ft Mini Pickup',
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
      isAvailable: true,
    },
    {
      registrationNumber: 'GJ-01-BH-3099',
      operatorName: 'Sabarmati Return Haul Partner',
      tier: 'TIER_3' as const,
      vehicleClass: '17ft Backhaul Truck',
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
  await DriverProfile.findOneAndUpdate(
    { userId: driver1._id },
    {
      $set: {
        userId: driver1._id,
        name: driver1.name,
        phone: driver1.phone ?? '+919800000201',
        availabilityStatus: 'AVAILABLE',
        fleetTier: 'TIER_1',
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
        fleetTier: 'TIER_2',
        vehicleId: tier2Vehicle._id,
        licenseNumber: 'GJ06-2020-0088123',
        homeBase: 'Anand Charotar Hub',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  await Trip.findOneAndUpdate(
    { tripCode: `MC-TRIP-${datePrefix}-001` },
    {
      $setOnInsert: {
        tripCode: `MC-TRIP-${datePrefix}-001`,
        corridorId: corridor._id,
        slotId: seededSlots[0]._id,
        vehicleId: tier1Vehicle._id,
        driverId: driver1._id,
        status: 'ASSIGNED',
        plannedDepartureAt: morningDeparture,
        estimatedEndAt: morningArrEnd,
        stopsSummary: corridor.stops.map((s) => ({
          stopCode: s.stopCode,
          name: s.name,
          sequenceOrder: s.sequenceOrder,
        })),
        notes: 'Demo scheduled corridor assignment (Tier 1 attached vehicle)',
      },
    },
    { upsert: true, returnDocument: 'after', runValidators: true }
  );

  return {
    usersCount: demoUsers.length,
    businessesCount: 2,
    corridorCode: corridor.code,
    slotsSeeded: slots.length,
    vehiclesCount: vehicles.length,
  };
}

const isMainModule =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1]?.endsWith('seed.ts');

if (isMainModule) {
  connectDatabase()
    .then(() => seedDatabase())
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

import crypto from 'node:crypto';
import { isValidObjectId, Types } from 'mongoose';
import { withTransaction } from '../config/database.js';
import { env } from '../config/env.js';
import {
  Corridor,
  DEFAULT_CORRIDOR_SLOT_SCHEDULES,
  validateCorridorSlotSchedules,
  type CorridorSlotSchedule,
  type CorridorStop,
  type ICorridor,
  type Weekday,
} from '../models/Corridor.js';
import {
  DriverContract,
  type DriverContractStatus,
} from '../models/DriverContract.js';
import {
  DriverProfile,
  type DriverAccountStatus,
} from '../models/DriverProfile.js';
import { Slot } from '../models/Slot.js';
import { User, type IUser } from '../models/User.js';
import {
  Vehicle,
  type VehicleBodyType,
  type VehicleDocumentVerificationStatus,
  type VehicleOperationalStatus,
} from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';
import { hashPassword } from './authService.js';

function makeContractCode() {
  return `MC-CNT-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

export interface DriverOwnedVehicleInput {
  registrationNumber: string;
  vehicleCategory: string;
  bodyType: VehicleBodyType;
  maxWeightKg: number;
  bedLengthCm: number;
  bedWidthCm: number;
  bedHeightCm: number;
  maxVolumeCbm?: number;
  operationalStatus?: VehicleOperationalStatus;
  rcNumber?: string;
  insurancePolicyNumber?: string;
  insuranceValidUntil?: Date;
  fitnessValidUntil?: Date;
  permitNotes?: string;
  verificationStatus?: VehicleDocumentVerificationStatus;
  operatingRestrictions?: string[];
  homeLocationCoordinates?: [number, number];
}

function computeVolumeCbm(input: DriverOwnedVehicleInput): number {
  if (input.maxVolumeCbm && input.maxVolumeCbm > 0) {
    return Number(input.maxVolumeCbm.toFixed(2));
  }
  const cbm = (input.bedLengthCm * input.bedWidthCm * input.bedHeightCm) / 1_000_000;
  return Number(Math.max(0.5, cbm).toFixed(2));
}

function applyTimeOnDate(baseDate: Date, timeHhMm: string): Date {
  const [h, m] = timeHhMm.split(':').map((n) => Number(n));
  const out = new Date(baseDate);
  out.setHours(h, m, 0, 0);
  return out;
}

/**
 * Ensures there is strictly one active Platform Owner account across MeeCargo
 * and verifies that an acting user matches that singleton account.
 */
export async function assertSinglePlatformOwnerActor(actorUserId: string): Promise<Types.ObjectId> {
  if (!isValidObjectId(actorUserId)) {
    throw new HttpError(401, 'Invalid Platform Owner identity', 'UNAUTHORIZED');
  }

  const owners = await User.find({ role: 'PLATFORM_OWNER' }).sort({ createdAt: 1 });
  if (owners.length === 0) {
    throw new HttpError(
      503,
      'No Platform Owner account has been provisioned. Run initial setup/seed.',
      'PLATFORM_OWNER_NOT_PROVISIONED'
    );
  }
  if (owners.length > 1) {
    throw new HttpError(
      409,
      'Single Platform Owner invariant violated: multiple PLATFORM_OWNER accounts detected.',
      'MULTIPLE_PLATFORM_OWNERS'
    );
  }
  const singletonOwner = owners[0];
  if (!singletonOwner._id.equals(actorUserId) || !singletonOwner.isActive) {
    throw new HttpError(
      403,
      'Only the active single Platform Owner account can perform this action.',
      'FORBIDDEN'
    );
  }
  return singletonOwner._id;
}

/**
 * Securely provisions the single platform-wide Platform Owner account and ensures
 * no additional PLATFORM_OWNER accounts remain if migrating from an older setup.
 */
export async function provisionSinglePlatformOwner(params?: {
  email?: string;
  password?: string;
  name?: string;
}): Promise<{ owner: IUser; demotedDuplicateOwnersCount: number }> {
  const email = (params?.email ?? env.PLATFORM_OWNER_EMAIL ?? 'owner@meecargo.demo')
    .trim()
    .toLowerCase();
  const password = params?.password ?? env.PLATFORM_OWNER_PASSWORD ?? 'Demo@1234';
  const name = (params?.name ?? env.PLATFORM_OWNER_NAME ?? 'MeeCargo Platform Owner').trim();
  const passwordHash = await hashPassword(password);

  const existingOwners = await User.find({ role: 'PLATFORM_OWNER' }).sort({ createdAt: 1 });
  let canonicalOwner = existingOwners.find((o) => o.email === email) ?? existingOwners[0] ?? null;

  let demotedDuplicateOwnersCount = 0;
  for (const existing of existingOwners) {
    if (canonicalOwner && !existing._id.equals(canonicalOwner._id)) {
      await User.deleteOne({ _id: existing._id });
      demotedDuplicateOwnersCount += 1;
    }
  }

  if (canonicalOwner) {
    canonicalOwner.name = name;
    canonicalOwner.email = email;
    canonicalOwner.passwordHash = passwordHash;
    canonicalOwner.role = 'PLATFORM_OWNER';
    canonicalOwner.isActive = true;
    await canonicalOwner.save();
  } else {
    const conflictByEmail = await User.findOne({ email });
    if (conflictByEmail) {
      conflictByEmail.name = name;
      conflictByEmail.passwordHash = passwordHash;
      conflictByEmail.role = 'PLATFORM_OWNER';
      conflictByEmail.isActive = true;
      await conflictByEmail.save();
      canonicalOwner = conflictByEmail;
    } else {
      canonicalOwner = await User.create({
        name,
        email,
        phone: '+919800000500',
        passwordHash,
        role: 'PLATFORM_OWNER',
        isActive: true,
      });
    }
  }

  await User.syncIndexes().catch(() => undefined);

  return { owner: canonicalOwner, demotedDuplicateOwnersCount };
}

export async function registerTier1ContractDriver(params: {
  platformOwnerId: string;
  name: string;
  email: string;
  phone: string;
  password: string;
  licenseNumber?: string;
  homeBase?: string;
  vehicle: DriverOwnedVehicleInput;
  contract: {
    startDate: Date;
    endDate: Date;
    minGuaranteePaise: number;
    perKmRatePaise: number;
    guaranteedMonthlyDays?: number;
    notes?: string;
    eligibleCorridorIds?: string[];
  };
}) {
  const {
    platformOwnerId,
    name,
    email,
    phone,
    password,
    licenseNumber,
    homeBase,
    vehicle,
    contract,
  } = params;

  const ownerObjectId = await assertSinglePlatformOwnerActor(platformOwnerId);

  if (contract.endDate.getTime() <= contract.startDate.getTime()) {
    throw new HttpError(400, 'Contract endDate must be after startDate', 'VALIDATION_ERROR');
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    throw new HttpError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
  }

  const regUpper = vehicle.registrationNumber.trim().toUpperCase();
  const dupVehicle = await Vehicle.findOne({ registrationNumber: regUpper });
  if (dupVehicle) {
    throw new HttpError(
      409,
      `Vehicle ${regUpper} is already registered on the platform.`,
      'VEHICLE_EXISTS'
    );
  }

  const corridorIds = (contract.eligibleCorridorIds ?? [])
    .filter((id) => isValidObjectId(id))
    .map((id) => new Types.ObjectId(id));

  if (contract.eligibleCorridorIds && corridorIds.length !== contract.eligibleCorridorIds.length) {
    throw new HttpError(400, 'Invalid corridor ID in eligibleCorridorIds', 'VALIDATION_ERROR');
  }

  const passwordHash = await hashPassword(password);
  const now = new Date();
  const operationalStatus: VehicleOperationalStatus = vehicle.operationalStatus ?? 'ACTIVE';
  const volumeCbm = computeVolumeCbm(vehicle);

  return withTransaction(async (session) => {
    const [driverUser] = await User.create(
      [
        {
          name: name.trim(),
          email: normalizedEmail,
          phone: phone.trim(),
          passwordHash,
          role: 'DRIVER',
          isActive: true,
        },
      ],
      { session: session ?? undefined }
    );

    const [ownedVehicle] = await Vehicle.create(
      [
        {
          registrationNumber: regUpper,
          operatorName: `${name.trim()} (Driver-Owned)`,
          driverId: driverUser._id,
          tier: 'TIER_1',
          ownershipType: 'DRIVER_OWNED',
          vehicleClass: vehicle.vehicleCategory.trim(),
          bodyType: vehicle.bodyType,
          maxWeightKg: vehicle.maxWeightKg,
          maxVolumeCbm: volumeCbm,
          bedDimensionsCm: {
            length: vehicle.bedLengthCm,
            width: vehicle.bedWidthCm,
            height: vehicle.bedHeightCm,
          },
          minGuaranteePaise: contract.minGuaranteePaise,
          perKmRatePaise: contract.perKmRatePaise,
          payoutModel: {
            modelType: 'MIN_GUARANTEE_PLUS_KM',
            minGuaranteePaise: contract.minGuaranteePaise,
            perKmRatePaise: contract.perKmRatePaise,
            fixedTripPaise: 0,
          },
          contractedCorridorIds: corridorIds,
          operatingRestrictions: vehicle.operatingRestrictions ?? [],
          homeLocation: {
            type: 'Point',
            coordinates: vehicle.homeLocationCoordinates ?? [73.1812, 22.3072],
          },
          operationalStatus,
          isAvailable: operationalStatus === 'ACTIVE',
          documents: {
            rcNumber: vehicle.rcNumber?.trim().toUpperCase(),
            insurancePolicyNumber: vehicle.insurancePolicyNumber?.trim().toUpperCase(),
            insuranceValidUntil: vehicle.insuranceValidUntil,
            fitnessValidUntil: vehicle.fitnessValidUntil,
            permitNotes: vehicle.permitNotes?.trim(),
            verificationStatus: vehicle.verificationStatus ?? 'PENDING',
            verifiedAt: vehicle.verificationStatus === 'VERIFIED' ? now : undefined,
          },
        },
      ],
      { session: session ?? undefined }
    );

    const [profile] = await DriverProfile.create(
      [
        {
          userId: driverUser._id,
          name: name.trim(),
          phone: phone.trim(),
          availabilityStatus: 'AVAILABLE',
          accountStatus: 'ACTIVE',
          fleetTier: 'TIER_1',
          platformOwnerId: ownerObjectId,
          vehicleId: ownedVehicle._id,
          ...(licenseNumber ? { licenseNumber: licenseNumber.trim().toUpperCase() } : {}),
          ...(homeBase ? { homeBase: homeBase.trim() } : {}),
        },
      ],
      { session: session ?? undefined }
    );

    const [createdContract] = await DriverContract.create(
      [
        {
          contractCode: makeContractCode(),
          platformOwnerId: ownerObjectId,
          driverProfileId: profile._id,
          driverUserId: driverUser._id,
          startDate: contract.startDate,
          endDate: contract.endDate,
          minimumGuaranteeTerms: {
            minGuaranteePaise: contract.minGuaranteePaise,
            perKmRatePaise: contract.perKmRatePaise,
            ...(contract.guaranteedMonthlyDays !== undefined
              ? { guaranteedMonthlyDays: contract.guaranteedMonthlyDays }
              : {}),
            ...(contract.notes ? { notes: contract.notes.trim() } : {}),
          },
          assignedVehicleId: ownedVehicle._id,
          eligibleCorridorIds: corridorIds,
          status: 'ACTIVE',
          history: [
            {
              action: 'CONTRACT_CREATED',
              status: 'ACTIVE',
              actorUserId: ownerObjectId,
              at: now,
              note: `Registered Tier 1 driver with driver-owned vehicle ${regUpper}`,
              termsSnapshot: {
                startDate: contract.startDate,
                endDate: contract.endDate,
                minGuaranteePaise: contract.minGuaranteePaise,
                perKmRatePaise: contract.perKmRatePaise,
                assignedVehicleId: String(ownedVehicle._id),
                eligibleCorridorIds: corridorIds.map(String),
              },
            },
          ],
        },
      ],
      { session: session ?? undefined }
    );

    return {
      driverUser: {
        id: String(driverUser._id),
        name: driverUser.name,
        email: driverUser.email,
        phone: driverUser.phone,
        role: driverUser.role,
        isActive: driverUser.isActive,
      },
      driverProfile: profile,
      driverOwnedVehicle: ownedVehicle,
      contract: createdContract,
    };
  });
}

/**
 * Registers or updates a Tier 1 driver's DRIVER_OWNED vehicle specifications & documents.
 */
export async function upsertDriverOwnedVehicle(params: {
  platformOwnerId: string;
  driverProfileId: string;
  vehicle: DriverOwnedVehicleInput;
}) {
  const { platformOwnerId, driverProfileId, vehicle } = params;
  const ownerObjectId = await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(driverProfileId)) {
    throw new HttpError(400, 'Invalid driverProfileId', 'VALIDATION_ERROR');
  }

  const regUpper = vehicle.registrationNumber.trim().toUpperCase();
  const operationalStatus: VehicleOperationalStatus = vehicle.operationalStatus ?? 'ACTIVE';
  const volumeCbm = computeVolumeCbm(vehicle);
  const now = new Date();

  return withTransaction(async (session) => {
    const profile = await DriverProfile.findOne({
      _id: driverProfileId,
      fleetTier: 'TIER_1',
    }).session(session);

    if (!profile) {
      throw new HttpError(404, 'Tier 1 contract driver not found', 'NOT_FOUND');
    }

    const dup = await Vehicle.findOne({
      registrationNumber: regUpper,
      ...(profile.vehicleId ? { _id: { $ne: profile.vehicleId } } : {}),
    }).session(session);
    if (dup) {
      throw new HttpError(
        409,
        `Vehicle registration ${regUpper} is already registered to another driver.`,
        'VEHICLE_EXISTS'
      );
    }

    const latestContract = await DriverContract.findOne({
      driverProfileId: profile._id,
    })
      .sort({ createdAt: -1 })
      .session(session);

    const minG = latestContract?.minimumGuaranteeTerms?.minGuaranteePaise ?? 320000;
    const perKm = latestContract?.minimumGuaranteeTerms?.perKmRatePaise ?? 2400;
    const corridors = latestContract?.eligibleCorridorIds ?? [];

    let savedVehicle = profile.vehicleId
      ? await Vehicle.findById(profile.vehicleId).session(session)
      : null;

    if (savedVehicle) {
      savedVehicle.registrationNumber = regUpper;
      savedVehicle.operatorName = `${profile.name} (Driver-Owned)`;
      savedVehicle.driverId = profile.userId;
      savedVehicle.tier = 'TIER_1';
      savedVehicle.ownershipType = 'DRIVER_OWNED';
      savedVehicle.vehicleClass = vehicle.vehicleCategory.trim();
      savedVehicle.bodyType = vehicle.bodyType;
      savedVehicle.maxWeightKg = vehicle.maxWeightKg;
      savedVehicle.maxVolumeCbm = volumeCbm;
      savedVehicle.bedDimensionsCm = {
        length: vehicle.bedLengthCm,
        width: vehicle.bedWidthCm,
        height: vehicle.bedHeightCm,
      };
      savedVehicle.minGuaranteePaise = minG;
      savedVehicle.perKmRatePaise = perKm;
      savedVehicle.payoutModel = {
        modelType: 'MIN_GUARANTEE_PLUS_KM',
        minGuaranteePaise: minG,
        perKmRatePaise: perKm,
        fixedTripPaise: 0,
      };
      savedVehicle.contractedCorridorIds = corridors;
      if (vehicle.operatingRestrictions) {
        savedVehicle.operatingRestrictions = vehicle.operatingRestrictions;
      }
      savedVehicle.operationalStatus = operationalStatus;
      savedVehicle.isAvailable = operationalStatus === 'ACTIVE';
      savedVehicle.documents = {
        rcNumber: vehicle.rcNumber?.trim().toUpperCase(),
        insurancePolicyNumber: vehicle.insurancePolicyNumber?.trim().toUpperCase(),
        insuranceValidUntil: vehicle.insuranceValidUntil,
        fitnessValidUntil: vehicle.fitnessValidUntil,
        permitNotes: vehicle.permitNotes?.trim(),
        verificationStatus:
          vehicle.verificationStatus ?? savedVehicle.documents?.verificationStatus ?? 'PENDING',
        verifiedAt:
          vehicle.verificationStatus === 'VERIFIED'
            ? savedVehicle.documents?.verifiedAt ?? now
            : undefined,
      };
      await savedVehicle.save({ session: session ?? undefined });
    } else {
      const [createdVehicle] = await Vehicle.create(
        [
          {
            registrationNumber: regUpper,
            operatorName: `${profile.name} (Driver-Owned)`,
            driverId: profile.userId,
            tier: 'TIER_1',
            ownershipType: 'DRIVER_OWNED',
            vehicleClass: vehicle.vehicleCategory.trim(),
            bodyType: vehicle.bodyType,
            maxWeightKg: vehicle.maxWeightKg,
            maxVolumeCbm: volumeCbm,
            bedDimensionsCm: {
              length: vehicle.bedLengthCm,
              width: vehicle.bedWidthCm,
              height: vehicle.bedHeightCm,
            },
            minGuaranteePaise: minG,
            perKmRatePaise: perKm,
            payoutModel: {
              modelType: 'MIN_GUARANTEE_PLUS_KM',
              minGuaranteePaise: minG,
              perKmRatePaise: perKm,
              fixedTripPaise: 0,
            },
            contractedCorridorIds: corridors,
            operatingRestrictions: vehicle.operatingRestrictions ?? [],
            homeLocation: {
              type: 'Point',
              coordinates: vehicle.homeLocationCoordinates ?? [73.1812, 22.3072],
            },
            operationalStatus,
            isAvailable: operationalStatus === 'ACTIVE',
            documents: {
              rcNumber: vehicle.rcNumber?.trim().toUpperCase(),
              insurancePolicyNumber: vehicle.insurancePolicyNumber?.trim().toUpperCase(),
              insuranceValidUntil: vehicle.insuranceValidUntil,
              fitnessValidUntil: vehicle.fitnessValidUntil,
              permitNotes: vehicle.permitNotes?.trim(),
              verificationStatus: vehicle.verificationStatus ?? 'PENDING',
              verifiedAt: vehicle.verificationStatus === 'VERIFIED' ? now : undefined,
            },
          },
        ],
        { session: session ?? undefined }
      );
      savedVehicle = createdVehicle;
    }

    profile.vehicleId = savedVehicle._id;
    await profile.save({ session: session ?? undefined });

    if (latestContract) {
      latestContract.assignedVehicleId = savedVehicle._id;
      latestContract.history.push({
        action: 'DRIVER_VEHICLE_UPDATED',
        status: latestContract.status,
        actorUserId: ownerObjectId,
        at: now,
        note: `Updated driver-owned vehicle ${savedVehicle.registrationNumber} (${savedVehicle.operationalStatus})`,
      });
      await latestContract.save({ session: session ?? undefined });
    }

    return {
      driverOwnedVehicle: savedVehicle,
      driverProfile: profile,
      contract: latestContract,
    };
  });
}

/**
 * Lists ALL Tier 1 contract drivers platform-wide for the single Platform Owner,
 * inheriting corridor route stops and schedules centrally from Corridor.
 */
export async function listAllTier1DriversForOwner(params: {
  platformOwnerId: string;
  accountStatus?: DriverAccountStatus;
}) {
  await assertSinglePlatformOwnerActor(params.platformOwnerId);

  const query: Record<string, unknown> = {
    fleetTier: 'TIER_1',
  };
  if (params.accountStatus) {
    query.accountStatus = params.accountStatus;
  }

  const profiles = await DriverProfile.find(query)
    .populate('vehicleId')
    .populate('userId', 'name email phone isActive')
    .sort({ createdAt: -1 });

  const profileIds = profiles.map((p) => p._id);
  const contracts = await DriverContract.find({
    driverProfileId: { $in: profileIds },
  })
    .populate('assignedVehicleId')
    .populate('eligibleCorridorIds', 'code name stops operatingDays slotSchedules')
    .sort({ createdAt: -1 });

  const contractsByProfile = new Map<string, typeof contracts>();
  for (const c of contracts) {
    const key = String(c.driverProfileId);
    const list = contractsByProfile.get(key) ?? [];
    list.push(c);
    contractsByProfile.set(key, list);
  }

  return profiles.map((profile) => {
    const list = contractsByProfile.get(String(profile._id)) ?? [];
    const activeContract = list.find((c) => c.status === 'ACTIVE') ?? list[0] ?? null;
    return {
      driverProfile: profile,
      driverOwnedVehicle: profile.vehicleId ?? activeContract?.assignedVehicleId ?? null,
      activeContract,
      contracts: list,
    };
  });
}

export async function getTier1DriverByIdForOwner(params: {
  platformOwnerId: string;
  driverProfileId: string;
}) {
  await assertSinglePlatformOwnerActor(params.platformOwnerId);

  if (!isValidObjectId(params.driverProfileId)) {
    throw new HttpError(400, 'Invalid driverProfileId', 'VALIDATION_ERROR');
  }

  const profile = await DriverProfile.findOne({
    _id: params.driverProfileId,
    fleetTier: 'TIER_1',
  })
    .populate('vehicleId')
    .populate('userId', 'name email phone isActive');

  if (!profile) {
    throw new HttpError(
      404,
      'Tier 1 contract driver not found (Tier 2/3 drivers are independent)',
      'NOT_FOUND'
    );
  }

  const contracts = await DriverContract.find({
    driverProfileId: profile._id,
  })
    .populate('assignedVehicleId')
    .populate('eligibleCorridorIds', 'code name stops operatingDays slotSchedules')
    .sort({ createdAt: -1 });

  return {
    driverProfile: profile,
    driverOwnedVehicle: profile.vehicleId ?? null,
    contracts,
  };
}

export async function updateTier1DriverStatus(params: {
  platformOwnerId: string;
  driverProfileId: string;
  accountStatus: DriverAccountStatus;
  reason?: string;
}) {
  const { platformOwnerId, driverProfileId, accountStatus, reason } = params;
  const ownerObjectId = await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(driverProfileId)) {
    throw new HttpError(400, 'Invalid driverProfileId', 'VALIDATION_ERROR');
  }

  const now = new Date();

  return withTransaction(async (session) => {
    const profile = await DriverProfile.findOne({
      _id: driverProfileId,
      fleetTier: 'TIER_1',
    }).session(session);

    if (!profile) {
      throw new HttpError(
        404,
        'Tier 1 contract driver not found (Tier 2/3 marketplace drivers remain independent)',
        'NOT_FOUND'
      );
    }

    profile.accountStatus = accountStatus;
    if (!profile.platformOwnerId) {
      profile.platformOwnerId = ownerObjectId;
    }
    if (accountStatus === 'ACTIVE') {
      if (profile.availabilityStatus === 'OFFLINE') {
        profile.availabilityStatus = 'AVAILABLE';
      }
    } else {
      profile.availabilityStatus = 'OFFLINE';
    }
    await profile.save({ session: session ?? undefined });

    await User.updateOne(
      { _id: profile.userId },
      { $set: { isActive: accountStatus === 'ACTIVE' } },
      { session: session ?? undefined }
    );

    const latestContract = await DriverContract.findOne({
      driverProfileId: profile._id,
      status: { $nin: ['TERMINATED', 'EXPIRED'] },
    })
      .sort({ createdAt: -1 })
      .session(session);

    if (latestContract) {
      const nextContractStatus: DriverContractStatus =
        accountStatus === 'ACTIVE'
          ? 'ACTIVE'
          : accountStatus === 'SUSPENDED'
            ? 'SUSPENDED'
            : 'INACTIVE';

      latestContract.status = nextContractStatus;
      latestContract.history.push({
        action: `DRIVER_STATUS_${accountStatus}`,
        status: nextContractStatus,
        actorUserId: ownerObjectId,
        at: now,
        note: reason?.trim() || `Driver marked ${accountStatus} by Platform Owner`,
      });
      await latestContract.save({ session: session ?? undefined });
    }

    return {
      driverProfile: profile,
      contract: latestContract,
    };
  });
}

export async function resetTier1DriverPassword(params: {
  platformOwnerId: string;
  driverProfileId: string;
  newPassword: string;
}) {
  const { platformOwnerId, driverProfileId, newPassword } = params;
  const ownerObjectId = await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(driverProfileId)) {
    throw new HttpError(400, 'Invalid driverProfileId', 'VALIDATION_ERROR');
  }

  const passwordHash = await hashPassword(newPassword);
  const now = new Date();

  return withTransaction(async (session) => {
    const profile = await DriverProfile.findOne({
      _id: driverProfileId,
      fleetTier: 'TIER_1',
    }).session(session);

    if (!profile) {
      throw new HttpError(404, 'Tier 1 contract driver not found', 'NOT_FOUND');
    }

    await User.updateOne(
      { _id: profile.userId },
      { $set: { passwordHash } },
      { session: session ?? undefined }
    );

    const latestContract = await DriverContract.findOne({
      driverProfileId: profile._id,
      status: { $nin: ['TERMINATED', 'EXPIRED'] },
    })
      .sort({ createdAt: -1 })
      .session(session);

    if (latestContract) {
      latestContract.history.push({
        action: 'DRIVER_PASSWORD_RESET',
        status: latestContract.status,
        actorUserId: ownerObjectId,
        at: now,
        note: 'Driver login password reset by Platform Owner',
      });
      await latestContract.save({ session: session ?? undefined });
    }

    return {
      driverProfileId: String(profile._id),
      driverUserId: String(profile.userId),
    };
  });
}

export async function createOrUpdateDriverContract(params: {
  platformOwnerId: string;
  driverProfileId: string;
  contractId?: string;
  startDate: Date;
  endDate: Date;
  minGuaranteePaise: number;
  perKmRatePaise: number;
  guaranteedMonthlyDays?: number;
  notes?: string;
  eligibleCorridorIds: string[];
  status: DriverContractStatus;
  changeNote?: string;
}) {
  const {
    platformOwnerId,
    driverProfileId,
    contractId,
    startDate,
    endDate,
    minGuaranteePaise,
    perKmRatePaise,
    guaranteedMonthlyDays,
    notes,
    eligibleCorridorIds,
    status,
    changeNote,
  } = params;

  const ownerObjectId = await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(driverProfileId)) {
    throw new HttpError(400, 'Invalid driverProfileId', 'VALIDATION_ERROR');
  }
  if (contractId && !isValidObjectId(contractId)) {
    throw new HttpError(400, 'Invalid contractId', 'VALIDATION_ERROR');
  }
  if (endDate.getTime() <= startDate.getTime()) {
    throw new HttpError(400, 'Contract endDate must be after startDate', 'VALIDATION_ERROR');
  }

  const corridorObjectIds = eligibleCorridorIds
    .filter((id) => isValidObjectId(id))
    .map((id) => new Types.ObjectId(id));
  if (corridorObjectIds.length !== eligibleCorridorIds.length) {
    throw new HttpError(400, 'Invalid corridor ID in eligibleCorridorIds', 'VALIDATION_ERROR');
  }

  if (corridorObjectIds.length > 0) {
    const validCorridors = await Corridor.countDocuments({
      _id: { $in: corridorObjectIds },
    });
    if (validCorridors !== corridorObjectIds.length) {
      throw new HttpError(404, 'One or more eligible corridors were not found', 'NOT_FOUND');
    }
  }

  const now = new Date();

  return withTransaction(async (session) => {
    const profile = await DriverProfile.findOne({
      _id: driverProfileId,
      fleetTier: 'TIER_1',
    }).session(session);

    if (!profile) {
      throw new HttpError(404, 'Tier 1 contract driver not found', 'NOT_FOUND');
    }

    if (!profile.platformOwnerId?.equals(ownerObjectId)) {
      profile.platformOwnerId = ownerObjectId;
      await profile.save({ session: session ?? undefined });
    }

    // Keep the driver's DRIVER_OWNED vehicle synced with the contract guarantee & corridors
    if (profile.vehicleId) {
      const driverOwnedVehicle = await Vehicle.findById(profile.vehicleId).session(session);
      if (driverOwnedVehicle) {
        driverOwnedVehicle.ownershipType = 'DRIVER_OWNED';
        driverOwnedVehicle.minGuaranteePaise = minGuaranteePaise;
        driverOwnedVehicle.perKmRatePaise = perKmRatePaise;
        driverOwnedVehicle.payoutModel = {
          modelType: 'MIN_GUARANTEE_PLUS_KM',
          minGuaranteePaise,
          perKmRatePaise,
          fixedTripPaise: 0,
        };
        driverOwnedVehicle.contractedCorridorIds = corridorObjectIds;
        await driverOwnedVehicle.save({ session: session ?? undefined });
      }
    }

    const termsSnapshot = {
      startDate,
      endDate,
      minGuaranteePaise,
      perKmRatePaise,
      assignedVehicleId: profile.vehicleId ? String(profile.vehicleId) : undefined,
      eligibleCorridorIds: corridorObjectIds.map(String),
    };

    if (contractId) {
      const existing = await DriverContract.findOne({
        _id: contractId,
        driverProfileId: profile._id,
      }).session(session);

      if (!existing) {
        throw new HttpError(404, 'Contract not found for this Tier 1 driver', 'NOT_FOUND');
      }

      existing.platformOwnerId = ownerObjectId;
      existing.startDate = startDate;
      existing.endDate = endDate;
      existing.minimumGuaranteeTerms = {
        minGuaranteePaise,
        perKmRatePaise,
        ...(guaranteedMonthlyDays !== undefined ? { guaranteedMonthlyDays } : {}),
        ...(notes !== undefined ? { notes: notes.trim() } : {}),
      };
      existing.assignedVehicleId = profile.vehicleId;
      existing.eligibleCorridorIds = corridorObjectIds;
      existing.status = status;
      existing.history.push({
        action: 'CONTRACT_UPDATED',
        status,
        actorUserId: ownerObjectId,
        at: now,
        note: changeNote?.trim() || 'Contract terms updated by Platform Owner',
        termsSnapshot,
      });
      await existing.save({ session: session ?? undefined });

      return { contract: existing, driverProfile: profile };
    }

    const [created] = await DriverContract.create(
      [
        {
          contractCode: makeContractCode(),
          platformOwnerId: ownerObjectId,
          driverProfileId: profile._id,
          driverUserId: profile.userId,
          startDate,
          endDate,
          minimumGuaranteeTerms: {
            minGuaranteePaise,
            perKmRatePaise,
            ...(guaranteedMonthlyDays !== undefined ? { guaranteedMonthlyDays } : {}),
            ...(notes ? { notes: notes.trim() } : {}),
          },
          ...(profile.vehicleId ? { assignedVehicleId: profile.vehicleId } : {}),
          eligibleCorridorIds: corridorObjectIds,
          status,
          history: [
            {
              action: 'CONTRACT_CREATED',
              status,
              actorUserId: ownerObjectId,
              at: now,
              note: changeNote?.trim() || 'New Tier 1 contract issued',
              termsSnapshot,
            },
          ],
        },
      ],
      { session: session ?? undefined }
    );

    return { contract: created, driverProfile: profile };
  });
}

/**
 * Centralized Corridor Lifecycle & Slot Template Management for the single Platform Owner:
 * - Search, filter (status, origin, destination, operatingDay) and sort
 * - Create, edit, and activate/deactivate corridors while preserving historical trips/pools
 * - Maintain coupled Slot 1 (flexible returns) and Slot 2 (locked mandatory return) templates
 */
const WEEKDAY_NAMES: Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function getWeekdayCode(date: Date): Weekday {
  return WEEKDAY_NAMES[date.getDay()];
}

function formatDateCompact(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

export interface CorridorListFilters {
  status?: 'ALL' | 'ACTIVE' | 'INACTIVE';
  origin?: string;
  destination?: string;
  operatingDay?: Weekday;
  q?: string;
  sortBy?: 'name' | 'code' | 'updatedAt';
  sortOrder?: 'asc' | 'desc';
}

export interface CorridorStopInput {
  stopCode: string;
  name: string;
  district: string;
  state: string;
  sequenceOrder: number;
  location: {
    type: 'Point';
    coordinates: [number, number];
  };
}

export interface CreateCorridorInput {
  code: string;
  name: string;
  description?: string;
  stops: CorridorStopInput[];
  operatingDays: Weekday[];
  slotSchedules: CorridorSlotSchedule[];
  estimatedOutboundDurationMin?: number;
  turnaroundBufferMin?: number;
  guaranteedCeilingPaisePerKg: number;
  baseRatePaisePerKg: number;
  viabilityThresholdPct?: number;
  isActive?: boolean;
  generateInitialDaysAhead?: number;
}

export interface UpdateCorridorInput {
  name?: string;
  description?: string;
  stops?: CorridorStopInput[];
  operatingDays?: Weekday[];
  slotSchedules?: CorridorSlotSchedule[];
  estimatedOutboundDurationMin?: number;
  turnaroundBufferMin?: number;
  guaranteedCeilingPaisePerKg?: number;
  baseRatePaisePerKg?: number;
  viabilityThresholdPct?: number;
}

function sanitizeCorridorSchedules(schedules: CorridorSlotSchedule[]): CorridorSlotSchedule[] {
  const cleaned: CorridorSlotSchedule[] = schedules.map((s) => ({
    slotNumber: s.slotNumber,
    slotCodeSuffix: (s.slotCodeSuffix || (s.slotNumber === 1 ? 'SLOT1' : 'SLOT2')).trim().toUpperCase(),
    label: s.label.trim(),
    outboundPickupTime: s.outboundPickupTime.trim(),
    returnTimeOptions: (s.returnTimeOptions ?? []).map((t) => t.trim()),
    defaultReturnTime: s.defaultReturnTime.trim(),
    returnTimeLocked: Boolean(s.returnTimeLocked),
    ...(s.lockedReturnTime ? { lockedReturnTime: s.lockedReturnTime.trim() } : {}),
  }));

  const validationError = validateCorridorSlotSchedules(cleaned);
  if (validationError) {
    throw new HttpError(400, validationError, 'INVALID_CORRIDOR_SCHEDULE');
  }
  return cleaned;
}

function normalizeOrderedStops(stops: CorridorStopInput[]): CorridorStop[] {
  if (!Array.isArray(stops) || stops.length < 2) {
    throw new HttpError(
      400,
      'A corridor must configure at least an origin stop and a destination stop (2+ stops).',
      'INVALID_CORRIDOR_STOPS'
    );
  }
  const seenCodes = new Set<string>();
  const sorted = [...stops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  return sorted.map((stop, idx) => {
    const code = stop.stopCode.trim().toUpperCase();
    if (!code) {
      throw new HttpError(400, 'Each stop requires a stopCode.', 'INVALID_CORRIDOR_STOPS');
    }
    if (seenCodes.has(code)) {
      throw new HttpError(400, `Duplicate stopCode '${code}' in corridor stops.`, 'INVALID_CORRIDOR_STOPS');
    }
    seenCodes.add(code);
    return {
      stopCode: code,
      name: stop.name.trim(),
      district: stop.district.trim(),
      state: stop.state.trim() || 'Gujarat',
      sequenceOrder: idx,
      location: {
        type: 'Point',
        coordinates: stop.location.coordinates,
      },
    };
  });
}

async function syncOpenSlotsWithCorridor(
  corridor: ICorridor,
  session: import('mongoose').ClientSession | null
): Promise<number> {
  // IMPORTANT: Update ONLY 'OPEN' slots so locked/completed pools & trips retain original schedule snapshots.
  const openSlots = await Slot.find({
    corridorId: corridor._id,
    status: 'OPEN',
  }).session(session);

  for (const slot of openSlots) {
    const upper = slot.slotCode.toUpperCase();
    const targetNum: 1 | 2 | null =
      slot.slotNumber === 1 || upper.endsWith('-AM') || upper.includes('SLOT1')
        ? 1
        : slot.slotNumber === 2 || upper.endsWith('-PM') || upper.includes('SLOT2')
          ? 2
          : null;
    if (!targetNum) continue;

    const cfg = corridor.slotSchedules.find((x) => x.slotNumber === targetNum);
    if (!cfg) continue;

    const departureAt = applyTimeOnDate(slot.departureDate, cfg.outboundPickupTime);
    const cutoffAt = new Date(departureAt.getTime() - 90 * 60 * 1000);
    const returnStartAt = applyTimeOnDate(slot.departureDate, cfg.defaultReturnTime);
    const latestOption =
      cfg.returnTimeOptions[cfg.returnTimeOptions.length - 1] ?? cfg.defaultReturnTime;
    const returnEndAt = applyTimeOnDate(slot.departureDate, latestOption);

    slot.slotNumber = targetNum;
    slot.label = cfg.label;
    slot.plannedDepartureAt = departureAt;
    slot.cutoffAt = cutoffAt;
    slot.estimatedArrivalStartAt = returnStartAt;
    slot.estimatedArrivalEndAt = returnEndAt;
    slot.returnTimeOptions = cfg.returnTimeOptions;
    slot.returnTimeLocked = cfg.returnTimeLocked;
    slot.lockedReturnTime = cfg.lockedReturnTime;
    await slot.save({ session: session ?? undefined });
  }

  return openSlots.length;
}

async function ensureOpenSlotsForActiveCorridor(params: {
  corridor: ICorridor;
  daysAhead: number;
  session: import('mongoose').ClientSession | null;
}): Promise<number> {
  const { corridor, daysAhead, session } = params;
  if (!corridor.isActive || daysAhead <= 0) {
    return 0;
  }

  const now = new Date();
  let createdCount = 0;

  for (let offset = 1; offset <= daysAhead; offset += 1) {
    const dayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, 0, 0, 0, 0);
    const weekday = getWeekdayCode(dayDate);
    if (!corridor.operatingDays.includes(weekday)) {
      continue;
    }

    const compactDate = formatDateCompact(dayDate);
    for (const cfg of corridor.slotSchedules) {
      const suffix = cfg.slotCodeSuffix || (cfg.slotNumber === 1 ? 'SLOT1' : 'SLOT2');
      const slotCode = `${corridor.code}-${compactDate}-${suffix}`;
      const existing = await Slot.findOne({ slotCode }).session(session);
      if (existing) continue;

      const departureAt = applyTimeOnDate(dayDate, cfg.outboundPickupTime);
      const cutoffAt = new Date(departureAt.getTime() - 90 * 60 * 1000);
      const returnStartAt = applyTimeOnDate(dayDate, cfg.defaultReturnTime);
      const latestOption =
        cfg.returnTimeOptions[cfg.returnTimeOptions.length - 1] ?? cfg.defaultReturnTime;
      const returnEndAt = applyTimeOnDate(dayDate, latestOption);

      await Slot.create(
        [
          {
            corridorId: corridor._id,
            slotNumber: cfg.slotNumber,
            slotCode,
            label: cfg.label,
            departureDate: dayDate,
            cutoffAt,
            plannedDepartureAt: departureAt,
            estimatedArrivalStartAt: returnStartAt,
            estimatedArrivalEndAt: returnEndAt,
            returnTimeOptions: cfg.returnTimeOptions,
            returnTimeLocked: cfg.returnTimeLocked,
            lockedReturnTime: cfg.lockedReturnTime,
            capacityWeightKg: 1800,
            capacityVolumeCbm: 9.0,
            reservedWeightKg: 0,
            reservedVolumeCbm: 0,
            status: 'OPEN',
          },
        ],
        { session: session ?? undefined }
      );
      createdCount += 1;
    }
  }

  return createdCount;
}

export async function listCorridorsForOwner(
  platformOwnerId: string,
  filters: CorridorListFilters = {}
) {
  await assertSinglePlatformOwnerActor(platformOwnerId);

  const allCorridors = await Corridor.find({});
  const originOptions = Array.from(
    new Set(
      allCorridors
        .map((c) => c.stops[0]?.name || c.stops[0]?.district)
        .filter((v): v is string => Boolean(v))
    )
  ).sort();
  const destinationOptions = Array.from(
    new Set(
      allCorridors
        .map((c) => c.stops[c.stops.length - 1]?.name || c.stops[c.stops.length - 1]?.district)
        .filter((v): v is string => Boolean(v))
    )
  ).sort();

  const statusFilter = filters.status ?? 'ALL';
  const originNeedle = filters.origin?.trim().toLowerCase() || '';
  const destinationNeedle = filters.destination?.trim().toLowerCase() || '';
  const operatingDayFilter = filters.operatingDay;
  const searchNeedle = filters.q?.trim().toLowerCase() || '';

  const filtered = allCorridors.filter((corridor) => {
    if (statusFilter === 'ACTIVE' && !corridor.isActive) return false;
    if (statusFilter === 'INACTIVE' && corridor.isActive) return false;

    const firstStop = corridor.stops[0];
    const lastStop = corridor.stops[corridor.stops.length - 1];

    if (originNeedle) {
      const originMatches =
        firstStop?.name.toLowerCase().includes(originNeedle) ||
        firstStop?.district.toLowerCase().includes(originNeedle) ||
        firstStop?.stopCode.toLowerCase().includes(originNeedle);
      if (!originMatches) return false;
    }

    if (destinationNeedle) {
      const destMatches =
        lastStop?.name.toLowerCase().includes(destinationNeedle) ||
        lastStop?.district.toLowerCase().includes(destinationNeedle) ||
        lastStop?.stopCode.toLowerCase().includes(destinationNeedle);
      if (!destMatches) return false;
    }

    if (operatingDayFilter && !corridor.operatingDays.includes(operatingDayFilter)) {
      return false;
    }

    if (searchNeedle) {
      const matchesMeta =
        corridor.code.toLowerCase().includes(searchNeedle) ||
        corridor.name.toLowerCase().includes(searchNeedle) ||
        (corridor.description?.toLowerCase().includes(searchNeedle) ?? false);
      const matchesStops = corridor.stops.some(
        (stop) =>
          stop.name.toLowerCase().includes(searchNeedle) ||
          stop.district.toLowerCase().includes(searchNeedle) ||
          stop.stopCode.toLowerCase().includes(searchNeedle)
      );
      if (!matchesMeta && !matchesStops) return false;
    }

    return true;
  });

  const sortBy = filters.sortBy ?? 'code';
  const defaultOrder = sortBy === 'updatedAt' ? 'desc' : 'asc';
  const sortDir = (filters.sortOrder ?? defaultOrder) === 'desc' ? -1 : 1;

  filtered.sort((a, b) => {
    if (sortBy === 'name') {
      return a.name.localeCompare(b.name) * sortDir;
    }
    if (sortBy === 'updatedAt') {
      return (new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime()) * sortDir;
    }
    return a.code.localeCompare(b.code) * sortDir;
  });

  return {
    corridors: filtered,
    facets: {
      origins: originOptions,
      destinations: destinationOptions,
      totalCount: allCorridors.length,
      activeCount: allCorridors.filter((c) => c.isActive).length,
      inactiveCount: allCorridors.filter((c) => !c.isActive).length,
    },
  };
}

export async function createCorridorForOwner(params: {
  platformOwnerId: string;
  input: CreateCorridorInput;
}) {
  const { platformOwnerId, input } = params;
  await assertSinglePlatformOwnerActor(platformOwnerId);

  const normalizedCode = input.code.trim().toUpperCase();
  if (!normalizedCode || normalizedCode.length < 3) {
    throw new HttpError(400, 'Corridor code must be at least 3 characters.', 'VALIDATION_ERROR');
  }
  const normalizedStops = normalizeOrderedStops(input.stops);
  const normalizedSchedules = sanitizeCorridorSchedules(input.slotSchedules);

  if (input.guaranteedCeilingPaisePerKg < input.baseRatePaisePerKg) {
    throw new HttpError(
      400,
      'Guaranteed ceiling rate must be greater than or equal to base rate.',
      'VALIDATION_ERROR'
    );
  }

  return withTransaction(async (session) => {
    const existingCode = await Corridor.findOne({ code: normalizedCode }).session(session);
    if (existingCode) {
      throw new HttpError(
        409,
        `Corridor code '${normalizedCode}' already exists.`,
        'CORRIDOR_CODE_EXISTS'
      );
    }

    const isActive = input.isActive ?? true;
    const [created] = await Corridor.create(
      [
        {
          code: normalizedCode,
          name: input.name.trim(),
          description: input.description?.trim() || undefined,
          stops: normalizedStops,
          operatingDays: Array.from(new Set(input.operatingDays)),
          slotSchedules: normalizedSchedules,
          estimatedOutboundDurationMin: input.estimatedOutboundDurationMin ?? 120,
          turnaroundBufferMin: input.turnaroundBufferMin ?? 30,
          isEstablishedRoute: true,
          guaranteedCeilingPaisePerKg: input.guaranteedCeilingPaisePerKg,
          baseRatePaisePerKg: input.baseRatePaisePerKg,
          viabilityThresholdPct: input.viabilityThresholdPct ?? 50,
          isDemoData: false,
          isActive,
        },
      ],
      { session: session ?? undefined }
    );

    const createdOpenSlotsCount = await ensureOpenSlotsForActiveCorridor({
      corridor: created,
      daysAhead: input.generateInitialDaysAhead ?? (isActive ? 2 : 0),
      session,
    });

    return { corridor: created, createdOpenSlotsCount };
  });
}

export async function updateCorridorForOwner(params: {
  platformOwnerId: string;
  corridorId: string;
  input: UpdateCorridorInput;
}) {
  const { platformOwnerId, corridorId, input } = params;
  await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(corridorId)) {
    throw new HttpError(400, 'Invalid corridorId', 'VALIDATION_ERROR');
  }

  const normalizedStops = input.stops ? normalizeOrderedStops(input.stops) : undefined;
  const normalizedSchedules = input.slotSchedules
    ? sanitizeCorridorSchedules(input.slotSchedules)
    : undefined;

  return withTransaction(async (session) => {
    const corridor = await Corridor.findById(corridorId).session(session);
    if (!corridor) {
      throw new HttpError(404, 'Corridor not found', 'CORRIDOR_NOT_FOUND');
    }

    if (input.name !== undefined) corridor.name = input.name.trim();
    if (input.description !== undefined) corridor.description = input.description.trim() || undefined;
    if (normalizedStops) corridor.stops = normalizedStops;
    if (input.operatingDays && input.operatingDays.length > 0) {
      corridor.operatingDays = Array.from(new Set(input.operatingDays));
    }
    if (normalizedSchedules) corridor.slotSchedules = normalizedSchedules;
    if (input.estimatedOutboundDurationMin !== undefined) {
      corridor.estimatedOutboundDurationMin = input.estimatedOutboundDurationMin;
    }
    if (input.turnaroundBufferMin !== undefined) {
      corridor.turnaroundBufferMin = input.turnaroundBufferMin;
    }
    if (input.guaranteedCeilingPaisePerKg !== undefined) {
      corridor.guaranteedCeilingPaisePerKg = input.guaranteedCeilingPaisePerKg;
    }
    if (input.baseRatePaisePerKg !== undefined) {
      corridor.baseRatePaisePerKg = input.baseRatePaisePerKg;
    }
    if (input.viabilityThresholdPct !== undefined) {
      corridor.viabilityThresholdPct = input.viabilityThresholdPct;
    }

    if (corridor.guaranteedCeilingPaisePerKg < corridor.baseRatePaisePerKg) {
      throw new HttpError(
        400,
        'Guaranteed ceiling rate must be greater than or equal to base rate.',
        'VALIDATION_ERROR'
      );
    }

    await corridor.save({ session: session ?? undefined });
    const syncedOpenSlotsCount = await syncOpenSlotsWithCorridor(corridor, session);

    return { corridor, syncedOpenSlotsCount };
  });
}

export async function toggleCorridorActiveStatus(params: {
  platformOwnerId: string;
  corridorId: string;
  isActive: boolean;
  ensureDaysAhead?: number;
}) {
  const { platformOwnerId, corridorId, isActive, ensureDaysAhead = 2 } = params;
  await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(corridorId)) {
    throw new HttpError(400, 'Invalid corridorId', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const corridor = await Corridor.findById(corridorId).session(session);
    if (!corridor) {
      throw new HttpError(404, 'Corridor not found', 'CORRIDOR_NOT_FOUND');
    }

    corridor.isActive = isActive;
    await corridor.save({ session: session ?? undefined });

    let createdOpenSlotsCount = 0;
    if (isActive && ensureDaysAhead > 0) {
      createdOpenSlotsCount = await ensureOpenSlotsForActiveCorridor({
        corridor,
        daysAhead: ensureDaysAhead,
        session,
      });
    }

    return { corridor, createdOpenSlotsCount };
  });
}

export async function updateCentralCorridorSchedule(params: {
  platformOwnerId: string;
  corridorId: string;
  operatingDays?: Weekday[];
  slotSchedules: CorridorSlotSchedule[];
}) {
  const { platformOwnerId, corridorId, operatingDays, slotSchedules } = params;
  await assertSinglePlatformOwnerActor(platformOwnerId);

  if (!isValidObjectId(corridorId)) {
    throw new HttpError(400, 'Invalid corridorId', 'VALIDATION_ERROR');
  }

  // Ensure Slot 2 remains strictly locked to its configured mandatory return timing
  const coercedSchedules: CorridorSlotSchedule[] = slotSchedules.map((s) => {
    if (s.slotNumber === 2) {
      const mandatoryReturn =
        s.lockedReturnTime?.trim() || s.defaultReturnTime?.trim() || s.returnTimeOptions?.[0]?.trim() || '';
      return {
        ...s,
        returnTimeLocked: true,
        lockedReturnTime: mandatoryReturn,
        defaultReturnTime: mandatoryReturn,
        returnTimeOptions: mandatoryReturn ? [mandatoryReturn] : [],
      };
    }
    return s;
  });

  const normalized = sanitizeCorridorSchedules(coercedSchedules);

  return withTransaction(async (session) => {
    const corridor = await Corridor.findById(corridorId).session(session);
    if (!corridor) {
      throw new HttpError(404, 'Corridor not found', 'CORRIDOR_NOT_FOUND');
    }

    if (operatingDays && operatingDays.length > 0) {
      corridor.operatingDays = Array.from(new Set(operatingDays));
    }
    corridor.slotSchedules = normalized;
    await corridor.save({ session: session ?? undefined });

    const syncedOpenSlotsCount = await syncOpenSlotsWithCorridor(corridor, session);

    return { corridor, syncedOpenSlotsCount };
  });
}

/**
 * Safely migrates all existing Tier 1 drivers, contracts, driver-owned vehicles,
 * and centralized corridor slot schedules without dropping driver or contract data.
 */
export async function migrateToSinglePlatformOwner(params?: {
  canonicalOwnerId?: Types.ObjectId | string;
}): Promise<{
  canonicalOwnerId: Types.ObjectId | null;
  reassignedTier1DriversCount: number;
  reassignedContractsCount: number;
  reclassifiedToTier2Count: number;
  normalizedStatusCount: number;
  migratedVehiclesCount: number;
  migratedCorridorsCount: number;
}> {
  let reassignedTier1DriversCount = 0;
  let reassignedContractsCount = 0;
  let reclassifiedToTier2Count = 0;
  let normalizedStatusCount = 0;
  let migratedVehiclesCount = 0;
  let migratedCorridorsCount = 0;

  let ownerObjectId: Types.ObjectId | null = params?.canonicalOwnerId
    ? new Types.ObjectId(String(params.canonicalOwnerId))
    : null;

  if (!ownerObjectId) {
    const ownerUser = await User.findOne({ role: 'PLATFORM_OWNER', isActive: true }).sort({
      createdAt: 1,
    });
    if (ownerUser) {
      ownerObjectId = ownerUser._id;
    }
  }

  // 1. Migrate legacy Corridor documents missing coupled 2-slot schedules
  const allCorridors = await Corridor.find({});
  for (const corridor of allCorridors) {
    if (!corridor.slotSchedules || corridor.slotSchedules.length !== 2) {
      corridor.slotSchedules = DEFAULT_CORRIDOR_SLOT_SCHEDULES;
      await corridor.save();
      migratedCorridorsCount += 1;
    }
  }

  // 2. Migrate legacy Vehicle ownership/bodyType/operationalStatus/documents
  const allVehicles = await Vehicle.find({});
  for (const vehicle of allVehicles) {
    let vDirty = false;
    if (vehicle.tier === 'TIER_1' && vehicle.ownershipType !== 'DRIVER_OWNED') {
      vehicle.ownershipType = 'DRIVER_OWNED';
      vDirty = true;
    } else if (vehicle.tier !== 'TIER_1' && !vehicle.ownershipType) {
      vehicle.ownershipType = 'MARKETPLACE';
      vDirty = true;
    }
    if (!vehicle.bodyType) {
      vehicle.bodyType = 'CLOSED_BODY';
      vDirty = true;
    }
    if (!vehicle.operationalStatus) {
      vehicle.operationalStatus = vehicle.isAvailable ? 'ACTIVE' : 'INACTIVE';
      vDirty = true;
    }
    if (!vehicle.documents?.verificationStatus) {
      vehicle.documents = {
        ...vehicle.documents,
        verificationStatus: vehicle.tier === 'TIER_1' ? 'VERIFIED' : 'PENDING',
      };
      vDirty = true;
    }
    if (
      vehicle.tier === 'TIER_1' &&
      vehicle.operatorName.toLowerCase().includes('meecargo attached partner')
    ) {
      vehicle.operatorName = 'Tier 1 Driver-Owned Vehicle';
      vDirty = true;
    }
    if (vDirty) {
      await vehicle.save();
      migratedVehiclesCount += 1;
    }
  }

  // 3. Migrate DriverProfiles and DriverContracts cleanly
  const allProfiles = await DriverProfile.find({});
  const now = new Date();
  const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  for (const profile of allProfiles) {
    let dirty = false;

    if (!profile.accountStatus) {
      profile.accountStatus = 'ACTIVE';
      dirty = true;
      normalizedStatusCount += 1;
    }

    if (profile.fleetTier === 'TIER_1') {
      if (ownerObjectId) {
        if (!profile.platformOwnerId || !profile.platformOwnerId.equals(ownerObjectId)) {
          profile.platformOwnerId = ownerObjectId;
          dirty = true;
          reassignedTier1DriversCount += 1;
        }

        const existingContract = await DriverContract.findOne({
          driverProfileId: profile._id,
        });
        if (!existingContract) {
          await DriverContract.create({
            contractCode: makeContractCode(),
            platformOwnerId: ownerObjectId,
            driverProfileId: profile._id,
            driverUserId: profile.userId,
            startDate: now,
            endDate: oneYearLater,
            minimumGuaranteeTerms: {
              minGuaranteePaise: 320000,
              perKmRatePaise: 2400,
              guaranteedMonthlyDays: 24,
              notes: 'Consolidated Tier 1 contract baseline',
            },
            ...(profile.vehicleId ? { assignedVehicleId: profile.vehicleId } : {}),
            eligibleCorridorIds: [],
            status: 'ACTIVE',
            history: [
              {
                action: 'CONTRACT_MIGRATED',
                status: 'ACTIVE',
                actorUserId: ownerObjectId,
                at: now,
                note: 'Tier 1 driver linked to singleton Platform Owner',
              },
            ],
          });
        }
      } else {
        profile.fleetTier = 'TIER_2';
        profile.platformOwnerId = undefined;
        dirty = true;
        reclassifiedToTier2Count += 1;
      }
    }

    if (dirty) {
      await profile.save();
    }
  }

  if (ownerObjectId) {
    const contractUpdate = await DriverContract.updateMany(
      { platformOwnerId: { $ne: ownerObjectId } },
      { $set: { platformOwnerId: ownerObjectId } }
    );
    reassignedContractsCount = contractUpdate.modifiedCount ?? 0;
  }

  return {
    canonicalOwnerId: ownerObjectId,
    reassignedTier1DriversCount,
    reassignedContractsCount,
    reclassifiedToTier2Count,
    normalizedStatusCount,
    migratedVehiclesCount,
    migratedCorridorsCount,
  };
}

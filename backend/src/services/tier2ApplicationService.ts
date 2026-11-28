import crypto from 'node:crypto';
import { isValidObjectId, type ClientSession, Types } from 'mongoose';
import { z } from 'zod';
import { withTransaction } from '../config/database.js';
import { DriverProfile, type IDriverProfile } from '../models/DriverProfile.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { Shipment, type IShipment } from '../models/Shipment.js';
import {
  Tier2Application,
  type Tier2ApplicationStatus,
  type Tier2DocumentType,
  type Tier2UploadedDocument,
} from '../models/Tier2Application.js';
import { Trip } from '../models/Trip.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { HttpError } from '../utils/errors.js';
import { hashPassword } from './authService.js';
import {
  ALLOWED_DRIVER_DOC_MIME,
  MAX_DRIVER_DOC_BYTES,
  saveDriverDocumentLocal,
} from './driverDocumentStorage.js';
import { computeVehiclePayoutPaise, doesCargoFitVehicle } from './fleetAllocator.js';

export const tier2ApplicationSubmissionSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(20),
  address: z.object({
    addressLine: z.string().trim().min(3).max(250),
    cityOrTown: z.string().trim().min(2).max(100),
    district: z.string().trim().min(2).max(100),
    state: z.string().trim().min(2).max(80).default('Gujarat'),
    pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  }),
  identity: z.object({
    licenseNumber: z.string().trim().min(4).max(40),
    idProofType: z.enum(['AADHAAR', 'PAN', 'PASSPORT', 'VOTER_ID']),
    idProofNumber: z.string().trim().min(4).max(40),
  }),
  vehicle: z.object({
    registrationNumber: z.string().trim().min(4).max(30),
    vehicleCategory: z.string().trim().min(2).max(80),
    bodyType: z.enum(['CLOSED_BODY', 'OPEN_BODY', 'CONTAINER', 'FLATBED', 'MINI_PICKUP']),
    maxWeightKg: z.coerce.number().min(100),
    bedLengthCm: z.coerce.number().min(50),
    bedWidthCm: z.coerce.number().min(50),
    bedHeightCm: z.coerce.number().min(50),
    maxVolumeCbm: z.coerce.number().positive().optional(),
    perKmRatePaise: z.coerce.number().int().min(500).max(20000).default(1900),
  }),
  documents: z.object({
    rcNumber: z.string().trim().min(4).max(40),
    insurancePolicyNumber: z.string().trim().min(4).max(60),
    insuranceValidUntil: z.coerce.date().optional(),
    fitnessValidUntil: z.coerce.date().optional(),
    permitNotes: z.string().trim().max(200).optional(),
  }),
});

export type Tier2ApplicationSubmissionInput = z.infer<typeof tier2ApplicationSubmissionSchema>;

export const publicTier2ApplySchema = tier2ApplicationSubmissionSchema.extend({
  email: z.string().trim().email('Valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

export type PublicTier2ApplyInput = z.infer<typeof publicTier2ApplySchema>;

export function generateTier2ApplicationRef(now: Date = new Date()): string {
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randPart = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `MC-T2-${datePart}-${randPart}`;
}

export function getTier2VerificationPolicy() {
  return {
    requiredDocuments: [
      {
        docType: 'DRIVING_LICENSE' as Tier2DocumentType,
        fieldName: 'licenseFile',
        label: 'Commercial Driving License',
        required: true,
      },
      {
        docType: 'IDENTITY_PROOF' as Tier2DocumentType,
        fieldName: 'idProofFile',
        label: 'Government Identity Proof (Aadhaar / PAN / Passport / Voter ID)',
        required: true,
      },
      {
        docType: 'VEHICLE_RC' as Tier2DocumentType,
        fieldName: 'rcFile',
        label: 'Vehicle Registration Certificate (RC)',
        required: true,
      },
      {
        docType: 'INSURANCE_POLICY' as Tier2DocumentType,
        fieldName: 'insuranceFile',
        label: 'Commercial Goods Insurance Policy',
        required: true,
      },
    ],
    allowedMimeTypes: Array.from(ALLOWED_DRIVER_DOC_MIME),
    maxFileSizeBytes: MAX_DRIVER_DOC_BYTES,
    payoutPolicySummary:
      'Tier 2 drivers participate independently on per-km marketplace payouts without Tier 1 contracts or minimum guarantees.',
  };
}

function computeVolumeCbm(v: {
  bedLengthCm: number;
  bedWidthCm: number;
  bedHeightCm: number;
  maxVolumeCbm?: number;
}): number {
  if (v.maxVolumeCbm && v.maxVolumeCbm > 0) {
    return Number(v.maxVolumeCbm.toFixed(2));
  }
  return Number(
    ((v.bedLengthCm * v.bedWidthCm * v.bedHeightCm) / 1_000_000).toFixed(2)
  );
}

/**
 * Verifies a driver account has active APPROVED Tier 2 eligibility when tier === TIER_2.
 * Blocks PENDING or REJECTED Tier 2 applicants from marketplace dispatch or trip acceptance.
 */
export async function assertApprovedTier2Driver(
  driverUserId: string | Types.ObjectId,
  session?: ClientSession | null
): Promise<IDriverProfile> {
  const profile =
    session !== undefined
      ? await DriverProfile.findOne({ userId: driverUserId }).session(session)
      : await DriverProfile.findOne({ userId: driverUserId });
  if (!profile) {
    throw new HttpError(403, 'Driver profile not found.', 'DRIVER_PROFILE_REQUIRED');
  }
  if (profile.accountStatus !== 'ACTIVE') {
    throw new HttpError(
      403,
      `Your driver account is ${profile.accountStatus} and cannot operate trips.`,
      'DRIVER_ACCOUNT_INACTIVE'
    );
  }
  if (profile.fleetTier === 'TIER_2' && profile.tier2ApplicationStatus !== 'APPROVED') {
    throw new HttpError(
      403,
      profile.tier2ApplicationStatus === 'REJECTED'
        ? 'Your Tier 2 application was rejected. Resubmit an updated application for Platform Owner review.'
        : 'Your Tier 2 driver application is pending Platform Owner approval. Marketplace trips remain locked until approved.',
      'TIER2_NOT_APPROVED'
    );
  }
  return profile;
}

export async function getDriverTier2ApplicationState(driverUserId: string) {
  const [profile, application] = await Promise.all([
    DriverProfile.findOne({ userId: driverUserId }).populate('vehicleId'),
    Tier2Application.findOne({ userId: driverUserId }),
  ]);

  return {
    driverProfile: profile,
    application,
    applicationStatus:
      application?.status ?? profile?.tier2ApplicationStatus ?? ('PENDING' as Tier2ApplicationStatus),
  };
}

export async function submitOrResubmitTier2Application(params: {
  driverUserId: string;
  input: Tier2ApplicationSubmissionInput;
  uploadedDocuments?: Tier2UploadedDocument[];
}) {
  const { driverUserId, input, uploadedDocuments } = params;
  if (!isValidObjectId(driverUserId)) {
    throw new HttpError(400, 'Invalid driver user identifier', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const user = await User.findById(driverUserId).session(session);
    if (!user || user.role !== 'DRIVER') {
      throw new HttpError(403, 'Only driver accounts can submit Tier 2 applications.', 'FORBIDDEN');
    }

    const existingProfile = await DriverProfile.findOne({ userId: user._id }).session(session);
    if (existingProfile?.fleetTier === 'TIER_1') {
      throw new HttpError(
        409,
        'Tier 1 contract drivers cannot submit a Tier 2 marketplace application.',
        'TIER1_CANNOT_APPLY_TIER2'
      );
    }

    const existingApp = await Tier2Application.findOne({ userId: user._id }).session(session);
    if (existingApp?.status === 'APPROVED') {
      throw new HttpError(
        409,
        'Your Tier 2 driver application is already approved.',
        'APPLICATION_ALREADY_APPROVED'
      );
    }

    const regUpper = input.vehicle.registrationNumber.trim().toUpperCase();
    const conflictingVehicle = await Vehicle.findOne({
      registrationNumber: regUpper,
      driverId: { $ne: user._id },
    }).session(session);
    if (conflictingVehicle) {
      throw new HttpError(
        409,
        `Vehicle registration ${regUpper} is already registered to another driver.`,
        'VEHICLE_ALREADY_REGISTERED'
      );
    }

    const conflictingOtherApp = await Tier2Application.findOne({
      'vehicle.registrationNumber': regUpper,
      userId: { $ne: user._id },
      status: { $in: ['PENDING', 'APPROVED'] },
    }).session(session);
    if (conflictingOtherApp) {
      throw new HttpError(
        409,
        `An active Tier 2 application already uses registration ${regUpper}.`,
        'VEHICLE_ALREADY_IN_APPLICATION'
      );
    }

    const now = new Date();
    const maxVolumeCbm = computeVolumeCbm(input.vehicle);
    const isResubmission = existingApp?.status === 'REJECTED';

    const profile = await DriverProfile.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id,
          name: input.fullName,
          phone: input.phone,
          fleetTier: 'TIER_2',
          tier2ApplicationStatus: 'PENDING',
          availabilityStatus: 'OFFLINE',
          accountStatus: 'ACTIVE',
          licenseNumber: input.identity.licenseNumber.trim().toUpperCase(),
          homeBase: `${input.address.cityOrTown}, ${input.address.district}`,
        },
        $unset: { platformOwnerId: '' },
      },
      { upsert: true, returnDocument: 'after', runValidators: true, session: session ?? undefined }
    );

    const action = isResubmission ? 'RESUBMITTED' : 'SUBMITTED';
    const historyEntry = {
      action: action as 'SUBMITTED' | 'RESUBMITTED',
      status: 'PENDING' as const,
      actorUserId: user._id,
      at: now,
      note: isResubmission
        ? 'Applicant updated and resubmitted rejected Tier 2 application'
        : 'Applicant submitted Tier 2 marketplace driver application',
    };

    let application;
    if (existingApp) {
      if (!existingApp.applicationRef) {
        existingApp.applicationRef = generateTier2ApplicationRef(now);
      }
      existingApp.driverProfileId = profile._id;
      existingApp.fullName = input.fullName;
      existingApp.email = user.email.toLowerCase();
      existingApp.phone = input.phone;
      existingApp.address = input.address;
      existingApp.identity = {
        licenseNumber: input.identity.licenseNumber.trim().toUpperCase(),
        idProofType: input.identity.idProofType,
        idProofNumber: input.identity.idProofNumber.trim().toUpperCase(),
      };
      existingApp.vehicle = {
        ...input.vehicle,
        registrationNumber: regUpper,
        maxVolumeCbm,
      };
      existingApp.documents = {
        rcNumber: input.documents.rcNumber.trim().toUpperCase(),
        insurancePolicyNumber: input.documents.insurancePolicyNumber.trim().toUpperCase(),
        insuranceValidUntil: input.documents.insuranceValidUntil,
        fitnessValidUntil: input.documents.fitnessValidUntil,
        permitNotes: input.documents.permitNotes,
        verificationStatus: 'PENDING',
      };
      if (uploadedDocuments && uploadedDocuments.length > 0) {
        const byType = new Map(existingApp.uploadedDocuments.map((d) => [d.docType, d]));
        for (const doc of uploadedDocuments) {
          byType.set(doc.docType, doc);
        }
        existingApp.uploadedDocuments = Array.from(byType.values());
      }
      existingApp.status = 'PENDING';
      existingApp.appliedAt = now;
      existingApp.rejectionReason = undefined;
      existingApp.rejectedAt = undefined;
      existingApp.reviewNote = undefined;
      if (isResubmission) {
        existingApp.resubmissionCount = (existingApp.resubmissionCount ?? 0) + 1;
      }
      existingApp.decisionHistory.push(historyEntry);
      await existingApp.save({ session: session ?? undefined });
      application = existingApp;
    } else {
      const [created] = await Tier2Application.create(
        [
          {
            applicationRef: generateTier2ApplicationRef(now),
            userId: user._id,
            driverProfileId: profile._id,
            fullName: input.fullName,
            email: user.email.toLowerCase(),
            phone: input.phone,
            address: input.address,
            identity: {
              licenseNumber: input.identity.licenseNumber.trim().toUpperCase(),
              idProofType: input.identity.idProofType,
              idProofNumber: input.identity.idProofNumber.trim().toUpperCase(),
            },
            vehicle: {
              ...input.vehicle,
              registrationNumber: regUpper,
              maxVolumeCbm,
            },
            documents: {
              rcNumber: input.documents.rcNumber.trim().toUpperCase(),
              insurancePolicyNumber: input.documents.insurancePolicyNumber.trim().toUpperCase(),
              insuranceValidUntil: input.documents.insuranceValidUntil,
              fitnessValidUntil: input.documents.fitnessValidUntil,
              permitNotes: input.documents.permitNotes,
              verificationStatus: 'PENDING',
            },
            uploadedDocuments: uploadedDocuments ?? [],
            status: 'PENDING',
            appliedAt: now,
            resubmissionCount: 0,
            decisionHistory: [historyEntry],
          },
        ],
        { session: session ?? undefined }
      );
      application = created;
    }

    profile.tier2ApplicationId = application._id;
    await profile.save({ session: session ?? undefined });

    return { application, driverProfile: profile };
  });
}

/**
 * Public intake workflow (MC-064): registers a new independent Tier 2 driver applicant
 * with login credentials, personal/vehicle specs, and required verification documents,
 * leaving marketplace eligibility locked until Platform Owner approval.
 */
export async function submitPublicTier2Application(params: {
  input: PublicTier2ApplyInput;
  filesByDocType: Partial<
    Record<
      Tier2DocumentType,
      { buffer: Buffer; mimetype: string; size: number; originalname?: string }
    >
  >;
}) {
  const { input, filesByDocType } = params;
  const emailLower = input.email.trim().toLowerCase();
  const regUpper = input.vehicle.registrationNumber.trim().toUpperCase();
  const policy = getTier2VerificationPolicy();

  const missingLabels = policy.requiredDocuments
    .filter((reqDoc) => reqDoc.required && !filesByDocType[reqDoc.docType])
    .map((d) => d.label);

  if (missingLabels.length > 0) {
    throw new HttpError(
      400,
      `Missing required verification document upload(s): ${missingLabels.join(', ')}.`,
      'REQUIRED_DOCUMENTS_MISSING'
    );
  }

  const [existingUser, conflictingVehicle, conflictingApp] = await Promise.all([
    User.findOne({ email: emailLower }),
    Vehicle.findOne({ registrationNumber: regUpper }),
    Tier2Application.findOne({
      $or: [{ email: emailLower }, { 'vehicle.registrationNumber': regUpper }],
      status: { $in: ['PENDING', 'APPROVED'] },
    }),
  ]);

  if (existingUser) {
    throw new HttpError(
      409,
      'An account or active driver application with this email already exists. Sign in via Driver Login to check your status or update an application.',
      'DUPLICATE_APPLICATION'
    );
  }
  if (conflictingVehicle || conflictingApp) {
    throw new HttpError(
      409,
      `An active vehicle or driver application already uses registration ${regUpper}.`,
      'VEHICLE_ALREADY_REGISTERED'
    );
  }

  const now = new Date();
  const uploadedDocuments: Tier2UploadedDocument[] = [];
  for (const reqDoc of policy.requiredDocuments) {
    const file = filesByDocType[reqDoc.docType];
    if (!file) continue;
    const saved = await saveDriverDocumentLocal(file);
    uploadedDocuments.push({
      docType: reqDoc.docType,
      originalName: saved.originalName,
      mimeType: saved.mimeType,
      sizeBytes: saved.sizeBytes,
      storageKey: saved.storageKey,
      uploadedAt: now,
    });
  }

  const passwordHash = await hashPassword(input.password);
  const maxVolumeCbm = computeVolumeCbm(input.vehicle);

  return withTransaction(async (session) => {
    const [user] = await User.create(
      [
        {
          name: input.fullName,
          email: emailLower,
          phone: input.phone,
          passwordHash,
          role: 'DRIVER',
          isActive: true,
        },
      ],
      { session: session ?? undefined }
    );

    const [profile] = await DriverProfile.create(
      [
        {
          userId: user._id,
          name: input.fullName,
          phone: input.phone,
          fleetTier: 'TIER_2',
          tier2ApplicationStatus: 'PENDING',
          availabilityStatus: 'OFFLINE',
          accountStatus: 'ACTIVE',
          licenseNumber: input.identity.licenseNumber.trim().toUpperCase(),
          homeBase: `${input.address.cityOrTown}, ${input.address.district}`,
        },
      ],
      { session: session ?? undefined }
    );

    const applicationRef = generateTier2ApplicationRef(now);
    const [application] = await Tier2Application.create(
      [
        {
          applicationRef,
          userId: user._id,
          driverProfileId: profile._id,
          fullName: input.fullName,
          email: emailLower,
          phone: input.phone,
          address: input.address,
          identity: {
            licenseNumber: input.identity.licenseNumber.trim().toUpperCase(),
            idProofType: input.identity.idProofType,
            idProofNumber: input.identity.idProofNumber.trim().toUpperCase(),
          },
          vehicle: {
            ...input.vehicle,
            registrationNumber: regUpper,
            maxVolumeCbm,
          },
          documents: {
            rcNumber: input.documents.rcNumber.trim().toUpperCase(),
            insurancePolicyNumber: input.documents.insurancePolicyNumber.trim().toUpperCase(),
            insuranceValidUntil: input.documents.insuranceValidUntil,
            fitnessValidUntil: input.documents.fitnessValidUntil,
            permitNotes: input.documents.permitNotes,
            verificationStatus: 'PENDING',
          },
          uploadedDocuments,
          status: 'PENDING',
          appliedAt: now,
          resubmissionCount: 0,
          decisionHistory: [
            {
              action: 'SUBMITTED',
              status: 'PENDING',
              actorUserId: user._id,
              at: now,
              note: `Public Tier 2 application ${applicationRef} submitted with ${uploadedDocuments.length} verification document(s)`,
            },
          ],
        },
      ],
      { session: session ?? undefined }
    );

    profile.tier2ApplicationId = application._id;
    await profile.save({ session: session ?? undefined });

    return { user, driverProfile: profile, application };
  });
}

export async function lookupPublicTier2ApplicationStatus(params: {
  applicationRef: string;
  email: string;
}) {
  const refUpper = params.applicationRef.trim().toUpperCase();
  const emailLower = params.email.trim().toLowerCase();

  const application = await Tier2Application.findOne({
    applicationRef: refUpper,
    email: emailLower,
  }).lean();

  if (!application) {
    throw new HttpError(
      404,
      'No application found matching that reference number and email address.',
      'APPLICATION_NOT_FOUND'
    );
  }

  const nextSteps =
    application.status === 'APPROVED'
      ? 'Your Tier 2 application is approved. Sign in via Driver Login to view marketplace trip opportunities.'
      : application.status === 'REJECTED'
        ? 'Sign in via Driver Login to review the rejection reason, update your details/documents, and resubmit your application.'
        : 'Your application and uploaded documents are under review by the Platform Owner. Check back here or sign in to Driver Portal for updates.';

  return {
    applicationRef: application.applicationRef,
    status: application.status,
    appliedAt: application.appliedAt,
    reviewedAt: application.reviewedAt,
    approvedAt: application.approvedAt,
    rejectedAt: application.rejectedAt,
    rejectionReason: application.status === 'REJECTED' ? application.rejectionReason : undefined,
    vehicleRegistrationNumber: application.vehicle.registrationNumber,
    vehicleCategory: application.vehicle.vehicleCategory,
    documentsVerificationStatus: application.documents.verificationStatus,
    uploadedDocumentsCount: application.uploadedDocuments?.length ?? 0,
    nextSteps,
  };
}

export async function listTier2ApplicationsForOwner(params?: {
  status?: Tier2ApplicationStatus | 'ALL';
  search?: string;
}) {
  const statusFilter = params?.status;
  const search = params?.search?.trim();

  const query: Record<string, unknown> = {};
  if (statusFilter && statusFilter !== 'ALL') {
    query.status = statusFilter;
  }
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    query.$or = [
      { fullName: regex },
      { email: regex },
      { phone: regex },
      { 'vehicle.registrationNumber': regex },
      { 'address.cityOrTown': regex },
      { 'address.district': regex },
    ];
  }

  const [applications, pendingCount, approvedCount, rejectedCount] = await Promise.all([
    Tier2Application.find(query)
      .populate('reviewedByUserId', 'name email')
      .populate('vehicleId', 'registrationNumber operationalStatus isAvailable documents')
      .sort({ appliedAt: -1 }),
    Tier2Application.countDocuments({ status: 'PENDING' }),
    Tier2Application.countDocuments({ status: 'APPROVED' }),
    Tier2Application.countDocuments({ status: 'REJECTED' }),
  ]);

  return {
    applications,
    counts: {
      pending: pendingCount,
      approved: approvedCount,
      rejected: rejectedCount,
      total: pendingCount + approvedCount + rejectedCount,
    },
  };
}

export async function getTier2ApplicationDetailForOwner(applicationId: string) {
  if (!isValidObjectId(applicationId)) {
    throw new HttpError(400, 'Invalid application identifier', 'VALIDATION_ERROR');
  }
  const application = await Tier2Application.findById(applicationId)
    .populate('reviewedByUserId', 'name email')
    .populate('driverProfileId')
    .populate('vehicleId');
  if (!application) {
    throw new HttpError(404, 'Tier 2 driver application not found', 'NOT_FOUND');
  }
  return application;
}

export async function approveTier2Application(params: {
  platformOwnerId: string;
  applicationId: string;
  reviewNote?: string;
}) {
  const { platformOwnerId, applicationId, reviewNote } = params;
  if (!isValidObjectId(platformOwnerId) || !isValidObjectId(applicationId)) {
    throw new HttpError(400, 'Invalid identifier', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const owner = await User.findById(platformOwnerId).session(session);
    if (!owner || owner.role !== 'PLATFORM_OWNER') {
      throw new HttpError(
        403,
        'Only the Platform Owner can approve Tier 2 driver applications.',
        'FORBIDDEN'
      );
    }

    const application = await Tier2Application.findById(applicationId).session(session);
    if (!application) {
      throw new HttpError(404, 'Tier 2 driver application not found', 'NOT_FOUND');
    }

    if (String(application.userId) === String(owner._id)) {
      throw new HttpError(403, 'Cannot self-approve driver applications.', 'FORBIDDEN');
    }

    if (application.status === 'APPROVED') {
      throw new HttpError(
        409,
        'This Tier 2 driver application has already been approved.',
        'APPLICATION_ALREADY_APPROVED'
      );
    }

    if (application.status === 'REJECTED') {
      throw new HttpError(
        409,
        'Rejected applications cannot be silently approved; the applicant must resubmit an updated application.',
        'CANNOT_APPROVE_REJECTED_APPLICATION'
      );
    }

    const existingProfile = await DriverProfile.findOne({
      userId: application.userId,
    }).session(session);
    if (existingProfile?.fleetTier === 'TIER_1') {
      throw new HttpError(
        409,
        'Applicant already holds a Tier 1 contract profile and cannot be approved as Tier 2.',
        'TIER_CONFLICT'
      );
    }

    const now = new Date();
    const v = application.vehicle;
    const regUpper = v.registrationNumber.trim().toUpperCase();

    const vehicle = await Vehicle.findOneAndUpdate(
      { registrationNumber: regUpper },
      {
        $set: {
          registrationNumber: regUpper,
          operatorName: application.fullName,
          driverId: application.userId,
          tier: 'TIER_2',
          ownershipType: 'MARKETPLACE',
          vehicleClass: v.vehicleCategory,
          bodyType: v.bodyType,
          maxWeightKg: v.maxWeightKg,
          maxVolumeCbm: v.maxVolumeCbm,
          bedDimensionsCm: {
            length: v.bedLengthCm,
            width: v.bedWidthCm,
            height: v.bedHeightCm,
          },
          minGuaranteePaise: 0,
          perKmRatePaise: v.perKmRatePaise ?? 1900,
          payoutModel: {
            modelType: 'PER_KM',
            minGuaranteePaise: 0,
            perKmRatePaise: v.perKmRatePaise ?? 1900,
            fixedTripPaise: 0,
          },
          contractedCorridorIds: [],
          contractedSlotLabels: [],
          supportsBackhaul: false,
          homeLocation: { type: 'Point', coordinates: [73.1812, 22.3072] },
          operationalStatus: 'ACTIVE',
          isAvailable: true,
          documents: {
            rcNumber: application.documents.rcNumber,
            insurancePolicyNumber: application.documents.insurancePolicyNumber,
            insuranceValidUntil: application.documents.insuranceValidUntil,
            fitnessValidUntil: application.documents.fitnessValidUntil,
            permitNotes: application.documents.permitNotes,
            verificationStatus: 'VERIFIED',
            verifiedAt: now,
          },
        },
      },
      { upsert: true, returnDocument: 'after', runValidators: true, session: session ?? undefined }
    );

    const profile = await DriverProfile.findOneAndUpdate(
      { userId: application.userId },
      {
        $set: {
          userId: application.userId,
          name: application.fullName,
          phone: application.phone,
          fleetTier: 'TIER_2',
          tier2ApplicationStatus: 'APPROVED',
          tier2ApplicationId: application._id,
          vehicleId: vehicle._id,
          accountStatus: 'ACTIVE',
          availabilityStatus: 'AVAILABLE',
          licenseNumber: application.identity.licenseNumber,
          homeBase: `${application.address.cityOrTown}, ${application.address.district}`,
        },
        $unset: { platformOwnerId: '' },
      },
      { upsert: true, returnDocument: 'after', runValidators: true, session: session ?? undefined }
    );

    application.status = 'APPROVED';
    application.driverProfileId = profile._id;
    application.vehicleId = vehicle._id;
    application.reviewedByUserId = owner._id;
    application.reviewedAt = now;
    application.approvedAt = now;
    application.reviewNote = reviewNote?.trim() || undefined;
    application.documents.verificationStatus = 'VERIFIED';
    application.documents.verifiedAt = now;
    application.decisionHistory.push({
      action: 'APPROVED',
      status: 'APPROVED',
      actorUserId: owner._id,
      at: now,
      note: reviewNote?.trim() || 'Tier 2 marketplace application approved by Platform Owner',
    });
    await application.save({ session: session ?? undefined });

    await NotificationLog.create(
      [
        {
          recipientUserId: application.userId,
          channel: 'IN_APP',
          eventType: 'TIER2_APPLICATION_APPROVED',
          title: 'Tier 2 Driver Application Approved',
          message:
            'Your Tier 2 marketplace application and vehicle documents are verified. You can now access marketplace trip opportunities in the Driver Portal.',
          dedupeKey: `TIER2-APP-APPROVE:${String(application._id)}:${now.getTime()}`,
        },
      ],
      { session: session ?? undefined }
    ).catch(() => undefined);

    return { application, driverProfile: profile, vehicle };
  });
}

export async function rejectTier2Application(params: {
  platformOwnerId: string;
  applicationId: string;
  reason: string;
}) {
  const { platformOwnerId, applicationId, reason } = params;
  if (!isValidObjectId(platformOwnerId) || !isValidObjectId(applicationId)) {
    throw new HttpError(400, 'Invalid identifier', 'VALIDATION_ERROR');
  }
  const cleanReason = reason.trim();
  if (cleanReason.length < 5) {
    throw new HttpError(
      400,
      'A clear rejection reason (minimum 5 characters) is required.',
      'REJECTION_REASON_REQUIRED'
    );
  }

  return withTransaction(async (session) => {
    const owner = await User.findById(platformOwnerId).session(session);
    if (!owner || owner.role !== 'PLATFORM_OWNER') {
      throw new HttpError(
        403,
        'Only the Platform Owner can reject Tier 2 driver applications.',
        'FORBIDDEN'
      );
    }

    const application = await Tier2Application.findById(applicationId).session(session);
    if (!application) {
      throw new HttpError(404, 'Tier 2 driver application not found', 'NOT_FOUND');
    }

    if (application.status === 'APPROVED') {
      throw new HttpError(
        409,
        'Approved applications cannot be rejected via review; suspend the driver profile instead.',
        'APPLICATION_ALREADY_APPROVED'
      );
    }

    if (application.status === 'REJECTED') {
      throw new HttpError(
        409,
        'This application is already rejected.',
        'APPLICATION_ALREADY_REJECTED'
      );
    }

    const now = new Date();
    application.status = 'REJECTED';
    application.reviewedByUserId = owner._id;
    application.reviewedAt = now;
    application.rejectedAt = now;
    application.rejectionReason = cleanReason;
    application.documents.verificationStatus = 'REJECTED';
    application.decisionHistory.push({
      action: 'REJECTED',
      status: 'REJECTED',
      actorUserId: owner._id,
      at: now,
      note: cleanReason,
    });
    await application.save({ session: session ?? undefined });

    const profile = await DriverProfile.findOneAndUpdate(
      { userId: application.userId },
      {
        $set: {
          tier2ApplicationStatus: 'REJECTED',
          tier2ApplicationId: application._id,
          availabilityStatus: 'OFFLINE',
        },
        $unset: { platformOwnerId: '' },
      },
      { returnDocument: 'after', session: session ?? undefined }
    );

    await Vehicle.updateMany(
      { driverId: application.userId, tier: 'TIER_2' },
      { $set: { isAvailable: false, operationalStatus: 'INACTIVE' } },
      { session: session ?? undefined }
    );

    await NotificationLog.create(
      [
        {
          recipientUserId: application.userId,
          channel: 'IN_APP',
          eventType: 'TIER2_APPLICATION_REJECTED',
          title: 'Tier 2 Driver Application Rejected',
          message: `Reason: ${cleanReason}. You may update and resubmit your application from the Driver Portal.`,
          dedupeKey: `TIER2-APP-REJECT:${String(application._id)}:${now.getTime()}`,
        },
      ],
      { session: session ?? undefined }
    ).catch(() => undefined);

    return { application, driverProfile: profile };
  });
}

/**
 * Lists eligible Tier 2 marketplace trip opportunities for an APPROVED Tier 2 driver.
 * Never exposes Tier 1 contracts or allows PENDING/REJECTED applicants.
 */
export async function listMarketplaceOpportunitiesForTier2(driverUserId: string) {
  const profile = await assertApprovedTier2Driver(driverUserId);
  if (profile.fleetTier !== 'TIER_2') {
    throw new HttpError(
      403,
      'Marketplace trip board is reserved for approved Tier 2 independent drivers.',
      'TIER2_ONLY'
    );
  }

  const vehicle = profile.vehicleId
    ? await Vehicle.findOne({ _id: profile.vehicleId, driverId: profile.userId })
    : await Vehicle.findOne({ driverId: profile.userId, tier: 'TIER_2' });

  const openTrips = await Trip.find({
    quarantined: { $ne: true },
    status: { $in: ['ASSIGNED', 'DRIVER_REJECTED'] },
    'allocationEconomics.allocatedTier': 'TIER_2',
    $or: [
      { status: 'DRIVER_REJECTED' },
      { status: 'ASSIGNED', driverId: profile.userId },
    ],
  })
    .populate('corridorId', 'code name stops')
    .populate('slotId', 'departureDate plannedDepartureAt estimatedArrivalEndAt')
    .populate('shipmentIds', 'reference cargo pickupStopCode deliveryStopCode')
    .sort({ plannedDepartureAt: 1 });

  const existingActiveTrips = await Trip.find({
    driverId: profile.userId,
    status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
  }).select('_id plannedDepartureAt estimatedEndAt');

  const opportunities = openTrips.map((t) => {
    const shipments = (t.shipmentIds as unknown as Array<Pick<IShipment, 'cargo'>>) ?? [];
    const fitCheck =
      vehicle && shipments.length > 0
        ? doesCargoFitVehicle(shipments, vehicle)
        : { feasible: Boolean(vehicle && vehicle.isAvailable), reason: vehicle ? undefined : 'No active Tier 2 vehicle' };

    const overlaps = existingActiveTrips.some(
      (et) =>
        String(et._id) !== String(t._id) &&
        new Date(et.plannedDepartureAt) < new Date(t.estimatedEndAt) &&
        new Date(et.estimatedEndAt) > new Date(t.plannedDepartureAt)
    );

    const estDistanceKm = t.allocationEconomics?.estimatedDistanceKm ?? 115;
    const estimatedPayoutPaise = vehicle
      ? computeVehiclePayoutPaise(vehicle, estDistanceKm)
      : t.allocationEconomics?.estimatedVehiclePayoutPaise ?? 0;

    return {
      _id: String(t._id),
      tripCode: t.tripCode,
      status: t.status,
      corridor: t.corridorId,
      plannedDepartureAt: t.plannedDepartureAt,
      estimatedEndAt: t.estimatedEndAt,
      stopsSummary: t.stopsSummary,
      shipmentCount: shipments.length,
      totalChargeableWeightKg: shipments.reduce((sum, s) => sum + (s.cargo?.chargeableWeightKg ?? 0), 0),
      totalVolumeCbm: Number(
        shipments.reduce((sum, s) => sum + (s.cargo?.volumeCbm ?? 0), 0).toFixed(2)
      ),
      estimatedDistanceKm: estDistanceKm,
      estimatedPayoutPaise,
      isAssignedToMe: String(t.driverId) === String(profile.userId),
      eligibleToAccept: Boolean(vehicle?.isAvailable && vehicle.operationalStatus === 'ACTIVE' && fitCheck.feasible && !overlaps),
      ineligibleReason: !vehicle?.isAvailable || vehicle?.operationalStatus !== 'ACTIVE'
        ? 'Your Tier 2 vehicle is currently inactive or unavailable'
        : !fitCheck.feasible
          ? fitCheck.reason
          : overlaps
            ? 'Overlaps with one of your active scheduled trips'
            : undefined,
    };
  });

  return {
    opportunities,
    vehicle,
  };
}

/**
 * Allows an APPROVED Tier 2 driver to accept an eligible marketplace trip opportunity.
 * Enforces approved status, active Tier 2 vehicle specs fit, and schedule non-overlap.
 */
export async function acceptMarketplaceOpportunity(params: {
  driverUserId: string;
  tripId: string;
}) {
  const { driverUserId, tripId } = params;
  if (!isValidObjectId(driverUserId) || !isValidObjectId(tripId)) {
    throw new HttpError(400, 'Invalid driver or trip identifier', 'VALIDATION_ERROR');
  }

  return withTransaction(async (session) => {
    const profile = await assertApprovedTier2Driver(driverUserId, session);
    if (profile.fleetTier !== 'TIER_2') {
      throw new HttpError(
        403,
        'Only approved Tier 2 marketplace drivers can claim marketplace opportunities.',
        'TIER2_ONLY'
      );
    }

    const vehicle = profile.vehicleId
      ? await Vehicle.findOne({ _id: profile.vehicleId, driverId: profile.userId }).session(session)
      : await Vehicle.findOne({ driverId: profile.userId, tier: 'TIER_2' }).session(session);

    if (!vehicle || !vehicle.isAvailable || vehicle.operationalStatus !== 'ACTIVE') {
      throw new HttpError(
        409,
        'Your Tier 2 marketplace vehicle must be active and available to accept trips.',
        'VEHICLE_UNAVAILABLE'
      );
    }

    const trip = await Trip.findById(tripId).session(session);
    if (!trip || trip.quarantined) {
      throw new HttpError(404, 'Marketplace trip not found', 'NOT_FOUND');
    }

    if (trip.allocationEconomics?.allocatedTier !== 'TIER_2') {
      throw new HttpError(
        403,
        'Tier 2 drivers cannot claim Tier 1 contracted trips.',
        'TIER_MISMATCH'
      );
    }

    const isClaimableRejected = trip.status === 'DRIVER_REJECTED';
    const isAssignedOfferToMe =
      trip.status === 'ASSIGNED' && String(trip.driverId) === String(profile.userId);

    if (!isClaimableRejected && !isAssignedOfferToMe) {
      throw new HttpError(
        409,
        'This marketplace trip is no longer available to accept.',
        'TRIP_ALREADY_CLAIMED'
      );
    }

    const shipments =
      trip.shipmentIds.length > 0
        ? await Shipment.find({ _id: { $in: trip.shipmentIds } }).session(session)
        : [];
    if (shipments.length > 0) {
      const fit = doesCargoFitVehicle(shipments, vehicle);
      if (!fit.feasible) {
        throw new HttpError(409, fit.reason ?? 'Vehicle does not fit trip cargo', 'CARGO_FIT_FAILED');
      }
    }

    const overlapping = await Trip.findOne({
      driverId: profile.userId,
      _id: { $ne: trip._id },
      status: { $in: ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'] },
      plannedDepartureAt: { $lt: trip.estimatedEndAt },
      estimatedEndAt: { $gt: trip.plannedDepartureAt },
    }).session(session);

    if (overlapping) {
      throw new HttpError(
        409,
        'This opportunity overlaps with one of your existing scheduled trips.',
        'OVERLAPPING_TRIP'
      );
    }

    const estDist = trip.allocationEconomics?.estimatedDistanceKm ?? 115;
    const payout = computeVehiclePayoutPaise(vehicle, estDist);

    trip.driverId = profile.userId;
    trip.vehicleId = vehicle._id;
    trip.status = 'DRIVER_ACCEPTED';
    if (trip.allocationEconomics) {
      trip.allocationEconomics.selectedVehicleMinGuaranteePaise = 0;
      trip.allocationEconomics.estimatedVehiclePayoutPaise = payout;
    }
    trip.assignmentHistory.push({
      driverId: profile.userId,
      vehicleId: vehicle._id,
      action: 'ACCEPTED',
      reason: 'Accepted from Tier 2 Marketplace opportunities',
      actorUserId: profile.userId,
      at: new Date(),
    });
    await trip.save({ session: session ?? undefined });

    return { trip, message: 'Marketplace trip accepted.' };
  });
}

import fs from 'node:fs/promises';
import { Types } from 'mongoose';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { DriverProfile } from '../models/DriverProfile.js';
import { NotificationLog } from '../models/NotificationLog.js';
import { RefreshToken } from '../models/RefreshToken.js';
import { Tier2Application } from '../models/Tier2Application.js';
import { Trip } from '../models/Trip.js';
import { User } from '../models/User.js';
import { Vehicle } from '../models/Vehicle.js';
import { signAccessToken } from '../services/authService.js';
import {
  acceptMarketplaceOpportunity,
  approveTier2Application,
  rejectTier2Application,
} from '../services/tier2ApplicationService.js';

describe('MC-063: Tier 2 Driver Application Review, Approval & Marketplace Access Control', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers public DRIVER as PENDING Tier 2 applicant and blocks self-approval, tier escalation, availability & marketplace trips until approved', async () => {
    const app = createApp();
    const driverId = new Types.ObjectId();

    // 1. Registration creates TIER_2 + PENDING + OFFLINE profile
    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(User, 'create').mockResolvedValueOnce({
      _id: driverId,
      name: 'Vikram Patel',
      email: 'vikram@driver.test',
      phone: '+919800000299',
      role: 'DRIVER',
      isActive: true,
    } as never);
    const profileCreateSpy = vi
      .spyOn(DriverProfile, 'create')
      .mockResolvedValueOnce({} as never);
    vi.spyOn(RefreshToken, 'create').mockResolvedValueOnce({} as never);

    const regRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Vikram Patel',
      email: 'vikram@driver.test',
      phone: '+919800000299',
      password: 'Password123',
      role: 'DRIVER',
    });
    expect(regRes.status).toBe(201);
    expect(profileCreateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'PENDING',
        availabilityStatus: 'OFFLINE',
      })
    );

    const driverToken = signAccessToken({ _id: driverId, role: 'DRIVER' });
    vi.spyOn(User, 'findById').mockReturnValue({
      select: vi.fn().mockResolvedValue({ _id: driverId, role: 'DRIVER', isActive: true }),
    } as never);

    // 2. Blocks DRIVER from accessing Platform Owner review endpoints or self-approving
    const fakeAppId = new Types.ObjectId();
    const selfApproveRes = await request(app)
      .post(`/api/v1/platform-owner/tier2-applications/${fakeAppId}/approve`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({});
    expect(selfApproveRes.status).toBe(403);

    // 3. Blocks fleetTier escalation via PUT /api/v1/driver/profile
    vi.spyOn(DriverProfile, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      userId: driverId,
      fleetTier: 'TIER_2',
      tier2ApplicationStatus: 'PENDING',
      accountStatus: 'ACTIVE',
    } as never);
    const tierChangeRes = await request(app)
      .put('/api/v1/driver/profile')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        name: 'Vikram Patel',
        phone: '+919800000299',
        fleetTier: 'TIER_1',
      });
    expect(tierChangeRes.status).toBe(403);
    expect(tierChangeRes.body.code).toBe('PLATFORM_OWNER_REQUIRED');

    // 4. Blocks PENDING Tier 2 applicant from toggling availability or viewing marketplace trips
    vi.spyOn(DriverProfile, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      userId: driverId,
      fleetTier: 'TIER_2',
      tier2ApplicationStatus: 'PENDING',
      accountStatus: 'ACTIVE',
    } as never);
    const availRes = await request(app)
      .patch('/api/v1/driver/availability')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ availabilityStatus: 'AVAILABLE' });
    expect(availRes.status).toBe(403);
    expect(availRes.body.code).toBe('TIER2_NOT_APPROVED');

    vi.spyOn(DriverProfile, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      userId: driverId,
      fleetTier: 'TIER_2',
      tier2ApplicationStatus: 'PENDING',
      accountStatus: 'ACTIVE',
    } as never);
    const marketRes = await request(app)
      .get('/api/v1/driver/marketplace-opportunities')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(marketRes.status).toBe(403);
    expect(marketRes.body.code).toBe('TIER2_NOT_APPROVED');
  });

  it('allows single Platform Owner to reject with reason and approve pending Tier 2 applications, preventing duplicate approvals', async () => {
    const ownerId = new Types.ObjectId();
    const applicantId = new Types.ObjectId();
    const appId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const profileId = new Types.ObjectId();

    // Missing rejection reason rejected cleanly
    await expect(
      rejectTier2Application({
        platformOwnerId: String(ownerId),
        applicationId: String(appId),
        reason: 'no',
      })
    ).rejects.toMatchObject({ code: 'REJECTION_REASON_REQUIRED' });

    // Reject flow updates status, reason, vehicle availability, and profile status
    const saveMock = vi.fn().mockResolvedValue(undefined);
    const pendingAppDoc = {
      _id: appId,
      userId: applicantId,
      fullName: 'Vikram Patel',
      phone: '+919800000299',
      address: {
        addressLine: 'Plot 12',
        cityOrTown: 'Nadiad',
        district: 'Kheda',
        state: 'Gujarat',
        pincode: '387001',
      },
      identity: {
        licenseNumber: 'GJ07-2021-0091450',
        idProofType: 'PAN',
        idProofNumber: 'ABCPV4821K',
      },
      vehicle: {
        registrationNumber: 'GJ-07-MK-4102',
        vehicleCategory: '10ft Closed Body',
        bodyType: 'CLOSED_BODY',
        maxWeightKg: 1800,
        bedLengthCm: 305,
        bedWidthCm: 175,
        bedHeightCm: 155,
        maxVolumeCbm: 8.27,
        perKmRatePaise: 2000,
      },
      documents: {
        rcNumber: 'GJ07MK4102',
        insurancePolicyNumber: 'INS-4102',
        verificationStatus: 'PENDING',
      },
      status: 'PENDING',
      decisionHistory: [],
      save: saveMock,
    };

    vi.spyOn(User, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: ownerId, role: 'PLATFORM_OWNER' }),
    } as never);
    vi.spyOn(Tier2Application, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(pendingAppDoc),
    } as never);
    vi.spyOn(DriverProfile, 'findOneAndUpdate').mockResolvedValueOnce({
      _id: profileId,
      tier2ApplicationStatus: 'REJECTED',
    } as never);
    vi.spyOn(Vehicle, 'updateMany').mockResolvedValueOnce({ modifiedCount: 1 } as never);
    vi.spyOn(NotificationLog, 'create').mockResolvedValueOnce([] as never);

    const rejected = await rejectTier2Application({
      platformOwnerId: String(ownerId),
      applicationId: String(appId),
      reason: 'Insurance policy expired; upload renewed policy.',
    });
    expect(rejected.application.status).toBe('REJECTED');
    expect(rejected.application.rejectionReason).toContain('Insurance policy expired');

    // Cannot silently approve a REJECTED application without explicit resubmission
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: ownerId, role: 'PLATFORM_OWNER' }),
    } as never);
    vi.spyOn(Tier2Application, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(pendingAppDoc),
    } as never);
    await expect(
      approveTier2Application({
        platformOwnerId: String(ownerId),
        applicationId: String(appId),
      })
    ).rejects.toMatchObject({ code: 'CANNOT_APPROVE_REJECTED_APPLICATION' });

    // Resubmitted -> status back to PENDING -> Platform Owner approves -> creates Tier 2 MARKETPLACE vehicle
    pendingAppDoc.status = 'PENDING';
    pendingAppDoc.documents.verificationStatus = 'PENDING';
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: ownerId, role: 'PLATFORM_OWNER' }),
    } as never);
    vi.spyOn(Tier2Application, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(pendingAppDoc),
    } as never);
    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: profileId, fleetTier: 'TIER_2' }),
    } as never);
    const vehicleUpsertSpy = vi.spyOn(Vehicle, 'findOneAndUpdate').mockResolvedValueOnce({
      _id: vehicleId,
      tier: 'TIER_2',
      ownershipType: 'MARKETPLACE',
      minGuaranteePaise: 0,
    } as never);
    vi.spyOn(DriverProfile, 'findOneAndUpdate').mockResolvedValueOnce({
      _id: profileId,
      tier2ApplicationStatus: 'APPROVED',
      fleetTier: 'TIER_2',
    } as never);
    vi.spyOn(NotificationLog, 'create').mockResolvedValueOnce([] as never);

    const approved = await approveTier2Application({
      platformOwnerId: String(ownerId),
      applicationId: String(appId),
      reviewNote: 'All documents verified',
    });
    expect(approved.application.status).toBe('APPROVED');
    expect(vehicleUpsertSpy).toHaveBeenCalledWith(
      { registrationNumber: 'GJ-07-MK-4102' },
      expect.objectContaining({
        $set: expect.objectContaining({
          tier: 'TIER_2',
          ownershipType: 'MARKETPLACE',
          minGuaranteePaise: 0,
          isAvailable: true,
        }),
      }),
      expect.anything()
    );

    // Duplicate approval prevented cleanly
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({ _id: ownerId, role: 'PLATFORM_OWNER' }),
    } as never);
    vi.spyOn(Tier2Application, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(pendingAppDoc),
    } as never);
    await expect(
      approveTier2Application({
        platformOwnerId: String(ownerId),
        applicationId: String(appId),
      })
    ).rejects.toMatchObject({ code: 'APPLICATION_ALREADY_APPROVED' });
  });

  it('allows approved Tier 2 driver to accept eligible marketplace trip opportunities', async () => {
    const driverId = new Types.ObjectId();
    const vehicleId = new Types.ObjectId();
    const tripId = new Types.ObjectId();

    vi.spyOn(DriverProfile, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        userId: driverId,
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'APPROVED',
        accountStatus: 'ACTIVE',
        vehicleId,
      }),
    } as never);
    vi.spyOn(Vehicle, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue({
        _id: vehicleId,
        driverId,
        tier: 'TIER_2',
        isAvailable: true,
        operationalStatus: 'ACTIVE',
        maxWeightKg: 1800,
        maxVolumeCbm: 8,
        bedDimensionsCm: { length: 305, width: 175, height: 155 },
        perKmRatePaise: 2000,
        minGuaranteePaise: 0,
      }),
    } as never);

    const tripSaveMock = vi.fn().mockResolvedValue(undefined);
    const tripDoc = {
      _id: tripId,
      tripCode: 'MC-TRIP-T2-01',
      status: 'DRIVER_REJECTED',
      shipmentIds: [],
      plannedDepartureAt: new Date(Date.now() + 3600_000),
      estimatedEndAt: new Date(Date.now() + 14400_000),
      allocationEconomics: {
        allocatedTier: 'TIER_2',
        estimatedDistanceKm: 115,
        estimatedVehiclePayoutPaise: 230000,
        selectedVehicleMinGuaranteePaise: 0,
      },
      assignmentHistory: [],
      save: tripSaveMock,
    };
    vi.spyOn(Trip, 'findById').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(tripDoc),
    } as never);
    vi.spyOn(Trip, 'findOne').mockReturnValueOnce({
      session: vi.fn().mockResolvedValue(null),
    } as never);

    const res = await acceptMarketplaceOpportunity({
      driverUserId: String(driverId),
      tripId: String(tripId),
    });

    expect(res.trip.status).toBe('DRIVER_ACCEPTED');
    expect(String(res.trip.driverId)).toBe(String(driverId));
    expect(tripSaveMock).toHaveBeenCalledOnce();
  });
});

describe('MC-064: Public Tier 2 Driver Application Intake, Status Lookup & Secure Document Access', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const validPublicPayload = {
    fullName: 'Rameshbhai Parmar',
    email: 'ramesh.t2@driver.test',
    phone: '+919825008899',
    password: 'Password123!',
    address: {
      addressLine: '14 Makarpura GIDC Cross Road',
      cityOrTown: 'Vadodara',
      district: 'Vadodara',
      state: 'Gujarat',
      pincode: '390010',
    },
    identity: {
      licenseNumber: 'GJ06-20210077889',
      idProofType: 'AADHAAR',
      idProofNumber: 'XXXX-XXXX-8899',
    },
    vehicle: {
      registrationNumber: 'GJ06ZZ8899',
      vehicleCategory: '10ft Closed Body LCV',
      bodyType: 'CLOSED_BODY',
      maxWeightKg: 1500,
      bedLengthCm: 305,
      bedWidthCm: 175,
      bedHeightCm: 155,
      perKmRatePaise: 1900,
    },
    documents: {
      rcNumber: 'RC-GJ06-889900',
      insurancePolicyNumber: 'INS-2026-8899',
    },
  };

  it('exposes the public Tier 2 verification policy checklist', async () => {
    const app = createApp();
    const res = await request(app).get('/api/v1/public/tier2/policy');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.policy.requiredDocuments).toHaveLength(4);
    expect(res.body.policy.maxFileSizeBytes).toBe(5 * 1024 * 1024);
  });

  it('rejects public Tier 2 submission when required verification documents are missing', async () => {
    const app = createApp();
    const res = await request(app)
      .post('/api/v1/public/tier2/apply')
      .field('payload', JSON.stringify(validPublicPayload))
      .attach('licenseFile', Buffer.from('fake-pdf'), {
        filename: 'license.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('REQUIRED_DOCUMENTS_MISSING');
  });

  it('rejects duplicate active applicant email on public Tier 2 intake', async () => {
    const app = createApp();
    vi.spyOn(User, 'findOne').mockResolvedValueOnce({
      _id: new Types.ObjectId(),
      email: validPublicPayload.email,
    } as never);
    vi.spyOn(Vehicle, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(Tier2Application, 'findOne').mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/v1/public/tier2/apply')
      .field('payload', JSON.stringify(validPublicPayload))
      .attach('licenseFile', Buffer.from('lic'), {
        filename: 'license.pdf',
        contentType: 'application/pdf',
      })
      .attach('idProofFile', Buffer.from('id'), {
        filename: 'id.png',
        contentType: 'image/png',
      })
      .attach('rcFile', Buffer.from('rc'), {
        filename: 'rc.jpg',
        contentType: 'image/jpeg',
      })
      .attach('insuranceFile', Buffer.from('ins'), {
        filename: 'ins.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_APPLICATION');
  });

  it('creates PENDING Tier 2 driver application with uploaded documents and returns tracking ref', async () => {
    const app = createApp();
    const userId = new Types.ObjectId();
    const profileId = new Types.ObjectId();
    const appId = new Types.ObjectId();

    vi.spyOn(User, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(Vehicle, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(Tier2Application, 'findOne').mockResolvedValueOnce(null);
    vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    let createdUserDoc: Record<string, unknown> | null = null;
    vi.spyOn(User, 'create').mockImplementationOnce((async (
      docs: Array<Record<string, unknown>>
    ) => {
      createdUserDoc = {
        _id: userId,
        ...docs[0],
      };
      return [createdUserDoc];
    }) as never);

    const profileSaveMock = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(DriverProfile, 'create').mockResolvedValueOnce([
      {
        _id: profileId,
        userId,
        fleetTier: 'TIER_2',
        tier2ApplicationStatus: 'PENDING',
        save: profileSaveMock,
      },
    ] as never);

    const appCreateSpy = vi.spyOn(Tier2Application, 'create').mockImplementationOnce((async (
      docs: Array<Record<string, unknown>>
    ) => [
      {
        _id: appId,
        ...docs[0],
      },
    ]) as never);
    vi.spyOn(RefreshToken, 'create').mockResolvedValueOnce({} as never);

    const res = await request(app)
      .post('/api/v1/public/tier2/apply')
      .field('payload', JSON.stringify(validPublicPayload))
      .attach('licenseFile', Buffer.from('lic'), {
        filename: 'license.pdf',
        contentType: 'application/pdf',
      })
      .attach('idProofFile', Buffer.from('id'), {
        filename: 'id.png',
        contentType: 'image/png',
      })
      .attach('rcFile', Buffer.from('rc'), {
        filename: 'rc.jpg',
        contentType: 'image/jpeg',
      })
      .attach('insuranceFile', Buffer.from('ins'), {
        filename: 'ins.pdf',
        contentType: 'application/pdf',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.status).toBe('PENDING');
    expect(res.body.applicationRef).toMatch(/^MC-T2-/);
    expect(res.body.uploadedDocumentsCount).toBe(4);
    expect(res.body.accessToken).toBeTruthy();
    expect(appCreateSpy).toHaveBeenCalledOnce();
    expect(profileSaveMock).toHaveBeenCalledOnce();

    // Verify the registered Tier 2 applicant can sign in cleanly via /api/v1/auth/login
    vi.spyOn(User, 'findOne').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue(createdUserDoc),
    } as never);
    vi.spyOn(RefreshToken, 'create').mockResolvedValueOnce({} as never);
    const loginRes = await request(app).post('/api/v1/auth/login').send({
      email: '  RAMESH.T2@DRIVER.TEST ',
      password: validPublicPayload.password,
    });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.success).toBe(true);
    expect(loginRes.body.user.role).toBe('DRIVER');
  });

  it('looks up public application status safely without leaking sensitive identity/address PII', async () => {
    const app = createApp();
    vi.spyOn(Tier2Application, 'findOne').mockReturnValueOnce({
      lean: vi.fn().mockResolvedValue({
        applicationRef: 'MC-T2-DEMO-0002',
        status: 'REJECTED',
        appliedAt: new Date('2026-11-20T10:00:00Z'),
        reviewedAt: new Date('2026-11-21T11:00:00Z'),
        rejectedAt: new Date('2026-11-21T11:00:00Z'),
        rejectionReason: 'Insurance certificate expired',
        vehicle: {
          registrationNumber: 'GJ06XX9090',
          vehicleCategory: '10ft Closed Body LCV',
        },
        documents: { verificationStatus: 'REJECTED' },
        uploadedDocuments: [{ docType: 'DRIVING_LICENSE' }],
        address: { addressLine: 'SECRET HOME ADDRESS' },
        identity: { idProofNumber: 'SECRET-AADHAAR' },
      }),
    } as never);

    const res = await request(app).post('/api/v1/public/tier2/application-status').send({
      applicationRef: 'MC-T2-DEMO-0002',
      email: 'driver3@meecargo.demo',
    });

    expect(res.status).toBe(200);
    expect(res.body.applicationRef).toBe('MC-T2-DEMO-0002');
    expect(res.body.status).toBe('REJECTED');
    expect(res.body.rejectionReason).toBe('Insurance certificate expired');
    expect(res.body.address).toBeUndefined();
    expect(res.body.identity).toBeUndefined();
  });

  it('restricts uploaded verification document inspection strictly to Platform Owner and owns-applicant', async () => {
    const app = createApp();
    const ownerId = new Types.ObjectId();
    const driverId = new Types.ObjectId();
    const appId = new Types.ObjectId();
    const storageKey = '0123456789abcdef0123456789abcdef.pdf';

    const driverToken = signAccessToken({ _id: driverId, role: 'DRIVER' });
    const ownerToken = signAccessToken({ _id: ownerId, role: 'PLATFORM_OWNER' });

    // Non-owner cannot download via platform-owner endpoint
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: driverId, role: 'DRIVER', isActive: true }),
    } as never);
    const forbiddenRes = await request(app)
      .get(`/api/v1/platform-owner/tier2-applications/${appId}/documents/${storageKey}`)
      .set('Authorization', `Bearer ${driverToken}`);
    expect(forbiddenRes.status).toBe(403);

    // Platform Owner can inspect uploaded document
    vi.spyOn(User, 'findById').mockReturnValueOnce({
      select: vi.fn().mockResolvedValue({ _id: ownerId, role: 'PLATFORM_OWNER', isActive: true }),
    } as never);
    const appDoc = {
      _id: appId,
      uploadedDocuments: [
        {
          docType: 'DRIVING_LICENSE',
          originalName: 'license.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 8,
          storageKey,
        },
      ],
    };
    const pop3 = { populate: vi.fn().mockResolvedValue(appDoc) };
    const pop2 = { populate: vi.fn().mockReturnValue(pop3) };
    vi.spyOn(Tier2Application, 'findById').mockReturnValueOnce({
      populate: vi.fn().mockReturnValue(pop2),
    } as never);
    vi.spyOn(fs, 'readFile').mockResolvedValueOnce(Buffer.from('%PDF-1.4'));

    const ownerRes = await request(app)
      .get(`/api/v1/platform-owner/tier2-applications/${appId}/documents/${storageKey}`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(ownerRes.status).toBe(200);
    expect(ownerRes.headers['content-type']).toContain('application/pdf');
  });
});

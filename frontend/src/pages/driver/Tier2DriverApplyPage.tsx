import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  FileUp,
  Send,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import {
  ApiError,
  fetchPublicTier2Policy,
  submitPublicTier2Application,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { useAuthStore } from '../../stores/authStore';
import type { IdProofType, VehicleBodyType } from '../../types/api';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const MAX_DOC_BYTES = 5 * 1024 * 1024;

type DocFieldName = 'licenseFile' | 'idProofFile' | 'rcFile' | 'insuranceFile';

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function Tier2DriverApplyPage() {
  const { setSession } = useAuthStore();
  const policyQuery = useQuery({
    queryKey: ['public-tier2-policy'],
    queryFn: fetchPublicTier2Policy,
  });

  // Personal info
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [cityOrTown, setCityOrTown] = useState('');
  const [district, setDistrict] = useState('');
  const [stateName, setStateName] = useState('Gujarat');
  const [pincode, setPincode] = useState('');

  // Account credentials
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Identity
  const [licenseNumber, setLicenseNumber] = useState('');
  const [idProofType, setIdProofType] = useState<IdProofType>('AADHAAR');
  const [idProofNumber, setIdProofNumber] = useState('');

  // Vehicle
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vehicleCategory, setVehicleCategory] = useState('10ft Closed Body LCV');
  const [bodyType, setBodyType] = useState<VehicleBodyType>('CLOSED_BODY');
  const [maxWeightKg, setMaxWeightKg] = useState('1500');
  const [bedLengthCm, setBedLengthCm] = useState('305');
  const [bedWidthCm, setBedWidthCm] = useState('175');
  const [bedHeightCm, setBedHeightCm] = useState('155');
  const [perKmRupees, setPerKmRupees] = useState('19');

  // Document numbers & expiry
  const [rcNumber, setRcNumber] = useState('');
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('');
  const [insuranceValidUntil, setInsuranceValidUntil] = useState('');
  const [fitnessValidUntil, setFitnessValidUntil] = useState('');
  const [permitNotes, setPermitNotes] = useState('');

  // Document uploads
  const [files, setFiles] = useState<Partial<Record<DocFieldName, File>>>({});

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittedResult, setSubmittedResult] = useState<{
    applicationRef: string;
    status: string;
    appliedAt: string;
    uploadedDocumentsCount: number;
    email: string;
  } | null>(null);

  const computedVolumeCbm = useMemo(() => {
    const l = Number(bedLengthCm);
    const w = Number(bedWidthCm);
    const h = Number(bedHeightCm);
    if (!Number.isFinite(l) || !Number.isFinite(w) || !Number.isFinite(h) || l <= 0 || w <= 0 || h <= 0) {
      return 0;
    }
    return Number(((l * w * h) / 1_000_000).toFixed(2));
  }, [bedLengthCm, bedWidthCm, bedHeightCm]);

  const handleFileChange = (fieldName: DocFieldName, file: File | null) => {
    setFormError(null);
    if (!file) {
      setFiles((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
      return;
    }
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      setFormError(
        `Unsupported file type for "${file.name}". Please upload JPEG, PNG, WebP, or PDF.`
      );
      return;
    }
    if (file.size > MAX_DOC_BYTES) {
      setFormError(`"${file.name}" exceeds the 5 MB file limit.`);
      return;
    }
    setFiles((prev) => ({ ...prev, [fieldName]: file }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setFormError('Password and Confirm Password do not match.');
      return;
    }
    if (!files.licenseFile || !files.idProofFile || !files.rcFile || !files.insuranceFile) {
      setFormError(
        'Please upload all 4 required verification documents (Driving License, ID Proof, Vehicle RC, and Insurance Policy).'
      );
      return;
    }

    const payload = {
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      password,
      address: {
        addressLine: addressLine.trim(),
        cityOrTown: cityOrTown.trim(),
        district: district.trim(),
        state: stateName.trim() || 'Gujarat',
        pincode: pincode.trim(),
      },
      identity: {
        licenseNumber: licenseNumber.trim(),
        idProofType,
        idProofNumber: idProofNumber.trim(),
      },
      vehicle: {
        registrationNumber: registrationNumber.trim(),
        vehicleCategory: vehicleCategory.trim(),
        bodyType,
        maxWeightKg: Number(maxWeightKg),
        bedLengthCm: Number(bedLengthCm),
        bedWidthCm: Number(bedWidthCm),
        bedHeightCm: Number(bedHeightCm),
        maxVolumeCbm: computedVolumeCbm > 0 ? computedVolumeCbm : undefined,
        perKmRatePaise: Math.max(500, Math.round(Number(perKmRupees || '19') * 100)),
      },
      documents: {
        rcNumber: rcNumber.trim(),
        insurancePolicyNumber: insurancePolicyNumber.trim(),
        ...(insuranceValidUntil ? { insuranceValidUntil } : {}),
        ...(fitnessValidUntil ? { fitnessValidUntil } : {}),
        ...(permitNotes.trim() ? { permitNotes: permitNotes.trim() } : {}),
      },
    };

    const formData = new FormData();
    formData.append('payload', JSON.stringify(payload));
    formData.append('licenseFile', files.licenseFile);
    formData.append('idProofFile', files.idProofFile);
    formData.append('rcFile', files.rcFile);
    formData.append('insuranceFile', files.insuranceFile);

    setSubmitting(true);
    try {
      const res = await submitPublicTier2Application(formData);
      setSession({
        user: res.user,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      setSubmittedResult({
        applicationRef: res.applicationRef,
        status: res.status,
        appliedAt: res.appliedAt,
        uploadedDocumentsCount: res.uploadedDocumentsCount,
        email: res.user.email,
      });
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? error.message
          : 'Unable to submit your application right now.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const docInputs: Array<{
    fieldName: DocFieldName;
    label: string;
    helper: string;
  }> = [
    {
      fieldName: 'licenseFile',
      label: '1. Commercial Driving License Scan',
      helper: 'Front/back clear photo or PDF',
    },
    {
      fieldName: 'idProofFile',
      label: '2. Government Identity Proof Scan',
      helper: 'Matching Aadhaar, PAN, Passport, or Voter ID',
    },
    {
      fieldName: 'rcFile',
      label: '3. Vehicle Registration Certificate (RC)',
      helper: 'Commercial registration document',
    },
    {
      fieldName: 'insuranceFile',
      label: '4. Goods Vehicle Insurance Policy',
      helper: 'Current valid policy schedule',
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/become-a-driver"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Become a Driver
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <Link to="/driver/application-status" className="font-medium text-emerald-700 hover:underline">
              Check Application Status
            </Link>
            <Link to="/driver/login" className="font-medium text-slate-700 hover:underline">
              Driver Login
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-600 text-white">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 sm:text-2xl">
              Tier 2 Marketplace Driver Application
            </h1>
            <p className="text-xs text-slate-500">
              {policyQuery.data?.policy.payoutPolicySummary ??
                'Independent vehicle owners only. Approval by Platform Owner is required before receiving marketplace trips.'}
            </p>
          </div>
        </div>

        {submittedResult ? (
          <Card className="border-emerald-300">
            <CardHeader className="border-b border-emerald-100 bg-emerald-50/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-emerald-900">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-base font-bold">Application Submitted for Review</h2>
                </div>
                <Badge variant="warning">{submittedResult.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-5 text-xs text-slate-700">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                <p>
                  <strong>Application Reference:</strong>{' '}
                  <span className="rounded bg-white px-2 py-0.5 font-mono text-sm font-bold text-slate-900 border border-slate-200">
                    {submittedResult.applicationRef}
                  </span>
                </p>
                <p>
                  <strong>Registered Email:</strong> {submittedResult.email}
                </p>
                <p>
                  <strong>Submitted At:</strong>{' '}
                  {new Date(submittedResult.appliedAt).toLocaleString('en-IN')}
                </p>
                <p>
                  <strong>Documents Uploaded:</strong> {submittedResult.uploadedDocumentsCount} verified
                  files securely stored for review
                </p>
              </div>

              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                Your driver account has been created with <strong>PENDING</strong> Tier 2 review status.
                Marketplace trip opportunities remain locked until the Platform Owner verifies your
                documents and approves your application.
              </div>

              <div className="flex flex-wrap gap-2">
                <Link to="/driver/application-status">
                  <Button variant="primary" size="sm">
                    View Application Status
                  </Button>
                </Link>
                <Link to="/driver">
                  <Button variant="secondary" size="sm">
                    Open Driver Portal
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              {formError ? (
                <div className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                  {formError}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-6 text-xs">
                {/* 1. Personal & Contact Info */}
                <section className="space-y-3">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    Personal Information
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Full Name *</span>
                      <input
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Sureshbhai Solanki"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Email Address *</span>
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="driver@example.com"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Phone Number *</span>
                      <input
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+919825001122"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Residential Street / Landmark *</span>
                      <input
                        required
                        value={addressLine}
                        onChange={(e) => setAddressLine(e.target.value)}
                        placeholder="House / Society / Road"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <div className="grid gap-3 sm:grid-cols-2 sm:col-span-2">
                      <label className="block space-y-1">
                        <span className="font-medium text-slate-700">City / Town *</span>
                        <input
                          required
                          value={cityOrTown}
                          onChange={(e) => setCityOrTown(e.target.value)}
                          placeholder="Vadodara"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="font-medium text-slate-700">District *</span>
                        <input
                          required
                          value={district}
                          onChange={(e) => setDistrict(e.target.value)}
                          placeholder="Vadodara"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="font-medium text-slate-700">State *</span>
                        <input
                          required
                          value={stateName}
                          onChange={(e) => setStateName(e.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="font-medium text-slate-700">6-digit PIN Code *</span>
                        <input
                          required
                          pattern="\d{6}"
                          value={pincode}
                          onChange={(e) => setPincode(e.target.value)}
                          placeholder="390010"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2"
                        />
                      </label>
                    </div>
                  </div>
                </section>

                {/* 2. Identity & License */}
                <section className="space-y-3">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    Identity &amp; License Numbers
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Driving License Number *</span>
                      <input
                        required
                        value={licenseNumber}
                        onChange={(e) => setLicenseNumber(e.target.value)}
                        placeholder="GJ06-20200044112"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">ID Proof Type *</span>
                      <select
                        value={idProofType}
                        onChange={(e) => setIdProofType(e.target.value as IdProofType)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="AADHAAR">Aadhaar</option>
                        <option value="PAN">PAN Card</option>
                        <option value="PASSPORT">Passport</option>
                        <option value="VOTER_ID">Voter ID</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">ID Proof Number *</span>
                      <input
                        required
                        value={idProofNumber}
                        onChange={(e) => setIdProofNumber(e.target.value)}
                        placeholder="Document number"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                      />
                    </label>
                  </div>
                </section>

                {/* 3. Vehicle Information */}
                <section className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between border-b border-slate-200 pb-1.5">
                    <h2 className="text-sm font-bold text-slate-900">
                      Vehicle Specifications (Driver-Owned)
                    </h2>
                    <span className="text-[11px] text-emerald-700 font-medium">
                      Computed Cargo Volume: {computedVolumeCbm} m³
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Registration Number *</span>
                      <input
                        required
                        value={registrationNumber}
                        onChange={(e) => setRegistrationNumber(e.target.value)}
                        placeholder="GJ06XX4411"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Vehicle Category *</span>
                      <input
                        required
                        value={vehicleCategory}
                        onChange={(e) => setVehicleCategory(e.target.value)}
                        placeholder="10ft Closed Body LCV"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Vehicle Body Type *</span>
                      <select
                        value={bodyType}
                        onChange={(e) => setBodyType(e.target.value as VehicleBodyType)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      >
                        <option value="CLOSED_BODY">Closed Body</option>
                        <option value="OPEN_BODY">Open Body</option>
                        <option value="CONTAINER">Container</option>
                        <option value="FLATBED">Flatbed</option>
                        <option value="MINI_PICKUP">Mini Pickup</option>
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Max Payload (kg) *</span>
                      <input
                        required
                        type="number"
                        min={100}
                        value={maxWeightKg}
                        onChange={(e) => setMaxWeightKg(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Bed Length (cm) *</span>
                      <input
                        required
                        type="number"
                        min={50}
                        value={bedLengthCm}
                        onChange={(e) => setBedLengthCm(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Bed Width (cm) *</span>
                      <input
                        required
                        type="number"
                        min={50}
                        value={bedWidthCm}
                        onChange={(e) => setBedWidthCm(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Bed Height (cm) *</span>
                      <input
                        required
                        type="number"
                        min={50}
                        value={bedHeightCm}
                        onChange={(e) => setBedHeightCm(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Expected Per-km Rate (₹/km) *</span>
                      <input
                        required
                        type="number"
                        min={5}
                        max={200}
                        value={perKmRupees}
                        onChange={(e) => setPerKmRupees(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>
                </section>

                {/* 4. RC & Insurance + File Uploads */}
                <section className="space-y-3">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    Vehicle Compliance &amp; Required Document Uploads
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">RC Number *</span>
                      <input
                        required
                        value={rcNumber}
                        onChange={(e) => setRcNumber(e.target.value)}
                        placeholder="RC-GJ06-441100"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Insurance Policy Number *</span>
                      <input
                        required
                        value={insurancePolicyNumber}
                        onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                        placeholder="INS-COM-2026-4411"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Insurance Valid Until</span>
                      <input
                        type="date"
                        value={insuranceValidUntil}
                        onChange={(e) => setInsuranceValidUntil(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Fitness Valid Until</span>
                      <input
                        type="date"
                        value={fitnessValidUntil}
                        onChange={(e) => setFitnessValidUntil(e.target.value)}
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>
                  <label className="block space-y-1">
                    <span className="font-medium text-slate-700">Permit / Vehicle Notes (Optional)</span>
                    <input
                      value={permitNotes}
                      onChange={(e) => setPermitNotes(e.target.value)}
                      placeholder="e.g. Gujarat State Commercial Goods Permit"
                      className="w-full rounded-lg border border-slate-300 px-3 py-2"
                    />
                  </label>

                  <div className="grid gap-3 pt-2 sm:grid-cols-2">
                    {docInputs.map((item) => {
                      const selectedFile = files[item.fieldName];
                      return (
                        <div
                          key={item.fieldName}
                          className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800">{item.label}</span>
                            {selectedFile ? (
                              <Badge variant="success">Attached</Badge>
                            ) : (
                              <Badge variant="neutral">Required</Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500">{item.helper} (JPG/PNG/WebP/PDF, max 5 MB)</p>
                          <label className="mt-1 flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-[11px] font-medium text-slate-700 hover:border-emerald-500">
                            <FileUp className="h-3.5 w-3.5 text-emerald-700" />
                            <span>{selectedFile ? 'Replace File' : 'Choose Document File'}</span>
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                              className="sr-only"
                              onChange={(e) =>
                                handleFileChange(item.fieldName, e.target.files?.[0] ?? null)
                              }
                            />
                          </label>
                          {selectedFile ? (
                            <p className="truncate text-[11px] text-emerald-700">
                              {selectedFile.name} ({formatBytes(selectedFile.size)})
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 5. Account Credentials */}
                <section className="space-y-3">
                  <h2 className="border-b border-slate-200 pb-1.5 text-sm font-bold text-slate-900">
                    Driver Portal Credentials
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Create Password *</span>
                      <input
                        required
                        type="password"
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimum 8 characters"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="font-medium text-slate-700">Confirm Password *</span>
                      <input
                        required
                        type="password"
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="w-full rounded-lg border border-slate-300 px-3 py-2"
                      />
                    </label>
                  </div>
                </section>

                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                    <ShieldCheck className="h-4 w-4 text-emerald-700" />
                    Documents are accessible only to you and the Platform Owner.
                  </div>
                  <Button type="submit" variant="primary" size="md" disabled={submitting}>
                    <Send className="h-4 w-4" />
                    {submitting ? 'Submitting Application...' : 'Submit Driver Application'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

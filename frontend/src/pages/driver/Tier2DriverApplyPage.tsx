import { useMemo, useState, type DragEvent, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  Box,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  FileUp,
  IdCard,
  KeyRound,
  Send,
  ShieldCheck,
  Truck,
  UserCheck,
} from 'lucide-react';
import {
  ApiError,
  fetchPublicTier2Policy,
  submitPublicTier2Application,
} from '@/api/client';
import { OrbitDriverLayout } from '@/components/driver/OrbitDriverLayout';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';
import type { IdProofType, VehicleBodyType } from '@/types/api';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);
const DEFAULT_MAX_DOC_BYTES = 5 * 1024 * 1024;

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

  const maxDocBytes = policyQuery.data?.policy.maxFileSizeBytes ?? DEFAULT_MAX_DOC_BYTES;
  const maxDocMb = Math.round(maxDocBytes / (1024 * 1024));

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
  const [showPassword, setShowPassword] = useState(false);

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

  // Document uploads & drag state
  const [files, setFiles] = useState<Partial<Record<DocFieldName, File>>>({});
  const [dragField, setDragField] = useState<DocFieldName | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedRef, setCopiedRef] = useState(false);
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
    if (
      !Number.isFinite(l) ||
      !Number.isFinite(w) ||
      !Number.isFinite(h) ||
      l <= 0 ||
      w <= 0 ||
      h <= 0
    ) {
      return 0;
    }
    return Number(((l * w * h) / 1_000_000).toFixed(2));
  }, [bedLengthCm, bedWidthCm, bedHeightCm]);

  const sectionStatus = useMemo(() => {
    const personalDone = Boolean(
      fullName.trim() &&
        email.trim() &&
        phone.trim() &&
        addressLine.trim() &&
        cityOrTown.trim() &&
        district.trim() &&
        pincode.trim().length === 6
    );
    const identityDone = Boolean(licenseNumber.trim() && idProofNumber.trim());
    const vehicleDone = Boolean(
      registrationNumber.trim() &&
        vehicleCategory.trim() &&
        Number(maxWeightKg) >= 100 &&
        computedVolumeCbm > 0
    );
    const docsCount = (
      ['licenseFile', 'idProofFile', 'rcFile', 'insuranceFile'] as DocFieldName[]
    ).filter((k) => Boolean(files[k])).length;
    const complianceDone = Boolean(
      rcNumber.trim() && insurancePolicyNumber.trim() && docsCount === 4
    );
    const passwordDone = password.length >= 8 && password === confirmPassword;

    const stepsDone = [
      personalDone,
      identityDone,
      vehicleDone,
      complianceDone,
      passwordDone,
    ].filter(Boolean).length;

    return {
      personalDone,
      identityDone,
      vehicleDone,
      complianceDone,
      passwordDone,
      docsCount,
      percent: Math.round((stepsDone / 5) * 100),
    };
  }, [
    fullName,
    email,
    phone,
    addressLine,
    cityOrTown,
    district,
    pincode,
    licenseNumber,
    idProofNumber,
    registrationNumber,
    vehicleCategory,
    maxWeightKg,
    computedVolumeCbm,
    rcNumber,
    insurancePolicyNumber,
    files,
    password,
    confirmPassword,
  ]);

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
    if (file.size > maxDocBytes) {
      setFormError(`"${file.name}" exceeds the ${maxDocMb} MB file limit.`);
      return;
    }
    setFiles((prev) => ({ ...prev, [fieldName]: file }));
  };

  const handleDrop = (fieldName: DocFieldName, e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setDragField(null);
    const dropped = e.dataTransfer.files?.[0] ?? null;
    if (dropped) {
      handleFileChange(fieldName, dropped);
    }
  };

  const handleCopyRef = async (ref: string) => {
    try {
      await navigator.clipboard.writeText(ref);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      setCopiedRef(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
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

  const sectionIndicators = [
    { label: 'Personal', done: sectionStatus.personalDone },
    { label: 'Identity', done: sectionStatus.identityDone },
    { label: 'Vehicle', done: sectionStatus.vehicleDone },
    { label: `Docs (${sectionStatus.docsCount}/4)`, done: sectionStatus.complianceDone },
    { label: 'Credentials', done: sectionStatus.passwordDone },
  ];

  return (
    <OrbitDriverLayout
      brandSub="tier 2 apply"
      headerCtaLabel="Track Status"
      headerCtaTo="/driver/application-status"
    >
      <div className="mx-auto max-w-5xl space-y-7 px-5 pb-14 pt-6 sm:px-8 lg:pt-10">
        {/* Editorial Hero Header */}
        <section className="orbit-reveal-1 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#7a94df]">
              Tier 2 Marketplace Application
            </p>
            <h1 className="text-[36px] font-[550] leading-[1.06] tracking-[-0.05em] text-[#080e2b] sm:text-[48px]">
              Register your vehicle &amp;{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
                style={{ fontStyle: 'italic' }}
              >
                join the corridor.
              </em>
            </h1>
            <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#5c6b94] sm:text-[15px]">
              {policyQuery.data?.policy.payoutPolicySummary ??
                'Independent vehicle owners only. Approval by Platform Owner is required before receiving marketplace trips.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium">
            <Link
              to="/become-a-driver"
              className="rounded-full border border-[#dce5fa] bg-white px-4 py-2 text-[#4d5a83] transition hover:border-[#4673eb] hover:text-[#080e2b]"
            >
              Program Details
            </Link>
            <Link
              to="/driver/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#cddbfa] bg-[#eef3ff] px-4 py-2 text-[#3563e4] transition hover:bg-[#dfe9ff]"
            >
              Driver Login
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>

        {submittedResult ? (
          <section className="orbit-reveal-1 overflow-hidden rounded-[30px] border border-[#b7caf7] bg-white/95 shadow-[0_26px_75px_-28px_rgba(24,60,115,0.26)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e3ebfc] bg-[#f4f8ff] px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white shadow-xs">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7a94df]">
                    Verification Request Created
                  </p>
                  <h2 className="text-lg font-semibold text-[#080e2b]">
                    Application Submitted for Review
                  </h2>
                </div>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1 text-xs font-semibold text-amber-800">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                {submittedResult.status}
              </span>
            </div>

            <div className="space-y-5 p-6 text-xs text-[#4d5a83] sm:p-8">
              <div className="grid gap-4 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <p className="text-[11px] text-[#7a87aa]">Tracking Reference ID</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                    <span className="rounded-xl border border-[#cddbfa] bg-white px-3.5 py-1.5 font-mono text-base font-bold text-[#080e2b]">
                      {submittedResult.applicationRef}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopyRef(submittedResult.applicationRef)}
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#d6e0f8] bg-white px-3 py-1.5 text-xs font-medium text-[#3563e4] transition hover:border-[#4673eb]"
                    >
                      {copiedRef ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {copiedRef ? 'Copied' : 'Copy ID'}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] text-[#7a87aa]">Registered Email</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">{submittedResult.email}</p>
                </div>
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Submitted At</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {new Date(submittedResult.appliedAt).toLocaleString('en-IN')}
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-[11px] text-[#7a87aa]">Uploaded Files</p>
                  <p className="mt-0.5 font-semibold text-emerald-700">
                    {submittedResult.uploadedDocumentsCount} verified documents securely stored for
                    Platform Owner review
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/85 p-4 leading-relaxed text-amber-950">
                Your driver account has been created with <strong>PENDING</strong> Tier 2 review
                status. Marketplace trip opportunities remain locked until the Platform Owner
                verifies your documents and approves your application.
              </div>

              <div className="flex flex-wrap gap-3">
                <Link
                  to="/driver/application-status"
                  className="inline-flex items-center gap-2 rounded-[22px] bg-[#4673eb] px-5 py-3 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda]"
                >
                  View Application Status
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/driver"
                  className="inline-flex items-center gap-2 rounded-[22px] border border-[#cddbfa] bg-white px-5 py-3 text-xs font-semibold text-[#080e2b] transition hover:border-[#4673eb]"
                >
                  Open Driver Portal
                </Link>
              </div>
            </div>
          </section>
        ) : (
          <div className="space-y-6">
            {/* Live Interactive Progress Rail */}
            <div className="orbit-reveal-2 rounded-[24px] border border-[#dce5fa] bg-white/95 p-4 shadow-[0_14px_40px_-24px_rgba(24,60,115,0.2)] sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-[#080e2b]">
                  Application Readiness ({sectionStatus.percent}%)
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {sectionIndicators.map((ind) => (
                    <span
                      key={ind.label}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors',
                        ind.done
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-[#e3ebfc] bg-[#f8faff] text-[#6d7ca6]'
                      )}
                    >
                      {ind.done && <CheckCircle2 className="h-3 w-3" />}
                      {ind.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[#eef3ff]">
                <div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#6389f0,#3563e4)] transition-all duration-500 ease-out"
                  style={{ width: `${Math.max(8, sectionStatus.percent)}%` }}
                />
              </div>
            </div>

            {/* Main Orbit Application Card */}
            <section className="orbit-reveal-3 rounded-[30px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_24px_75px_-28px_rgba(24,60,115,0.22)] sm:p-8">
              {formError ? (
                <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                  {formError}
                </div>
              ) : null}

              <form onSubmit={handleSubmit} className="space-y-8 text-xs">
                {/* 1. Personal & Contact Info */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2.5 border-b border-[#eaf0fd] pb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                      <UserCheck className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[#080e2b]">
                        1. Personal Information
                      </h2>
                      <p className="text-[11px] text-[#5c6b94]">
                        Primary owner contact details and corridor home address.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Full Name *</span>
                      <input
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="e.g. Sureshbhai Solanki"
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Email Address *</span>
                      <input
                        required
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="driver@example.com"
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Phone Number *</span>
                      <input
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+919825001122"
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">
                        Residential Street / Landmark *
                      </span>
                      <input
                        required
                        value={addressLine}
                        onChange={(e) => setAddressLine(e.target.value)}
                        placeholder="House / Society / Road"
                        className="orbit-input"
                      />
                    </label>
                    <div className="grid gap-3.5 sm:col-span-2 sm:grid-cols-4">
                      <label className="block space-y-1.5">
                        <span className="font-medium text-[#3b476b]">City / Town *</span>
                        <input
                          required
                          value={cityOrTown}
                          onChange={(e) => setCityOrTown(e.target.value)}
                          placeholder="Vadodara"
                          className="orbit-input"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="font-medium text-[#3b476b]">District *</span>
                        <input
                          required
                          value={district}
                          onChange={(e) => setDistrict(e.target.value)}
                          placeholder="Vadodara"
                          className="orbit-input"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="font-medium text-[#3b476b]">State *</span>
                        <input
                          required
                          value={stateName}
                          onChange={(e) => setStateName(e.target.value)}
                          className="orbit-input"
                        />
                      </label>
                      <label className="block space-y-1.5">
                        <span className="font-medium text-[#3b476b]">6-digit PIN Code *</span>
                        <input
                          required
                          pattern="\d{6}"
                          value={pincode}
                          onChange={(e) => setPincode(e.target.value)}
                          placeholder="390010"
                          className="orbit-input font-mono"
                        />
                      </label>
                    </div>
                  </div>
                </section>

                {/* 2. Identity & License */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2.5 border-b border-[#eaf0fd] pb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                      <IdCard className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[#080e2b]">
                        2. Identity &amp; License Numbers
                      </h2>
                      <p className="text-[11px] text-[#5c6b94]">
                        Must match the commercial license and ID proof uploaded below.
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-3">
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Driving License Number *</span>
                      <input
                        required
                        value={licenseNumber}
                        onChange={(e) => setLicenseNumber(e.target.value)}
                        placeholder="GJ06-20200044112"
                        className="orbit-input font-mono uppercase"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">ID Proof Type *</span>
                      <select
                        value={idProofType}
                        onChange={(e) => setIdProofType(e.target.value as IdProofType)}
                        className="orbit-input"
                      >
                        <option value="AADHAAR">Aadhaar</option>
                        <option value="PAN">PAN Card</option>
                        <option value="PASSPORT">Passport</option>
                        <option value="VOTER_ID">Voter ID</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">ID Proof Number *</span>
                      <input
                        required
                        value={idProofNumber}
                        onChange={(e) => setIdProofNumber(e.target.value)}
                        placeholder="Document number"
                        className="orbit-input font-mono uppercase"
                      />
                    </label>
                  </div>
                </section>

                {/* 3. Vehicle Information + Live Capacity Preview */}
                <section className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                        <Truck className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-[#080e2b]">
                          3. Vehicle Specifications (Driver-Owned)
                        </h2>
                        <p className="text-[11px] text-[#5c6b94]">
                          Used by MeeCargo OR-Tools LIFO engine to match corridor overflow trips.
                        </p>
                      </div>
                    </div>

                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#cddbfa] bg-[#eef3ff] px-3 py-1 text-[11px] font-semibold text-[#3563e4]">
                      <Box className="h-3.5 w-3.5" />
                      Cargo Volume: {computedVolumeCbm} m³
                    </span>
                  </div>

                  {/* Interactive Live Truck Spec Summary Pill Strip */}
                  <div className="grid gap-3 rounded-2xl border border-[#e3ebfc] bg-[#f7faff] p-4 sm:grid-cols-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                        Estimated Cubic Volume
                      </p>
                      <p className="mt-1 text-base font-bold text-[#080e2b]">
                        {computedVolumeCbm} m³{' '}
                        <span className="text-[11px] font-normal text-[#5c6b94]">
                          ({bedLengthCm || 0}×{bedWidthCm || 0}×{bedHeightCm || 0} cm)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                        Payload Capacity
                      </p>
                      <p className="mt-1 text-base font-bold text-[#080e2b]">
                        {Number(maxWeightKg || 0).toLocaleString('en-IN')} kg
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                        Expected Payout Rate
                      </p>
                      <p className="mt-1 text-base font-bold text-[#4673eb]">
                        ₹{Number(perKmRupees || 0)} / km
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-3">
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Registration Number *</span>
                      <input
                        required
                        value={registrationNumber}
                        onChange={(e) => setRegistrationNumber(e.target.value)}
                        placeholder="GJ06XX4411"
                        className="orbit-input font-mono uppercase"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Vehicle Category *</span>
                      <input
                        required
                        value={vehicleCategory}
                        onChange={(e) => setVehicleCategory(e.target.value)}
                        placeholder="10ft Closed Body LCV"
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Vehicle Body Type *</span>
                      <select
                        value={bodyType}
                        onChange={(e) => setBodyType(e.target.value as VehicleBodyType)}
                        className="orbit-input"
                      >
                        <option value="CLOSED_BODY">Closed Body</option>
                        <option value="OPEN_BODY">Open Body</option>
                        <option value="CONTAINER">Container</option>
                        <option value="FLATBED">Flatbed</option>
                        <option value="MINI_PICKUP">Mini Pickup</option>
                      </select>
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Max Payload (kg) *</span>
                      <input
                        required
                        type="number"
                        min={100}
                        value={maxWeightKg}
                        onChange={(e) => setMaxWeightKg(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Bed Length (cm) *</span>
                      <input
                        required
                        type="number"
                        min={50}
                        value={bedLengthCm}
                        onChange={(e) => setBedLengthCm(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Bed Width (cm) *</span>
                      <input
                        required
                        type="number"
                        min={50}
                        value={bedWidthCm}
                        onChange={(e) => setBedWidthCm(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Bed Height (cm) *</span>
                      <input
                        required
                        type="number"
                        min={50}
                        value={bedHeightCm}
                        onChange={(e) => setBedHeightCm(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5 sm:col-span-2">
                      <span className="font-medium text-[#3b476b]">
                        Expected Per-km Rate (₹/km) *
                      </span>
                      <input
                        required
                        type="number"
                        min={5}
                        max={200}
                        value={perKmRupees}
                        onChange={(e) => setPerKmRupees(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                  </div>
                </section>

                {/* 4. RC & Insurance + Drag-and-Drop File Uploads */}
                <section className="space-y-4">
                  <div className="flex items-center gap-2.5 border-b border-[#eaf0fd] pb-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                      <FileUp className="h-4 w-4" />
                    </div>
                    <div>
                      <h2 className="text-sm font-semibold text-[#080e2b]">
                        4. Vehicle Compliance &amp; Required Document Uploads
                      </h2>
                      <p className="text-[11px] text-[#5c6b94]">
                        Drag &amp; drop or choose files (JPEG, PNG, WebP, or PDF up to {maxDocMb}{' '}
                        MB each).
                      </p>
                    </div>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">RC Number *</span>
                      <input
                        required
                        value={rcNumber}
                        onChange={(e) => setRcNumber(e.target.value)}
                        placeholder="RC-GJ06-441100"
                        className="orbit-input font-mono uppercase"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">
                        Insurance Policy Number *
                      </span>
                      <input
                        required
                        value={insurancePolicyNumber}
                        onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                        placeholder="INS-COM-2026-4411"
                        className="orbit-input font-mono uppercase"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Insurance Valid Until</span>
                      <input
                        type="date"
                        value={insuranceValidUntil}
                        onChange={(e) => setInsuranceValidUntil(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Fitness Valid Until</span>
                      <input
                        type="date"
                        value={fitnessValidUntil}
                        onChange={(e) => setFitnessValidUntil(e.target.value)}
                        className="orbit-input"
                      />
                    </label>
                  </div>

                  <label className="block space-y-1.5">
                    <span className="font-medium text-[#3b476b]">
                      Permit / Vehicle Notes (Optional)
                    </span>
                    <input
                      value={permitNotes}
                      onChange={(e) => setPermitNotes(e.target.value)}
                      placeholder="e.g. Gujarat State Commercial Goods Permit"
                      className="orbit-input"
                    />
                  </label>

                  <div className="grid gap-3.5 pt-1 sm:grid-cols-2">
                    {docInputs.map((item) => {
                      const selectedFile = files[item.fieldName];
                      const isDragging = dragField === item.fieldName;

                      return (
                        <div
                          key={item.fieldName}
                          className={cn(
                            'rounded-2xl border p-4 transition-all',
                            selectedFile
                              ? 'border-emerald-200 bg-emerald-50/40'
                              : 'border-[#e3ebfc] bg-[#f8faff]'
                          )}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-semibold text-[#080e2b]">
                              {item.label}
                            </span>
                            {selectedFile ? (
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3 w-3" />
                                Attached
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full border border-[#d6e0f8] bg-white px-2.5 py-0.5 text-[10px] font-medium text-[#5c6b94]">
                                Required
                              </span>
                            )}
                          </div>

                          <p className="mt-1 text-[11px] text-[#5c6b94]">
                            {item.helper} (JPG/PNG/WebP/PDF, max {maxDocMb} MB)
                          </p>

                          <label
                            onDragOver={(e) => {
                              e.preventDefault();
                              setDragField(item.fieldName);
                            }}
                            onDragLeave={() => setDragField(null)}
                            onDrop={(e) => handleDrop(item.fieldName, e)}
                            className={cn(
                              'mt-2.5 flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-2.5 text-[11px] font-medium transition-all',
                              isDragging
                                ? 'border-[#4673eb] bg-[#eef3ff] text-[#3563e4]'
                                : 'border-[#c5d4f7] bg-white text-[#3b476b] hover:border-[#4673eb] hover:bg-[#eef3ff]/60'
                            )}
                          >
                            <FileUp className="h-3.5 w-3.5 text-[#4673eb]" />
                            <span>
                              {selectedFile
                                ? 'Replace Document File'
                                : 'Drop file or click to upload'}
                            </span>
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
                            <p className="mt-2 truncate text-[11px] font-medium text-emerald-700">
                              {selectedFile.name} ({formatBytes(selectedFile.size)})
                            </p>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 5. Account Credentials */}
                <section className="space-y-4">
                  <div className="flex items-center justify-between gap-2 border-b border-[#eaf0fd] pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                        <KeyRound className="h-4 w-4" />
                      </div>
                      <div>
                        <h2 className="text-sm font-semibold text-[#080e2b]">
                          5. Driver Portal Credentials
                        </h2>
                        <p className="text-[11px] text-[#5c6b94]">
                          Set your password for signing into the MeeCargo Driver PWA.
                        </p>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-[#d6e0f8] bg-[#f8faff] px-3 py-1 text-[11px] font-medium text-[#4d5a83] hover:border-[#4673eb]"
                    >
                      {showPassword ? (
                        <>
                          <EyeOff className="h-3 w-3" />
                          Hide
                        </>
                      ) : (
                        <>
                          <Eye className="h-3 w-3" />
                          Show
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid gap-3.5 sm:grid-cols-2">
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Create Password *</span>
                      <input
                        required
                        type={showPassword ? 'text' : 'password'}
                        minLength={8}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Minimum 8 characters"
                        className="orbit-input"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="font-medium text-[#3b476b]">Confirm Password *</span>
                      <input
                        required
                        type={showPassword ? 'text' : 'password'}
                        minLength={8}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Re-enter password"
                        className="orbit-input"
                      />
                    </label>
                  </div>
                </section>

                {/* Form Submit Bar */}
                <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#eaf0fd] pt-5">
                  <div className="flex items-center gap-2 text-xs text-[#5c6b94]">
                    <ShieldCheck className="h-4 w-4 shrink-0 text-[#4673eb]" />
                    <span>
                      Documents remain encrypted and visible only to you and the Platform Owner.
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="group inline-flex cursor-pointer items-center gap-2 rounded-[26px] bg-[#4673eb] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_14px_34px_-12px_rgba(70,115,235,0.65),inset_0_1px_0_#ffffff33] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#345fda] disabled:pointer-events-none disabled:opacity-55"
                  >
                    <Send className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                    <span>
                      {submitting ? 'Submitting Application...' : 'Submit Driver Application'}
                    </span>
                  </button>
                </div>
              </form>
            </section>
          </div>
        )}
      </div>
    </OrbitDriverLayout>
  );
}

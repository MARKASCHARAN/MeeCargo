import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  Send,
  ShieldAlert,
  Truck,
} from 'lucide-react';
import {
  fetchDriverTier2Application,
  submitDriverTier2Application,
} from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { LoadingState } from '@/components/ui/StateViews';
import { useAuthStore } from '@/stores/authStore';
import type { IdProofType, VehicleBodyType } from '@/types/api';

export function Tier2ApplicationPortalCard() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const appQuery = useQuery({
    queryKey: ['driver-tier2-application'],
    queryFn: fetchDriverTier2Application,
  });

  const existing = appQuery.data?.application ?? null;
  const profile = appQuery.data?.driverProfile ?? null;
  const status = appQuery.data?.applicationStatus ?? 'PENDING';

  const [editingRejected, setEditingRejected] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [cityOrTown, setCityOrTown] = useState('');
  const [district, setDistrict] = useState('');
  const [stateName, setStateName] = useState('Gujarat');
  const [pincode, setPincode] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [idProofType, setIdProofType] = useState<IdProofType>('AADHAAR');
  const [idProofNumber, setIdProofNumber] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [vehicleCategory, setVehicleCategory] = useState('10ft Closed Body LCV');
  const [bodyType, setBodyType] = useState<VehicleBodyType>('CLOSED_BODY');
  const [maxWeightKg, setMaxWeightKg] = useState('1500');
  const [bedLengthCm, setBedLengthCm] = useState('305');
  const [bedWidthCm, setBedWidthCm] = useState('175');
  const [bedHeightCm, setBedHeightCm] = useState('155');
  const [perKmRupees, setPerKmRupees] = useState('19');
  const [rcNumber, setRcNumber] = useState('');
  const [insurancePolicyNumber, setInsurancePolicyNumber] = useState('');
  const [insuranceValidUntil, setInsuranceValidUntil] = useState('');
  const [fitnessValidUntil, setFitnessValidUntil] = useState('');
  const [permitNotes, setPermitNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);

  const submitMutation = useMutation({
    mutationFn: submitDriverTier2Application,
    onSuccess: () => {
      setFormError(null);
      setFormSuccess(
        'Application submitted for Platform Owner review. Marketplace trips unlock automatically upon approval.'
      );
      setEditingRejected(false);
      void queryClient.invalidateQueries({ queryKey: ['driver-tier2-application'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-profile'] });
    },
    onError: (err: Error) => {
      setFormSuccess(null);
      setFormError(err.message);
    },
  });

  if (appQuery.isLoading) {
    return <LoadingState title="Checking your Tier 2 driver application..." />;
  }

  const startResubmission = () => {
    if (existing) {
      setFullName(existing.fullName);
      setPhone(existing.phone);
      setAddressLine(existing.address.addressLine);
      setCityOrTown(existing.address.cityOrTown);
      setDistrict(existing.address.district);
      setStateName(existing.address.state);
      setPincode(existing.address.pincode);
      setLicenseNumber(existing.identity.licenseNumber);
      setIdProofType(existing.identity.idProofType);
      setIdProofNumber(existing.identity.idProofNumber);
      setRegistrationNumber(existing.vehicle.registrationNumber);
      setVehicleCategory(existing.vehicle.vehicleCategory);
      setBodyType(existing.vehicle.bodyType);
      setMaxWeightKg(String(existing.vehicle.maxWeightKg));
      setBedLengthCm(String(existing.vehicle.bedLengthCm));
      setBedWidthCm(String(existing.vehicle.bedWidthCm));
      setBedHeightCm(String(existing.vehicle.bedHeightCm));
      setPerKmRupees(String(Math.round(existing.vehicle.perKmRatePaise / 100)));
      setRcNumber(existing.documents.rcNumber);
      setInsurancePolicyNumber(existing.documents.insurancePolicyNumber);
      setInsuranceValidUntil(
        existing.documents.insuranceValidUntil
          ? existing.documents.insuranceValidUntil.slice(0, 10)
          : ''
      );
      setFitnessValidUntil(
        existing.documents.fitnessValidUntil
          ? existing.documents.fitnessValidUntil.slice(0, 10)
          : ''
      );
      setPermitNotes(existing.documents.permitNotes ?? '');
    }
    setEditingRejected(true);
  };

  const showForm = !existing || (status === 'REJECTED' && editingRejected);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    submitMutation.mutate({
      fullName: fullName || profile?.name || user?.name || '',
      phone: phone || profile?.phone || user?.phone || '',
      address: {
        addressLine,
        cityOrTown,
        district,
        state: stateName || 'Gujarat',
        pincode,
      },
      identity: {
        licenseNumber,
        idProofType,
        idProofNumber,
      },
      vehicle: {
        registrationNumber,
        vehicleCategory,
        bodyType,
        maxWeightKg: Number(maxWeightKg),
        bedLengthCm: Number(bedLengthCm),
        bedWidthCm: Number(bedWidthCm),
        bedHeightCm: Number(bedHeightCm),
        perKmRatePaise: Math.max(500, Math.round(Number(perKmRupees || '19') * 100)),
      },
      documents: {
        rcNumber,
        insurancePolicyNumber,
        ...(insuranceValidUntil ? { insuranceValidUntil } : {}),
        ...(fitnessValidUntil ? { fitnessValidUntil } : {}),
        ...(permitNotes ? { permitNotes } : {}),
      },
    });
  };

  return (
    <div className="space-y-6">
      <section className="orbit-reveal-1 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_18px_55px_-28px_rgba(24,60,115,0.22)] sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#7a94df]">
          Tier 2 Verification Gate
        </p>
        <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-[#080e2b] sm:text-[36px]">
          Tier 2 marketplace{' '}
          <em
            className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
            style={{ fontStyle: 'italic' }}
          >
            onboarding.
          </em>
        </h1>
        <p className="mt-1 text-xs text-[#5c6b94] sm:text-sm">
          Platform Owner approval is required before accessing Tier 2 marketplace trips.
        </p>
      </section>

      {formSuccess ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{formSuccess}</span>
        </div>
      ) : null}

      {formError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-xs font-medium text-rose-800">
          {formError}
        </div>
      ) : null}

      {existing && status === 'PENDING' ? (
        <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#b7caf7] bg-white/95 shadow-xs">
          <div className="flex items-center justify-between border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <div className="flex items-center gap-2.5 text-[#080e2b]">
              <Clock className="h-5 w-5 text-amber-600" />
              <h2 className="text-sm font-semibold">Application Under Review</h2>
            </div>
            <Badge variant="warning">PENDING</Badge>
          </div>
          <div className="space-y-4 p-6 text-xs text-[#4d5a83]">
            <p>
              Your Tier 2 driver application and vehicle documents are awaiting Platform Owner
              verification. Once approved, marketplace trip opportunities will unlock here
              automatically.
            </p>
            <div className="grid gap-2.5 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4 sm:grid-cols-2">
              {existing.applicationRef ? (
                <p className="sm:col-span-2">
                  <strong>Application Reference:</strong>{' '}
                  <span className="font-mono font-semibold text-[#080e2b]">
                    {existing.applicationRef}
                  </span>
                </p>
              ) : null}
              <p>
                <strong>Applicant:</strong> {existing.fullName} ({existing.phone})
              </p>
              <p>
                <strong>Vehicle:</strong> {existing.vehicle.registrationNumber} —{' '}
                {existing.vehicle.vehicleCategory} ({existing.vehicle.maxWeightKg} kg,{' '}
                {existing.vehicle.maxVolumeCbm} m³)
              </p>
              <p>
                <strong>Documents:</strong> License {existing.identity.licenseNumber} • RC{' '}
                {existing.documents.rcNumber} • Insurance {existing.documents.insurancePolicyNumber}
              </p>
              <p>
                <strong>Submitted:</strong> {new Date(existing.appliedAt).toLocaleString('en-IN')}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {existing && status === 'REJECTED' && !editingRejected ? (
        <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-rose-200 bg-white/95 shadow-xs">
          <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50/70 px-6 py-4">
            <div className="flex items-center gap-2 text-rose-900">
              <ShieldAlert className="h-5 w-5" />
              <h2 className="text-sm font-semibold">Application Rejected</h2>
            </div>
            <Badge variant="danger">REJECTED</Badge>
          </div>
          <div className="space-y-4 p-6 text-xs">
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
              <p className="font-semibold">Reason from Platform Owner</p>
              <p className="mt-1">{existing.rejectionReason ?? 'Please review and update details.'}</p>
            </div>
            <p className="text-[#5c6b94]">
              You do not have marketplace trip access while your application is rejected. Update the
              details below and resubmit for review.
            </p>
            <button
              type="button"
              onClick={startResubmission}
              className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#4673eb] px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-[#345fda]"
            >
              <FileText className="h-4 w-4" />
              Update &amp; Resubmit Application
            </button>
          </div>
        </section>
      ) : null}

      {showForm ? (
        <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-[#4673eb]" />
              <h2 className="text-sm font-semibold text-[#080e2b]">
                {status === 'REJECTED'
                  ? 'Resubmit Tier 2 Marketplace Application'
                  : 'Submit Tier 2 Marketplace Application'}
              </h2>
            </div>
            <p className="mt-0.5 text-[11px] text-[#5c6b94]">
              Provide your personal details, identity proof, vehicle specs, RC and insurance details.
            </p>
          </div>

          <div className="p-6">
            <form onSubmit={handleSubmit} className="space-y-5 text-xs">
              <div className="grid gap-3.5 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">Full Name *</label>
                  <input
                    value={fullName || profile?.name || user?.name || ''}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">Phone *</label>
                  <input
                    value={phone || profile?.phone || user?.phone || ''}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="orbit-input"
                  />
                </div>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-[#3b476b]">Address Line *</label>
                  <input
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    placeholder="House / Garage / Plot address"
                    required
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">City / Town *</label>
                  <input
                    value={cityOrTown}
                    onChange={(e) => setCityOrTown(e.target.value)}
                    placeholder="Anand"
                    required
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">District *</label>
                  <input
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="Anand"
                    required
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">State *</label>
                  <input
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    required
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    PIN Code (6 digits) *
                  </label>
                  <input
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    pattern="\d{6}"
                    placeholder="388001"
                    required
                    className="orbit-input font-mono"
                  />
                </div>
              </div>

              <div className="grid gap-3.5 border-t border-[#eaf0fd] pt-4 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    Driving License # *
                  </label>
                  <input
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="GJ06-2021-0091450"
                    required
                    className="orbit-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">ID Proof Type *</label>
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
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">ID Proof Number *</label>
                  <input
                    value={idProofNumber}
                    onChange={(e) => setIdProofNumber(e.target.value)}
                    placeholder="ID number"
                    required
                    className="orbit-input font-mono uppercase"
                  />
                </div>
              </div>

              <div className="grid gap-3.5 border-t border-[#eaf0fd] pt-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    Vehicle Registration # *
                  </label>
                  <input
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="GJ-07-MK-4102"
                    required
                    className="orbit-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    Vehicle Category *
                  </label>
                  <input
                    value={vehicleCategory}
                    onChange={(e) => setVehicleCategory(e.target.value)}
                    required
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">Body Type *</label>
                  <select
                    value={bodyType}
                    onChange={(e) => setBodyType(e.target.value as VehicleBodyType)}
                    className="orbit-input"
                  >
                    <option value="CLOSED_BODY">Closed Body</option>
                    <option value="MINI_PICKUP">Mini Pickup</option>
                    <option value="CONTAINER">Container</option>
                    <option value="OPEN_BODY">Open Body</option>
                    <option value="FLATBED">Flatbed</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="mb-1 block font-medium text-[#3b476b]">
                      Max Payload (kg) *
                    </label>
                    <input
                      type="number"
                      min={100}
                      value={maxWeightKg}
                      onChange={(e) => setMaxWeightKg(e.target.value)}
                      required
                      className="orbit-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-[#3b476b]">Rate (₹/km) *</label>
                    <input
                      type="number"
                      min={5}
                      value={perKmRupees}
                      onChange={(e) => setPerKmRupees(e.target.value)}
                      required
                      className="orbit-input"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2.5 sm:col-span-2">
                  <div>
                    <label className="mb-1 block font-medium text-[#3b476b]">Bed L (cm) *</label>
                    <input
                      type="number"
                      min={50}
                      value={bedLengthCm}
                      onChange={(e) => setBedLengthCm(e.target.value)}
                      required
                      className="orbit-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-[#3b476b]">Bed W (cm) *</label>
                    <input
                      type="number"
                      min={50}
                      value={bedWidthCm}
                      onChange={(e) => setBedWidthCm(e.target.value)}
                      required
                      className="orbit-input"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-[#3b476b]">Bed H (cm) *</label>
                    <input
                      type="number"
                      min={50}
                      value={bedHeightCm}
                      onChange={(e) => setBedHeightCm(e.target.value)}
                      required
                      className="orbit-input"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3.5 border-t border-[#eaf0fd] pt-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">RC Number *</label>
                  <input
                    value={rcNumber}
                    onChange={(e) => setRcNumber(e.target.value)}
                    placeholder="GJ07MK4102"
                    required
                    className="orbit-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    Insurance Policy # *
                  </label>
                  <input
                    value={insurancePolicyNumber}
                    onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                    placeholder="INS-GJ07-2026-4102"
                    required
                    className="orbit-input font-mono uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    Insurance Valid Until
                  </label>
                  <input
                    type="date"
                    value={insuranceValidUntil}
                    onChange={(e) => setInsuranceValidUntil(e.target.value)}
                    className="orbit-input"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-[#3b476b]">
                    Fitness Valid Until
                  </label>
                  <input
                    type="date"
                    value={fitnessValidUntil}
                    onChange={(e) => setFitnessValidUntil(e.target.value)}
                    className="orbit-input"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-[#3b476b]">Permit Notes</label>
                  <input
                    value={permitNotes}
                    onChange={(e) => setPermitNotes(e.target.value)}
                    placeholder="State commercial goods permit"
                    className="orbit-input"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2.5 pt-2">
                <button
                  type="submit"
                  disabled={submitMutation.isPending}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#4673eb] px-5 py-2.5 text-xs font-semibold text-white transition hover:bg-[#345fda] disabled:opacity-50"
                >
                  <Send className="h-3.5 w-3.5" />
                  {submitMutation.isPending
                    ? 'Submitting...'
                    : status === 'REJECTED'
                      ? 'Resubmit Application'
                      : 'Submit for Owner Review'}
                </button>
                {status === 'REJECTED' ? (
                  <button
                    type="button"
                    onClick={() => setEditingRejected(false)}
                    className="cursor-pointer rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2.5 text-xs font-medium text-[#080e2b]"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </form>
          </div>
        </section>
      ) : null}

      <div className="flex items-start gap-2 rounded-2xl border border-[#dce5fa] bg-white/80 px-4 py-3 text-[11px] text-[#5c6b94]">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>
          Tier 2 marketplace drivers operate independently without Tier 1 fleet contracts or
          minimum guarantees.
        </span>
      </div>
    </div>
  );
}

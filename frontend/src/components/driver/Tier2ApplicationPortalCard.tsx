import { useState } from 'react';
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
} from '../../api/client';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Card, CardContent, CardHeader } from '../ui/Card';
import { LoadingState } from '../ui/StateViews';
import { useAuthStore } from '../../stores/authStore';
import type { IdProofType, VehicleBodyType } from '../../types/api';

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

  const handleSubmit = (e: React.FormEvent) => {
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
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Tier 2 Marketplace Onboarding</h1>
        <p className="text-xs text-slate-500">
          Platform Owner approval is required before accessing Tier 2 marketplace trips.
        </p>
      </div>

      {formSuccess ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{formSuccess}</span>
        </div>
      ) : null}

      {formError ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
          {formError}
        </div>
      ) : null}

      {existing && status === 'PENDING' ? (
        <Card className="border-amber-200">
          <CardHeader className="flex items-center justify-between border-b border-amber-100 bg-amber-50/60 py-3">
            <div className="flex items-center gap-2 text-amber-900">
              <Clock className="h-4 w-4" />
              <h2 className="text-sm font-bold">Application Under Review</h2>
            </div>
            <Badge variant="warning">PENDING</Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-xs">
            <p className="text-slate-700">
              Your Tier 2 driver application and vehicle documents are awaiting Platform Owner
              verification. Once approved, marketplace trip opportunities will unlock here automatically.
            </p>
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-slate-700">
              {existing.applicationRef ? (
                <p>
                  <strong>Application Reference:</strong>{' '}
                  <span className="font-mono font-semibold text-slate-900">
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
          </CardContent>
        </Card>
      ) : null}

      {existing && status === 'REJECTED' && !editingRejected ? (
        <Card className="border-rose-200">
          <CardHeader className="flex items-center justify-between border-b border-rose-100 bg-rose-50/70 py-3">
            <div className="flex items-center gap-2 text-rose-900">
              <ShieldAlert className="h-4 w-4" />
              <h2 className="text-sm font-bold">Application Rejected</h2>
            </div>
            <Badge variant="danger">REJECTED</Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-4 text-xs">
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
              <p className="font-semibold">Reason from Platform Owner</p>
              <p className="mt-1">{existing.rejectionReason ?? 'Please review and update details.'}</p>
            </div>
            <p className="text-slate-600">
              You do not have marketplace trip access while your application is rejected. Update the
              details or documents below and resubmit for review.
            </p>
            <Button variant="primary" size="sm" onClick={startResubmission}>
              <FileText className="h-4 w-4" />
              Update &amp; Resubmit Application
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {showForm ? (
        <Card>
          <CardHeader className="border-b border-slate-100 py-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-700" />
              <h2 className="text-sm font-bold text-slate-900">
                {status === 'REJECTED'
                  ? 'Resubmit Tier 2 Marketplace Application'
                  : 'Submit Tier 2 Marketplace Application'}
              </h2>
            </div>
            <p className="text-[11px] text-slate-500">
              Provide your personal details, identity proof, vehicle specs, RC and insurance details.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Full Name *</label>
                  <input
                    value={fullName || profile?.name || user?.name || ''}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Phone *</label>
                  <input
                    value={phone || profile?.phone || user?.phone || ''}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-slate-700">Address Line *</label>
                  <input
                    value={addressLine}
                    onChange={(e) => setAddressLine(e.target.value)}
                    placeholder="House / Garage / Plot address"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">City / Town *</label>
                  <input
                    value={cityOrTown}
                    onChange={(e) => setCityOrTown(e.target.value)}
                    placeholder="Anand"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">District *</label>
                  <input
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    placeholder="Anand"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">State *</label>
                  <input
                    value={stateName}
                    onChange={(e) => setStateName(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">PIN Code (6 digits) *</label>
                  <input
                    value={pincode}
                    onChange={(e) => setPincode(e.target.value)}
                    pattern="\d{6}"
                    placeholder="388001"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Driving License # *</label>
                  <input
                    value={licenseNumber}
                    onChange={(e) => setLicenseNumber(e.target.value)}
                    placeholder="GJ06-2021-0091450"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">ID Proof Type *</label>
                  <select
                    value={idProofType}
                    onChange={(e) => setIdProofType(e.target.value as IdProofType)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="AADHAAR">Aadhaar</option>
                    <option value="PAN">PAN Card</option>
                    <option value="PASSPORT">Passport</option>
                    <option value="VOTER_ID">Voter ID</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">ID Proof Number *</label>
                  <input
                    value={idProofNumber}
                    onChange={(e) => setIdProofNumber(e.target.value)}
                    placeholder="ID number"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                  />
                </div>
              </div>

              <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Vehicle Registration # *</label>
                  <input
                    value={registrationNumber}
                    onChange={(e) => setRegistrationNumber(e.target.value)}
                    placeholder="GJ-07-MK-4102"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Vehicle Category *</label>
                  <input
                    value={vehicleCategory}
                    onChange={(e) => setVehicleCategory(e.target.value)}
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Body Type *</label>
                  <select
                    value={bodyType}
                    onChange={(e) => setBodyType(e.target.value as VehicleBodyType)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                  >
                    <option value="CLOSED_BODY">Closed Body</option>
                    <option value="MINI_PICKUP">Mini Pickup</option>
                    <option value="CONTAINER">Container</option>
                    <option value="OPEN_BODY">Open Body</option>
                    <option value="FLATBED">Flatbed</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">Max Payload (kg) *</label>
                    <input
                      type="number"
                      min={100}
                      value={maxWeightKg}
                      onChange={(e) => setMaxWeightKg(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">Rate (₹/km) *</label>
                    <input
                      type="number"
                      min={5}
                      value={perKmRupees}
                      onChange={(e) => setPerKmRupees(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:col-span-2">
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">Bed L (cm) *</label>
                    <input
                      type="number"
                      min={50}
                      value={bedLengthCm}
                      onChange={(e) => setBedLengthCm(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">Bed W (cm) *</label>
                    <input
                      type="number"
                      min={50}
                      value={bedWidthCm}
                      onChange={(e) => setBedWidthCm(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block font-medium text-slate-700">Bed H (cm) *</label>
                    <input
                      type="number"
                      min={50}
                      value={bedHeightCm}
                      onChange={(e) => setBedHeightCm(e.target.value)}
                      required
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block font-medium text-slate-700">RC Number *</label>
                  <input
                    value={rcNumber}
                    onChange={(e) => setRcNumber(e.target.value)}
                    placeholder="GJ07MK4102"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Insurance Policy # *</label>
                  <input
                    value={insurancePolicyNumber}
                    onChange={(e) => setInsurancePolicyNumber(e.target.value)}
                    placeholder="INS-GJ07-2026-4102"
                    required
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Insurance Valid Until</label>
                  <input
                    type="date"
                    value={insuranceValidUntil}
                    onChange={(e) => setInsuranceValidUntil(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="mb-1 block font-medium text-slate-700">Fitness Valid Until</label>
                  <input
                    type="date"
                    value={fitnessValidUntil}
                    onChange={(e) => setFitnessValidUntil(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="mb-1 block font-medium text-slate-700">Permit Notes</label>
                  <input
                    value={permitNotes}
                    onChange={(e) => setPermitNotes(e.target.value)}
                    placeholder="State commercial goods permit"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="primary" disabled={submitMutation.isPending}>
                  <Send className="h-3.5 w-3.5" />
                  {submitMutation.isPending
                    ? 'Submitting...'
                    : status === 'REJECTED'
                      ? 'Resubmit Application'
                      : 'Submit for Owner Review'}
                </Button>
                {status === 'REJECTED' ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setEditingRejected(false)}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
        <span>
          Tier 2 marketplace drivers operate independently without Tier 1 fleet contracts or minimum guarantees.
        </span>
      </div>
    </div>
  );
}

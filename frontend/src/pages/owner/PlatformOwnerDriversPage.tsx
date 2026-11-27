import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Ban,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Edit3,
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  Lock,
  PauseCircle,
  Plus,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
  UserCheck,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  fetchPlatformOwnerCatalog,
  fetchPlatformOwnerDrivers,
  registerPlatformOwnerDriver,
  resetContractDriverPassword,
  saveDriverContract,
  updateContractDriverStatus,
  upsertDriverOwnedVehicle,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import type {
  DriverAccountStatus,
  DriverContractRecord,
  DriverContractStatus,
  ManagedContractDriver,
  VehicleBodyType,
  VehicleOperationalStatus,
} from '../../types/api';

function toDateInputValue(iso?: string, fallbackDaysFromNow = 0) {
  const d = iso ? new Date(iso) : new Date(Date.now() + fallbackDaysFromNow * 86400_000);
  return d.toISOString().slice(0, 10);
}

const statusBadgeVariant = (
  s: string
): 'success' | 'warning' | 'danger' | 'neutral' => {
  if (s === 'ACTIVE' || s === 'VERIFIED') return 'success';
  if (s === 'SUSPENDED' || s === 'REJECTED') return 'danger';
  if (s === 'INACTIVE' || s === 'MAINTENANCE' || s === 'EXPIRED' || s === 'TERMINATED')
    return 'warning';
  return 'neutral';
};

export function PlatformOwnerDriversPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // New Tier 1 Driver + Driver-Owned Vehicle + Contract registration state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('Demo@1234');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [licenseNumber, setLicenseNumber] = useState('');
  const [homeBase, setHomeBase] = useState('');
  const [startDate, setStartDate] = useState(() => toDateInputValue(undefined, 0));
  const [endDate, setEndDate] = useState(() => toDateInputValue(undefined, 365));
  const [minGuaranteeRupees, setMinGuaranteeRupees] = useState('3200');
  const [perKmRupees, setPerKmRupees] = useState('24');
  const [guaranteedMonthlyDays, setGuaranteedMonthlyDays] = useState('24');
  const [selectedCorridorIds, setSelectedCorridorIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Driver-Owned Vehicle fields (registration)
  const [vehReg, setVehReg] = useState('');
  const [vehCategory, setVehCategory] = useState('14ft Closed Body LCV');
  const [vehBodyType, setVehBodyType] = useState<VehicleBodyType>('CLOSED_BODY');
  const [vehMaxWeightKg, setVehMaxWeightKg] = useState('2500');
  const [vehLengthCm, setVehLengthCm] = useState('425');
  const [vehWidthCm, setVehWidthCm] = useState('195');
  const [vehHeightCm, setVehHeightCm] = useState('150');
  const [vehVolumeCbm, setVehVolumeCbm] = useState('12.4');
  const [vehStatus, setVehStatus] = useState<VehicleOperationalStatus>('ACTIVE');
  const [vehRc, setVehRc] = useState('');
  const [vehIns, setVehIns] = useState('');
  const [vehVerification, setVehVerification] = useState<'PENDING' | 'VERIFIED' | 'REJECTED'>(
    'VERIFIED'
  );

  // Driver-Owned Vehicle editor per driver
  const [editingVehicleFor, setEditingVehicleFor] = useState<string | null>(null);
  const [eVehReg, setEVehReg] = useState('');
  const [eVehCategory, setEVehCategory] = useState('');
  const [eVehBodyType, setEVehBodyType] = useState<VehicleBodyType>('CLOSED_BODY');
  const [eVehMaxWeightKg, setEVehMaxWeightKg] = useState('2500');
  const [eVehLengthCm, setEVehLengthCm] = useState('425');
  const [eVehWidthCm, setEVehWidthCm] = useState('195');
  const [eVehHeightCm, setEVehHeightCm] = useState('150');
  const [eVehVolumeCbm, setEVehVolumeCbm] = useState('12.5');
  const [eVehStatus, setEVehStatus] = useState<VehicleOperationalStatus>('ACTIVE');
  const [eVehRc, setEVehRc] = useState('');
  const [eVehIns, setEVehIns] = useState('');
  const [eVehVerification, setEVehVerification] = useState<'PENDING' | 'VERIFIED' | 'REJECTED'>(
    'VERIFIED'
  );

  // Contract editor & history expansion
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editContractId, setEditContractId] = useState<string | undefined>(undefined);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editMinGuaranteeRupees, setEditMinGuaranteeRupees] = useState('3200');
  const [editPerKmRupees, setEditPerKmRupees] = useState('24');
  const [editMonthlyDays, setEditMonthlyDays] = useState('24');
  const [editCorridorIds, setEditCorridorIds] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<DriverContractStatus>('ACTIVE');
  const [editNote, setEditNote] = useState('');
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [resetPasswordFor, setResetPasswordFor] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('Demo@1234');
  const [showResetPassword, setShowResetPassword] = useState(false);

  const catalogQuery = useQuery({
    queryKey: ['platform-owner-catalog'],
    queryFn: fetchPlatformOwnerCatalog,
  });

  const driversQuery = useQuery({
    queryKey: ['platform-owner-drivers', statusFilter],
    queryFn: () =>
      fetchPlatformOwnerDrivers(
        (statusFilter || undefined) as DriverAccountStatus | undefined
      ),
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      registerPlatformOwnerDriver({
        name: name.trim(),
        email: email.trim(),
        phone: phone.trim(),
        password,
        licenseNumber: licenseNumber.trim() || undefined,
        homeBase: homeBase.trim() || undefined,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
        minGuaranteePaise: Math.round(Number(minGuaranteeRupees || 0) * 100),
        perKmRatePaise: Math.round(Number(perKmRupees || 0) * 100),
        guaranteedMonthlyDays: guaranteedMonthlyDays ? Number(guaranteedMonthlyDays) : undefined,
        notes: notes.trim() || undefined,
        eligibleCorridorIds: selectedCorridorIds,
        vehicle: {
          registrationNumber: vehReg.trim().toUpperCase(),
          vehicleCategory: vehCategory.trim(),
          bodyType: vehBodyType,
          maxWeightKg: Number(vehMaxWeightKg),
          bedLengthCm: Number(vehLengthCm),
          bedWidthCm: Number(vehWidthCm),
          bedHeightCm: Number(vehHeightCm),
          maxVolumeCbm: Number(vehVolumeCbm) || undefined,
          operationalStatus: vehStatus,
          rcNumber: vehRc.trim() || undefined,
          insurancePolicyNumber: vehIns.trim() || undefined,
          verificationStatus: vehVerification,
        },
      }),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        `Registered Tier 1 driver with DRIVER_OWNED vehicle ${res.driverOwnedVehicle.registrationNumber} & contract ${res.contract.contractCode}.`
      );
      setShowCreateForm(false);
      setName('');
      setEmail('');
      setPhone('');
      setPassword('Demo@1234');
      setShowCreatePassword(false);
      setLicenseNumber('');
      setHomeBase('');
      setVehReg('');
      setVehRc('');
      setVehIns('');
      setNotes('');
      setSelectedCorridorIds([]);
      void queryClient.invalidateQueries({ queryKey: ['platform-owner-drivers'] });
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to register Tier 1 driver');
    },
  });

  const vehicleMutation = useMutation({
    mutationFn: (driverProfileId: string) =>
      upsertDriverOwnedVehicle(driverProfileId, {
        registrationNumber: eVehReg.trim().toUpperCase(),
        vehicleCategory: eVehCategory.trim(),
        bodyType: eVehBodyType,
        maxWeightKg: Number(eVehMaxWeightKg),
        bedLengthCm: Number(eVehLengthCm),
        bedWidthCm: Number(eVehWidthCm),
        bedHeightCm: Number(eVehHeightCm),
        maxVolumeCbm: Number(eVehVolumeCbm) || undefined,
        operationalStatus: eVehStatus,
        rcNumber: eVehRc.trim() || undefined,
        insurancePolicyNumber: eVehIns.trim() || undefined,
        verificationStatus: eVehVerification,
      }),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        `Updated driver-owned vehicle ${res.driverOwnedVehicle.registrationNumber} (${res.driverOwnedVehicle.operationalStatus}).`
      );
      setEditingVehicleFor(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-owner-drivers'] });
    },
    onError: (err) => {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to save driver-owned vehicle'
      );
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({
      driverProfileId,
      accountStatus,
      reason,
    }: {
      driverProfileId: string;
      accountStatus: DriverAccountStatus;
      reason?: string;
    }) => updateContractDriverStatus(driverProfileId, { accountStatus, reason }),
    onSuccess: (_res, vars) => {
      setErrorBanner(null);
      setBanner(`Driver account status updated to ${vars.accountStatus}.`);
      void queryClient.invalidateQueries({ queryKey: ['platform-owner-drivers'] });
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Status update failed');
    },
  });

  const contractMutation = useMutation({
    mutationFn: (driverProfileId: string) =>
      saveDriverContract(driverProfileId, {
        contractId: editContractId,
        startDate: new Date(editStartDate).toISOString(),
        endDate: new Date(editEndDate).toISOString(),
        minGuaranteePaise: Math.round(Number(editMinGuaranteeRupees || 0) * 100),
        perKmRatePaise: Math.round(Number(editPerKmRupees || 0) * 100),
        guaranteedMonthlyDays: editMonthlyDays ? Number(editMonthlyDays) : undefined,
        eligibleCorridorIds: editCorridorIds,
        status: editStatus,
        changeNote: editNote.trim() || undefined,
      }),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(`Saved contract ${res.contract.contractCode} (${res.contract.status}).`);
      setEditingDriverId(null);
      void queryClient.invalidateQueries({ queryKey: ['platform-owner-drivers'] });
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Contract update failed');
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: ({
      driverProfileId,
      newPassword,
    }: {
      driverProfileId: string;
      newPassword: string;
    }) => resetContractDriverPassword(driverProfileId, newPassword),
    onSuccess: () => {
      setErrorBanner(null);
      setBanner('Driver login password updated cleanly. The driver can now sign in at /login.');
      setResetPasswordFor(null);
      setResetPasswordValue('Demo@1234');
      setShowResetPassword(false);
    },
    onError: (err) => {
      setErrorBanner(err instanceof Error ? err.message : 'Unable to reset driver password');
    },
  });

  const openVehicleEditor = (item: ManagedContractDriver) => {
    const v = item.driverOwnedVehicle;
    setEditingVehicleFor(item.driverProfile._id);
    setEVehReg(v?.registrationNumber ?? '');
    setEVehCategory(v?.vehicleClass ?? '14ft Closed Body LCV');
    setEVehBodyType(v?.bodyType ?? 'CLOSED_BODY');
    setEVehMaxWeightKg(String(v?.maxWeightKg ?? 2500));
    setEVehLengthCm(String(v?.bedDimensionsCm?.length ?? 425));
    setEVehWidthCm(String(v?.bedDimensionsCm?.width ?? 195));
    setEVehHeightCm(String(v?.bedDimensionsCm?.height ?? 150));
    setEVehVolumeCbm(String(v?.maxVolumeCbm ?? 12.5));
    setEVehStatus(v?.operationalStatus ?? 'ACTIVE');
    setEVehRc(v?.documents?.rcNumber ?? '');
    setEVehIns(v?.documents?.insurancePolicyNumber ?? '');
    setEVehVerification(v?.documents?.verificationStatus ?? 'PENDING');
  };

  const openContractEditor = (
    item: ManagedContractDriver,
    contract: DriverContractRecord | null
  ) => {
    setEditingDriverId(item.driverProfile._id);
    setEditContractId(contract?._id);
    setEditStartDate(toDateInputValue(contract?.startDate, 0));
    setEditEndDate(toDateInputValue(contract?.endDate, 365));
    setEditMinGuaranteeRupees(
      contract
        ? String(Math.round(contract.minimumGuaranteeTerms.minGuaranteePaise / 100))
        : '3200'
    );
    setEditPerKmRupees(
      contract
        ? String(Math.round(contract.minimumGuaranteeTerms.perKmRatePaise / 100))
        : '24'
    );
    setEditMonthlyDays(
      contract?.minimumGuaranteeTerms.guaranteedMonthlyDays
        ? String(contract.minimumGuaranteeTerms.guaranteedMonthlyDays)
        : '24'
    );
    setEditCorridorIds(contract?.eligibleCorridorIds.map((c) => c._id) ?? []);
    setEditStatus(contract?.status ?? 'ACTIVE');
    setEditNote('');
  };

  if (driversQuery.isLoading) {
    return <LoadingState title="Loading Tier 1 contract drivers..." />;
  }

  if (driversQuery.isError) {
    return (
      <ErrorState
        description="Unable to load Tier 1 contract drivers."
        onRetry={() => void driversQuery.refetch()}
      />
    );
  }

  const drivers = driversQuery.data?.drivers ?? [];
  const corridors = catalogQuery.data?.corridors ?? [];

  const toggleItem = (list: string[], id: string, setter: (next: string[]) => void) => {
    setter(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Tier 1 Contract Drivers &amp; Driver-Owned Vehicles
          </h1>
          <p className="text-sm text-slate-500">
            Single Platform Owner console: MeeCargo owns zero vehicles. Register Tier 1
            contract drivers with their own vehicle specs and assign eligible corridors
            (schedules inherited centrally).
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link to="/owner/corridors">
            <Button variant="outline" size="sm">
              <CalendarClock className="h-4 w-4" />
              Configure Corridor Schedules
            </Button>
          </Link>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium"
          >
            <option value="">All Statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
          </select>
          <Button
            variant="primary"
            size="sm"
            onClick={() => setShowCreateForm((v) => !v)}
          >
            <Plus className="h-4 w-4" />
            Register Tier 1 Driver
          </Button>
        </div>
      </div>

      {banner ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {banner}
        </div>
      ) : null}

      {errorBanner ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {errorBanner}
        </div>
      ) : null}

      {showCreateForm ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Register Tier 1 Driver &amp; Driver-Owned Vehicle
              </h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Full Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Vikram Chauhan"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Email</label>
                <input
                  type="email"
                  name="tier1-driver-email"
                  autoComplete="off"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="driver.t1@meecargo.demo"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+919800000299"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Initial Login Password
                </label>
                <div className="relative">
                  <input
                    type={showCreatePassword ? 'text' : 'password'}
                    name="tier1-driver-password"
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters"
                    className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-9 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCreatePassword((v) => !v)}
                    aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2 top-2 rounded p-1 text-slate-500 hover:text-slate-800"
                  >
                    {showCreatePassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Default: <code>Demo@1234</code> — share with the driver for <code>/login</code>.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  License Number
                </label>
                <input
                  value={licenseNumber}
                  onChange={(e) => setLicenseNumber(e.target.value)}
                  placeholder="GJ06-2021-0091122"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">Home Base</label>
                <input
                  value={homeBase}
                  onChange={(e) => setHomeBase(e.target.value)}
                  placeholder="Vadodara Makarpura Hub"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            {/* Driver-Owned Vehicle Specifications */}
            <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                  <Truck className="h-4 w-4 text-emerald-700" />
                  Driver-Owned Vehicle Specifications (DRIVER_OWNED)
                </span>
                <Badge variant="info">DRIVER_OWNED</Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Registration Number
                  </label>
                  <input
                    value={vehReg}
                    onChange={(e) => setVehReg(e.target.value)}
                    placeholder="GJ-06-TV-4001"
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Vehicle Category
                  </label>
                  <input
                    value={vehCategory}
                    onChange={(e) => setVehCategory(e.target.value)}
                    placeholder="14ft LCV"
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Body Type
                  </label>
                  <select
                    value={vehBodyType}
                    onChange={(e) => setVehBodyType(e.target.value as VehicleBodyType)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="CLOSED_BODY">Closed Body</option>
                    <option value="OPEN_BODY">Open Body</option>
                    <option value="CONTAINER">Container</option>
                    <option value="FLATBED">Flatbed</option>
                    <option value="MINI_PICKUP">Mini Pickup</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Max Payload (kg)
                  </label>
                  <input
                    type="number"
                    value={vehMaxWeightKg}
                    onChange={(e) => setVehMaxWeightKg(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Bed Length (cm)
                  </label>
                  <input
                    type="number"
                    value={vehLengthCm}
                    onChange={(e) => setVehLengthCm(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Bed Width (cm)
                  </label>
                  <input
                    type="number"
                    value={vehWidthCm}
                    onChange={(e) => setVehWidthCm(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Bed Height (cm)
                  </label>
                  <input
                    type="number"
                    value={vehHeightCm}
                    onChange={(e) => setVehHeightCm(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Approx Volume (m³)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={vehVolumeCbm}
                    onChange={(e) => setVehVolumeCbm(e.target.value)}
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    RC Number
                  </label>
                  <input
                    value={vehRc}
                    onChange={(e) => setVehRc(e.target.value)}
                    placeholder="GJ06TV4001"
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Insurance Policy #
                  </label>
                  <input
                    value={vehIns}
                    onChange={(e) => setVehIns(e.target.value)}
                    placeholder="INS-2026-8891"
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs uppercase"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Document Verification
                  </label>
                  <select
                    value={vehVerification}
                    onChange={(e) =>
                      setVehVerification(
                        e.target.value as 'PENDING' | 'VERIFIED' | 'REJECTED'
                      )
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="VERIFIED">Verified</option>
                    <option value="PENDING">Pending</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-slate-600">
                    Operational Status
                  </label>
                  <select
                    value={vehStatus}
                    onChange={(e) =>
                      setVehStatus(e.target.value as VehicleOperationalStatus)
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-xs"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="MAINTENANCE">Maintenance</option>
                    <option value="INACTIVE">Inactive</option>
                    <option value="SUSPENDED">Suspended</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Contract & Eligible Corridors */}
            <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-5">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Contract Start
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Contract End
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Min Guarantee (₹)
                </label>
                <input
                  type="number"
                  value={minGuaranteeRupees}
                  onChange={(e) => setMinGuaranteeRupees(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Per-Km Rate (₹)
                </label>
                <input
                  type="number"
                  value={perKmRupees}
                  onChange={(e) => setPerKmRupees(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Min Days / Month
                </label>
                <input
                  type="number"
                  value={guaranteedMonthlyDays}
                  onChange={(e) => setGuaranteedMonthlyDays(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                Eligible Corridors (schedules derived centrally from Corridor Setup)
              </label>
              <div className="flex flex-wrap gap-2">
                {corridors.map((c) => (
                  <button
                    key={c._id}
                    type="button"
                    onClick={() =>
                      toggleItem(selectedCorridorIds, c._id, setSelectedCorridorIds)
                    }
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
                      selectedCorridorIds.includes(c._id)
                        ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                        : 'border-slate-300 bg-white text-slate-600'
                    }`}
                  >
                    {c.code} — {c.name}
                  </button>
                ))}
              </div>
            </div>

            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Contract SLA notes..."
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            />

            <div className="flex gap-2">
              <Button
                variant="primary"
                disabled={registerMutation.isPending || !name || !email || !phone || !vehReg}
                onClick={() => registerMutation.mutate()}
              >
                {registerMutation.isPending
                  ? 'Registering...'
                  : 'Create Driver, Vehicle & Contract'}
              </Button>
              <Button variant="ghost" onClick={() => setShowCreateForm(false)}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {drivers.length === 0 ? (
        <EmptyState
          title="No Tier 1 contract drivers registered"
          description="Register a Tier 1 contract driver above along with their driver-owned vehicle specifications and eligible corridors."
        />
      ) : (
        <div className="space-y-4">
          {drivers.map((item) => {
            const profile = item.driverProfile;
            const vehicle = item.driverOwnedVehicle;
            const contract = item.activeContract;
            const isEditingContract = editingDriverId === profile._id;
            const isEditingVehicle = editingVehicleFor === profile._id;
            const showHistory = historyOpenFor === profile._id;

            return (
              <Card key={profile._id}>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-base font-bold text-slate-900">{profile.name}</span>
                      <Badge variant="info">{profile.fleetTier}</Badge>
                      <Badge variant={statusBadgeVariant(profile.accountStatus)}>
                        {profile.accountStatus}
                      </Badge>
                      <Badge variant="neutral">Availability: {profile.availabilityStatus}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {profile.userId?.email ?? '—'} • {profile.phone}
                      {profile.licenseNumber ? ` • License: ${profile.licenseNumber}` : ''}
                      {profile.homeBase ? ` • Base: ${profile.homeBase}` : ''}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setResetPasswordFor(
                          resetPasswordFor === profile._id ? null : profile._id
                        );
                        setResetPasswordValue('Demo@1234');
                        setShowResetPassword(false);
                      }}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Reset Password
                    </Button>
                    {profile.accountStatus !== 'ACTIVE' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({
                            driverProfileId: profile._id,
                            accountStatus: 'ACTIVE',
                          })
                        }
                      >
                        <UserCheck className="h-3.5 w-3.5" />
                        Activate
                      </Button>
                    ) : null}
                    {profile.accountStatus !== 'INACTIVE' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({
                            driverProfileId: profile._id,
                            accountStatus: 'INACTIVE',
                            reason: 'Deactivated by Platform Owner',
                          })
                        }
                      >
                        <PauseCircle className="h-3.5 w-3.5" />
                        Deactivate
                      </Button>
                    ) : null}
                    {profile.accountStatus !== 'SUSPENDED' ? (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={statusMutation.isPending}
                        onClick={() =>
                          statusMutation.mutate({
                            driverProfileId: profile._id,
                            accountStatus: 'SUSPENDED',
                            reason: 'Suspended by Platform Owner',
                          })
                        }
                      >
                        <Ban className="h-3.5 w-3.5" />
                        Suspend
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {resetPasswordFor === profile._id ? (
                    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-xs">
                      <div className="min-w-[220px] flex-1">
                        <label className="mb-1 block font-semibold text-slate-800">
                          New Login Password for {profile.userId?.email ?? profile.name}
                        </label>
                        <div className="relative">
                          <input
                            type={showResetPassword ? 'text' : 'password'}
                            name="reset-driver-password"
                            autoComplete="new-password"
                            value={resetPasswordValue}
                            onChange={(e) => setResetPasswordValue(e.target.value)}
                            placeholder="Minimum 8 characters"
                            className="w-full rounded-lg border border-amber-300 bg-white py-1.5 pl-3 pr-9 text-sm"
                          />
                          <button
                            type="button"
                            onClick={() => setShowResetPassword((v) => !v)}
                            aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                            className="absolute right-2 top-1.5 rounded p-1 text-slate-500 hover:text-slate-800"
                          >
                            {showResetPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                          </button>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        disabled={resetPasswordMutation.isPending}
                        onClick={() =>
                          resetPasswordMutation.mutate({
                            driverProfileId: profile._id,
                            newPassword: resetPasswordValue,
                          })
                        }
                      >
                        Save New Password
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setResetPasswordFor(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}

                  {/* Driver-Owned Vehicle Details */}
                  <div className="rounded-xl border border-sky-200 bg-sky-50/50 p-3.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                        <Truck className="h-4 w-4 text-sky-700" />
                        <span>Driver-Owned Vehicle</span>
                        {vehicle ? (
                          <>
                            <Badge variant="info">{vehicle.ownershipType}</Badge>
                            <Badge variant={statusBadgeVariant(vehicle.operationalStatus)}>
                              {vehicle.operationalStatus}
                            </Badge>
                            {vehicle.documents?.verificationStatus ? (
                              <Badge
                                variant={statusBadgeVariant(
                                  vehicle.documents.verificationStatus
                                )}
                              >
                                Docs: {vehicle.documents.verificationStatus}
                              </Badge>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          isEditingVehicle
                            ? setEditingVehicleFor(null)
                            : openVehicleEditor(item)
                        }
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        {vehicle ? 'Edit Driver-Owned Vehicle' : 'Register Driver-Owned Vehicle'}
                      </Button>
                    </div>

                    {vehicle ? (
                      <div className="mt-3 grid gap-3 sm:grid-cols-4">
                        <div>
                          <span className="text-slate-500">Registration &amp; Category</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {vehicle.registrationNumber} • {vehicle.vehicleClass}
                          </p>
                          <p className="text-[11px] text-slate-500">Body: {vehicle.bodyType}</p>
                        </div>
                        <div>
                          <span className="text-slate-500">Payload &amp; Cargo Volume</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {vehicle.maxWeightKg} kg • {vehicle.maxVolumeCbm} m³
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Cargo Dimensions (L×W×H)</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {vehicle.bedDimensionsCm.length} × {vehicle.bedDimensionsCm.width} ×{' '}
                            {vehicle.bedDimensionsCm.height} cm
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Documents &amp; Verification</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            RC: {vehicle.documents?.rcNumber || '—'}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Ins: {vehicle.documents?.insurancePolicyNumber || '—'}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <p className="mt-2 text-amber-800">
                        No driver-owned vehicle registered yet for this Tier 1 driver.
                      </p>
                    )}

                    {isEditingVehicle ? (
                      <div className="mt-3 space-y-2.5 border-t border-sky-200 pt-3">
                        <div className="grid gap-2 sm:grid-cols-4">
                          <input
                            value={eVehReg}
                            onChange={(e) => setEVehReg(e.target.value)}
                            placeholder="Reg # (e.g. GJ-06-MC-1001)"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5 uppercase"
                          />
                          <input
                            value={eVehCategory}
                            onChange={(e) => setEVehCategory(e.target.value)}
                            placeholder="Category (e.g. 14ft LCV)"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                          <select
                            value={eVehBodyType}
                            onChange={(e) =>
                              setEVehBodyType(e.target.value as VehicleBodyType)
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          >
                            <option value="CLOSED_BODY">Closed Body</option>
                            <option value="OPEN_BODY">Open Body</option>
                            <option value="CONTAINER">Container</option>
                            <option value="FLATBED">Flatbed</option>
                            <option value="MINI_PICKUP">Mini Pickup</option>
                          </select>
                          <select
                            value={eVehStatus}
                            onChange={(e) =>
                              setEVehStatus(e.target.value as VehicleOperationalStatus)
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          >
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="MAINTENANCE">MAINTENANCE</option>
                            <option value="INACTIVE">INACTIVE</option>
                            <option value="SUSPENDED">SUSPENDED</option>
                          </select>
                          <input
                            type="number"
                            value={eVehMaxWeightKg}
                            onChange={(e) => setEVehMaxWeightKg(e.target.value)}
                            placeholder="Payload (kg)"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                          <input
                            type="number"
                            value={eVehLengthCm}
                            onChange={(e) => setEVehLengthCm(e.target.value)}
                            placeholder="Length (cm)"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                          <input
                            type="number"
                            value={eVehWidthCm}
                            onChange={(e) => setEVehWidthCm(e.target.value)}
                            placeholder="Width (cm)"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                          <input
                            type="number"
                            value={eVehHeightCm}
                            onChange={(e) => setEVehHeightCm(e.target.value)}
                            placeholder="Height (cm)"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                          <input
                            type="number"
                            step="0.1"
                            value={eVehVolumeCbm}
                            onChange={(e) => setEVehVolumeCbm(e.target.value)}
                            placeholder="Approx m³"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                          <input
                            value={eVehRc}
                            onChange={(e) => setEVehRc(e.target.value)}
                            placeholder="RC Number"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5 uppercase"
                          />
                          <input
                            value={eVehIns}
                            onChange={(e) => setEVehIns(e.target.value)}
                            placeholder="Insurance Policy #"
                            className="rounded border border-slate-300 bg-white px-2 py-1.5 uppercase"
                          />
                          <select
                            value={eVehVerification}
                            onChange={(e) =>
                              setEVehVerification(
                                e.target.value as 'PENDING' | 'VERIFIED' | 'REJECTED'
                              )
                            }
                            className="rounded border border-slate-300 bg-white px-2 py-1.5"
                          >
                            <option value="VERIFIED">Docs: VERIFIED</option>
                            <option value="PENDING">Docs: PENDING</option>
                            <option value="REJECTED">Docs: REJECTED</option>
                          </select>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={vehicleMutation.isPending || !eVehReg.trim()}
                            onClick={() => vehicleMutation.mutate(profile._id)}
                          >
                            Save Driver-Owned Vehicle
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setEditingVehicleFor(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {/* Contract & Inherited Corridor Schedules */}
                  {contract ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 font-semibold text-slate-900">
                          <FileText className="h-4 w-4 text-emerald-700" />
                          <span>Contract {contract.contractCode}</span>
                          <Badge variant={statusBadgeVariant(contract.status)}>
                            {contract.status}
                          </Badge>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openContractEditor(item, contract)}
                          >
                            Edit Contract &amp; Corridors
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setHistoryOpenFor(showHistory ? null : profile._id)
                            }
                          >
                            <History className="h-3.5 w-3.5" />
                            History ({contract.history.length})
                          </Button>
                        </div>
                      </div>

                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div>
                          <span className="flex items-center gap-1 text-slate-500">
                            <Calendar className="h-3 w-3" /> Contract Term
                          </span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {new Date(contract.startDate).toLocaleDateString()} →{' '}
                            {new Date(contract.endDate).toLocaleDateString()}
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Minimum Guarantee</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {formatPaise(contract.minimumGuaranteeTerms.minGuaranteePaise)} +{' '}
                            {formatPaise(contract.minimumGuaranteeTerms.perKmRatePaise)}/km
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-500">Eligible Corridors Assigned</span>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {contract.eligibleCorridorIds.length} corridor(s)
                          </p>
                        </div>
                      </div>

                      {/* Eligible Corridors inheriting Central Schedules */}
                      {contract.eligibleCorridorIds.length > 0 ? (
                        <div className="mt-3 space-y-2 border-t border-slate-200 pt-2.5">
                          <p className="flex items-center gap-1 font-semibold text-slate-700">
                            <RouteIcon className="h-3.5 w-3.5 text-emerald-700" />
                            Eligible Corridors &amp; Inherited Operating Templates
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Contracts cover corridor eligibility only; drivers choose open pooling
                            slots dynamically before cutoff (no permanent fixed slot assignments).
                          </p>
                          {contract.eligibleCorridorIds.map((cor) => (
                            <div
                              key={cor._id}
                              className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-2.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-slate-900">
                                  {cor.code} — {cor.name}
                                </span>
                                <span className="text-[11px] text-slate-500">
                                  Route:{' '}
                                  {(cor.stops ?? [])
                                    .slice()
                                    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                                    .map((st) => st.stopCode)
                                    .join(' → ')}
                                </span>
                              </div>
                              <div className="grid gap-2 sm:grid-cols-2">
                                {(cor.slotSchedules ?? []).map((sl) => (
                                  <div
                                    key={sl.slotNumber}
                                    className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px]"
                                  >
                                    <span>
                                      <strong>Slot {sl.slotNumber}:</strong> Pickup{' '}
                                      {sl.outboundPickupTime} • Return{' '}
                                      {sl.returnTimeOptions.join(' / ')}
                                    </span>
                                    {sl.returnTimeLocked ? (
                                      <Badge variant="warning">
                                        <Lock className="mr-0.5 inline h-2.5 w-2.5" /> Locked{' '}
                                        {sl.lockedReturnTime}
                                      </Badge>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {showHistory ? (
                        <div className="mt-3 space-y-1.5 border-t border-slate-200 pt-2.5">
                          <p className="font-semibold text-slate-700">Contract Audit History</p>
                          {contract.history.map((h, idx) => (
                            <div
                              key={idx}
                              className="flex flex-wrap items-center justify-between gap-2 rounded bg-white px-2.5 py-1.5 text-[11px]"
                            >
                              <span>
                                <strong>{h.action}</strong> ({h.status}) — {h.note ?? 'Recorded'}
                              </span>
                              <span className="text-slate-400">
                                {new Date(h.at).toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                      <span>No contract terms attached yet.</span>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => openContractEditor(item, null)}
                      >
                        Issue Contract
                      </Button>
                    </div>
                  )}

                  {isEditingContract ? (
                    <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3.5 text-xs">
                      <p className="font-semibold text-emerald-950">
                        Manage Contract Terms &amp; Eligible Corridors
                      </p>
                      <div className="grid gap-2.5 sm:grid-cols-5">
                        <div>
                          <label className="mb-1 block text-slate-600">Start Date</label>
                          <input
                            type="date"
                            value={editStartDate}
                            onChange={(e) => setEditStartDate(e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-slate-600">End Date</label>
                          <input
                            type="date"
                            value={editEndDate}
                            onChange={(e) => setEditEndDate(e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-slate-600">Min Guarantee (₹)</label>
                          <input
                            type="number"
                            value={editMinGuaranteeRupees}
                            onChange={(e) => setEditMinGuaranteeRupees(e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-slate-600">Per-Km Rate (₹)</label>
                          <input
                            type="number"
                            value={editPerKmRupees}
                            onChange={(e) => setEditPerKmRupees(e.target.value)}
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-slate-600">Contract Status</label>
                          <select
                            value={editStatus}
                            onChange={(e) =>
                              setEditStatus(e.target.value as DriverContractStatus)
                            }
                            className="w-full rounded border border-slate-300 bg-white px-2 py-1.5"
                          >
                            <option value="ACTIVE">ACTIVE</option>
                            <option value="SUSPENDED">SUSPENDED</option>
                            <option value="INACTIVE">INACTIVE</option>
                            <option value="EXPIRED">EXPIRED</option>
                            <option value="TERMINATED">TERMINATED</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="mb-1 block text-slate-600">
                          Eligible Corridors (add / remove; schedules stay managed centrally)
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {corridors.map((c) => (
                            <button
                              key={c._id}
                              type="button"
                              onClick={() =>
                                toggleItem(editCorridorIds, c._id, setEditCorridorIds)
                              }
                              className={`rounded border px-2.5 py-1 text-[11px] font-medium ${
                                editCorridorIds.includes(c._id)
                                  ? 'border-emerald-600 bg-emerald-100 text-emerald-900'
                                  : 'border-slate-300 bg-white text-slate-600'
                              }`}
                            >
                              {c.code} — {c.name}
                            </button>
                          ))}
                        </div>
                      </div>

                      <input
                        value={editNote}
                        onChange={(e) => setEditNote(e.target.value)}
                        placeholder="Amendment / audit note..."
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5"
                      />

                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="primary"
                          disabled={contractMutation.isPending}
                          onClick={() => contractMutation.mutate(profile._id)}
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Save Contract Changes
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setEditingDriverId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

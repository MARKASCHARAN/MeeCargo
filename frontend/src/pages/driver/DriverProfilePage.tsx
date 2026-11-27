import { useQuery } from '@tanstack/react-query';
import { Lock, Truck, UserCheck } from 'lucide-react';
import { fetchDriverProfile } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/StateViews';
import { useAuthStore } from '../../stores/authStore';

const TIER_LABELS: Record<string, string> = {
  TIER_1: 'Tier 1 (Contract Driver)',
  TIER_2: 'Tier 2 (Marketplace)',
  TIER_3: 'Tier 3 (Backhaul)',
};

const AVAILABILITY_VARIANTS: Record<string, 'success' | 'info' | 'neutral'> = {
  AVAILABLE: 'success',
  ON_TRIP: 'info',
  OFFLINE: 'neutral',
};

export function DriverProfilePage() {
  const { user } = useAuthStore();

  const profileQuery = useQuery({
    queryKey: ['driver-profile'],
    queryFn: fetchDriverProfile,
  });

  if (profileQuery.isLoading) {
    return <LoadingState title="Loading driver profile..." />;
  }

  if (profileQuery.isError) {
    return (
      <ErrorState
        title="Could not load driver profile"
        description={profileQuery.error.message}
        onRetry={() => void profileQuery.refetch()}
      />
    );
  }

  const profile = profileQuery.data?.driverProfile ?? null;
  const registeredVehicle = profile?.vehicleId ?? null;
  const fleetTier = profile?.fleetTier ?? 'TIER_2';
  const availability = profile?.availabilityStatus ?? 'AVAILABLE';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Driver Profile</h1>
          <p className="text-xs text-slate-500">Read-only driver &amp; registered vehicle record</p>
        </div>
        <Badge variant="info">{TIER_LABELS[fleetTier] ?? fleetTier}</Badge>
      </div>

      {registeredVehicle ? (
        <Card>
          <CardHeader className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-700" />
              <span className="text-sm font-semibold text-slate-900">
                {fleetTier === 'TIER_1' ? 'Driver-Owned Vehicle' : 'Registered Vehicle'}:{' '}
                {registeredVehicle.registrationNumber}
              </span>
            </div>
            <Badge variant="success">{registeredVehicle.tier}</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">Class:</span>{' '}
              <strong className="text-slate-800">{registeredVehicle.vehicleClass}</strong>
            </div>
            <div>
              <span className="text-slate-400">Payload / Volume:</span>{' '}
              <strong className="text-slate-800">
                {registeredVehicle.maxWeightKg} kg / {registeredVehicle.maxVolumeCbm} m³
              </strong>
            </div>
            <div className="col-span-2">
              <span className="text-slate-400">Bed Dimensions (L×W×H cm):</span>{' '}
              <strong className="text-slate-800">
                {registeredVehicle.bedDimensionsCm.length} ×{' '}
                {registeredVehicle.bedDimensionsCm.width} ×{' '}
                {registeredVehicle.bedDimensionsCm.height}
              </strong>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between border-b border-slate-100 py-3">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-slate-700" />
            <h2 className="text-sm font-semibold text-slate-900">Driver Details</h2>
          </div>
          <Badge variant="neutral">
            <Lock className="mr-1 inline h-3 w-3" />
            Read-Only
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4 pt-4 text-xs">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">Driver Name</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">
                {profile?.name ?? user?.name ?? '—'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">Email</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">
                {user?.email ?? '—'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">Phone</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">
                {profile?.phone ?? user?.phone ?? '—'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">Availability Status</p>
              <div className="mt-1">
                <Badge variant={AVAILABILITY_VARIANTS[availability] ?? 'neutral'}>
                  {availability}
                </Badge>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">Fleet Tier</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">
                {TIER_LABELS[fleetTier] ?? fleetTier}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2">
              <p className="text-[11px] font-medium text-slate-500">License Number</p>
              <p className="mt-0.5 font-mono text-sm font-semibold uppercase text-slate-900">
                {profile?.licenseNumber || '—'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 sm:col-span-2">
              <p className="text-[11px] font-medium text-slate-500">Home Base Hub</p>
              <p className="mt-0.5 text-sm font-semibold text-slate-900">
                {profile?.homeBase || '—'}
              </p>
            </div>
          </div>

          <p className="rounded-lg border border-slate-200 bg-slate-100/80 px-3 py-2 text-[11px] text-slate-600">
            Driver profile details are read-only here. Contact the Platform Owner if your registration,
            license, or vehicle specifications need an administrative update.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

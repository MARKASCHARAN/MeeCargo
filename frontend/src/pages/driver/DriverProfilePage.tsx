import { useQuery } from '@tanstack/react-query';
import { Lock, MapPin, ShieldCheck, Truck, UserCheck } from 'lucide-react';
import { fetchDriverProfile } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useAuthStore } from '@/stores/authStore';

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
    <div className="space-y-6">
      {/* Editorial Orbit Header */}
      <section className="orbit-reveal-1 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_18px_55px_-28px_rgba(24,60,115,0.22)] sm:p-7">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#7a94df]">
            Verified Fleet Record
          </p>
          <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-[#080e2b] sm:text-[36px]">
            Driver{' '}
            <em
              className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
              style={{ fontStyle: 'italic' }}
            >
              profile.
            </em>
          </h1>
          <p className="mt-1 text-xs text-[#5c6b94] sm:text-sm">
            Read-only driver identity and registered commercial vehicle specifications.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {fleetTier === 'TIER_2' && profile?.tier2ApplicationStatus ? (
            <Badge
              variant={
                profile.tier2ApplicationStatus === 'APPROVED'
                  ? 'success'
                  : profile.tier2ApplicationStatus === 'REJECTED'
                    ? 'danger'
                    : 'warning'
              }
            >
              Application: {profile.tier2ApplicationStatus}
            </Badge>
          ) : null}
          <span className="rounded-full border border-[#cddbfa] bg-[#eef3ff] px-3.5 py-1 text-xs font-semibold text-[#3563e4]">
            {TIER_LABELS[fleetTier] ?? fleetTier}
          </span>
        </div>
      </section>

      {/* Responsive Desktop Two-Column Split */}
      <div className="orbit-reveal-2 grid gap-6 lg:grid-cols-12">
        {/* Registered Vehicle Card */}
        {registeredVehicle ? (
          <div className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.2)] lg:col-span-5">
            <div className="flex items-center justify-between border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4673eb] text-white">
                  <Truck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                    {fleetTier === 'TIER_1' ? 'Driver-Owned Vehicle' : 'Registered Vehicle'}
                  </p>
                  <p className="font-mono text-sm font-bold text-[#080e2b]">
                    {registeredVehicle.registrationNumber}
                  </p>
                </div>
              </div>
              <Badge variant="success">{registeredVehicle.tier}</Badge>
            </div>

            <div className="space-y-3 p-6 text-xs">
              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3.5">
                <p className="text-[11px] text-[#7a87aa]">Vehicle Class</p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {registeredVehicle.vehicleClass}
                </p>
              </div>
              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3.5">
                <p className="text-[11px] text-[#7a87aa]">Max Payload / Volume</p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {registeredVehicle.maxWeightKg} kg / {registeredVehicle.maxVolumeCbm} m³
                </p>
              </div>
              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3.5">
                <p className="text-[11px] text-[#7a87aa]">Bed Dimensions (L × W × H cm)</p>
                <p className="mt-0.5 font-mono text-sm font-semibold text-[#080e2b]">
                  {registeredVehicle.bedDimensionsCm.length} ×{' '}
                  {registeredVehicle.bedDimensionsCm.width} ×{' '}
                  {registeredVehicle.bedDimensionsCm.height} cm
                </p>
              </div>
            </div>
          </div>
        ) : null}

        {/* Driver Details Card */}
        <div
          className={`overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.2)] ${
            registeredVehicle ? 'lg:col-span-7' : 'lg:col-span-12'
          }`}
        >
          <div className="flex items-center justify-between border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                <UserCheck className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-[#080e2b]">Driver Details</h2>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-[#d6e0f8] bg-white px-3 py-1 text-[11px] font-medium text-[#5c6b94]">
              <Lock className="h-3 w-3" />
              Read-Only
            </span>
          </div>

          <div className="space-y-4 p-6 text-xs">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3">
                <p className="text-[11px] font-medium text-[#7a87aa]">Driver Name</p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {profile?.name ?? user?.name ?? '—'}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3">
                <p className="text-[11px] font-medium text-[#7a87aa]">Email</p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {user?.email ?? '—'}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3">
                <p className="text-[11px] font-medium text-[#7a87aa]">Phone</p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {profile?.phone ?? user?.phone ?? '—'}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3">
                <p className="text-[11px] font-medium text-[#7a87aa]">Availability Status</p>
                <div className="mt-1">
                  <Badge variant={AVAILABILITY_VARIANTS[availability] ?? 'neutral'}>
                    {availability}
                  </Badge>
                </div>
              </div>

              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3">
                <p className="text-[11px] font-medium text-[#7a87aa]">Fleet Tier</p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {TIER_LABELS[fleetTier] ?? fleetTier}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3">
                <p className="text-[11px] font-medium text-[#7a87aa]">License Number</p>
                <p className="mt-0.5 font-mono text-sm font-semibold uppercase text-[#080e2b]">
                  {profile?.licenseNumber || '—'}
                </p>
              </div>

              <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3 sm:col-span-2">
                <p className="flex items-center gap-1 text-[11px] font-medium text-[#7a87aa]">
                  <MapPin className="h-3 w-3 text-[#4673eb]" />
                  Home Base Hub
                </p>
                <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                  {profile?.homeBase || '—'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-2 rounded-2xl border border-[#cddbfa] bg-[#eef3ff]/65 px-4 py-3 text-[11px] text-[#4d5a83]">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#4673eb]" />
              <span>
                Driver profile details are read-only here. Contact the Platform Owner if your
                registration, license, or vehicle specifications need an administrative update.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

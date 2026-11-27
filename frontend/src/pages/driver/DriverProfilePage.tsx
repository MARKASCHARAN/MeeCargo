import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Truck } from 'lucide-react';
import { z } from 'zod';
import { fetchDriverProfile, upsertDriverProfile } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/StateViews';
import { useAuthStore } from '../../stores/authStore';

const driverSchema = z.object({
  name: z.string().trim().min(2, 'Name is required'),
  phone: z.string().trim().min(8, 'Phone number is required'),
  availabilityStatus: z.enum(['AVAILABLE', 'ON_TRIP', 'OFFLINE']),
  fleetTier: z.enum(['TIER_1', 'TIER_2', 'TIER_3']),
  licenseNumber: z.string().trim().optional(),
  homeBase: z.string().trim().optional(),
});

type DriverFormValues = z.infer<typeof driverSchema>;

export function DriverProfilePage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const [savedNotice, setSavedNotice] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['driver-profile'],
    queryFn: fetchDriverProfile,
  });

  const profile = profileQuery.data?.driverProfile ?? null;

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DriverFormValues>({
    resolver: zodResolver(driverSchema),
    defaultValues: {
      name: user?.name ?? '',
      phone: user?.phone ?? '',
      availabilityStatus: 'AVAILABLE',
      fleetTier: 'TIER_1',
      licenseNumber: '',
      homeBase: '',
    },
  });

  useEffect(() => {
    if (profile) {
      reset({
        name: profile.name,
        phone: profile.phone,
        availabilityStatus: profile.availabilityStatus,
        fleetTier: profile.fleetTier,
        licenseNumber: profile.licenseNumber ?? '',
        homeBase: profile.homeBase ?? '',
      });
    }
  }, [profile, reset]);

  const mutation = useMutation({
    mutationFn: upsertDriverProfile,
    onSuccess: (res) => {
      queryClient.setQueryData(['driver-profile'], res);
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    },
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

  const assignedVehicle = profile?.vehicleId;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Driver Profile</h1>
          <p className="text-xs text-slate-500">Availability & Fleet Tier details</p>
        </div>
        <Badge variant="info">{profile?.fleetTier ?? 'TIER_2'}</Badge>
      </div>

      {savedNotice ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Driver profile updated.
        </div>
      ) : null}

      {assignedVehicle ? (
        <Card>
          <CardHeader className="flex items-center justify-between py-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-700" />
              <span className="text-sm font-semibold text-slate-900">
                Assigned Vehicle: {assignedVehicle.registrationNumber}
              </span>
            </div>
            <Badge variant="success">{assignedVehicle.tier}</Badge>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2 text-xs text-slate-600">
            <div>
              <span className="text-slate-400">Class:</span>{' '}
              <strong className="text-slate-800">{assignedVehicle.vehicleClass}</strong>
            </div>
            <div>
              <span className="text-slate-400">Payload:</span>{' '}
              <strong className="text-slate-800">
                {assignedVehicle.maxWeightKg} kg / {assignedVehicle.maxVolumeCbm} m³
              </strong>
            </div>
            <div className="col-span-2">
              <span className="text-slate-400">Bed (L×W×H cm):</span>{' '}
              <strong className="text-slate-800">
                {assignedVehicle.bedDimensionsCm.length} ×{' '}
                {assignedVehicle.bedDimensionsCm.width} ×{' '}
                {assignedVehicle.bedDimensionsCm.height}
              </strong>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent>
          <form
            onSubmit={handleSubmit((vals) => mutation.mutate(vals))}
            className="space-y-3"
          >
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Driver Name *
              </label>
              <input
                {...register('name')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.name ? (
                <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Phone *
              </label>
              <input
                {...register('phone')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.phone ? (
                <p className="mt-1 text-xs text-rose-600">{errors.phone.message}</p>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Availability
                </label>
                <select
                  {...register('availabilityStatus')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="AVAILABLE">Available</option>
                  <option value="ON_TRIP">On Trip</option>
                  <option value="OFFLINE">Offline</option>
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Fleet Tier
                </label>
                <select
                  {...register('fleetTier')}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="TIER_1">Tier 1 (Attached)</option>
                  <option value="TIER_2">Tier 2 (Marketplace)</option>
                  <option value="TIER_3">Tier 3 (Backhaul)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                License Number
              </label>
              <input
                {...register('licenseNumber')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Home Base Hub
              </label>
              <input
                {...register('homeBase')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={mutation.isPending}
            >
              {mutation.isPending ? 'Saving...' : 'Save Driver Profile'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  MapPin,
  Truck,
  X,
} from 'lucide-react';
import {
  fetchDriverNotifications,
  fetchDriverProfile,
  fetchDriverTrips,
  markDriverNotificationRead,
  respondToDriverTrip,
  updateDriverAvailability,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { useAuthStore } from '../../stores/authStore';
import type { DriverAvailability } from '../../types/api';

export function DriverTripsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [declineTripId, setDeclineTripId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['driver-profile'],
    queryFn: fetchDriverProfile,
  });

  const tripsQuery = useQuery({
    queryKey: ['driver-trips'],
    queryFn: fetchDriverTrips,
  });

  const notificationsQuery = useQuery({
    queryKey: ['driver-notifications'],
    queryFn: fetchDriverNotifications,
  });

  useEffect(() => {
    if (!user?.id) return;
    const apiOrigin = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(apiOrigin, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => {
      socket.emit('join:driver', user.id);
    });
    socket.on('driver:assignment', (payload: { message?: string }) => {
      if (payload?.message) {
        setActionBanner(payload.message);
      }
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-notifications'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [user?.id, queryClient]);

  const availabilityMutation = useMutation({
    mutationFn: (status: DriverAvailability) => updateDriverAvailability(status),
    onSuccess: (res) => {
      queryClient.setQueryData(['driver-profile'], res);
    },
  });

  const respondMutation = useMutation({
    mutationFn: ({
      tripId,
      decision,
      reason,
    }: {
      tripId: string;
      decision: 'ACCEPT' | 'REJECT';
      reason?: string;
    }) => respondToDriverTrip(tripId, { decision, reason }),
    onSuccess: (res) => {
      setErrorBanner(null);
      setActionBanner(res.message);
      setDeclineTripId(null);
      setDeclineReason('');
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-notifications'] });
    },
    onError: (err: Error) => {
      setErrorBanner(err.message);
    },
  });

  const markReadMutation = useMutation({
    mutationFn: markDriverNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-notifications'] });
    },
  });

  const availability =
    profileQuery.data?.driverProfile?.availabilityStatus ?? 'AVAILABLE';
  const unreadNotifications = (notificationsQuery.data?.notifications ?? []).filter(
    (n) => !n.readAt
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Assigned Trips</h1>
          <p className="text-xs text-slate-500">
            Showing only trips assigned to your driver account
          </p>
        </div>

        <select
          aria-label="Driver availability"
          value={availability}
          disabled={availabilityMutation.isPending || !profileQuery.data?.driverProfile}
          onChange={(e) =>
            availabilityMutation.mutate(e.target.value as DriverAvailability)
          }
          className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800"
        >
          <option value="AVAILABLE">Available</option>
          <option value="ON_TRIP">On Trip</option>
          <option value="OFFLINE">Offline</option>
        </select>
      </div>

      {actionBanner ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{actionBanner}</span>
        </div>
      ) : null}

      {errorBanner ? (
        <div className="flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      ) : null}

      {unreadNotifications.length > 0 ? (
        <div className="space-y-2">
          {unreadNotifications.map((notif) => (
            <div
              key={notif._id}
              className="flex items-start justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950"
            >
              <div className="flex items-start gap-2">
                <Bell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-700" />
                <div>
                  <p className="font-semibold">{notif.title}</p>
                  <p>{notif.message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => markReadMutation.mutate(notif._id)}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-sky-800 hover:bg-sky-100"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {tripsQuery.isLoading ? (
        <LoadingState title="Loading assigned trips..." />
      ) : tripsQuery.isError ? (
        <ErrorState
          title="Could not load trips"
          description={tripsQuery.error.message}
          onRetry={() => void tripsQuery.refetch()}
        />
      ) : tripsQuery.data?.trips.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="No active trip assignments"
          description="You will see corridor trips here as soon as a locked pool is assigned to your vehicle."
        />
      ) : (
        <div className="space-y-3">
          {tripsQuery.data?.trips.map((trip) => (
            <Card key={trip._id}>
              <CardHeader className="flex items-center justify-between py-3">
                <div>
                  <p className="text-xs font-mono font-semibold text-emerald-700">
                    {trip.tripCode}
                  </p>
                  <p className="text-sm font-semibold text-slate-900">
                    {trip.corridorId?.name ?? 'Corridor Assignment'}
                  </p>
                </div>
                <Badge
                  variant={
                    trip.status === 'DRIVER_ACCEPTED' || trip.status === 'IN_PROGRESS'
                      ? 'success'
                      : 'info'
                  }
                >
                  {trip.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-slate-600">
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-slate-400" />
                  <span>
                    Planned Departure:{' '}
                    <strong className="text-slate-800">
                      {new Date(trip.plannedDepartureAt).toLocaleString()}
                    </strong>
                  </span>
                </div>

                {trip.vehicleId ? (
                  <div className="flex items-center gap-2">
                    <Truck className="h-4 w-4 text-slate-400" />
                    <span>
                      Vehicle: <strong>{trip.vehicleId.registrationNumber}</strong> (
                      {trip.vehicleId.vehicleClass} • {trip.vehicleId.tier})
                    </span>
                  </div>
                ) : null}

                {trip.allocationEconomics ? (
                  <div className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
                    Allocation: <strong>{trip.allocationEconomics.allocatedTier}</strong>
                    {trip.allocationEconomics.rightSized ? ' (Right-sized)' : ''} •{' '}
                    {trip.allocationEconomics.reason}
                  </div>
                ) : null}

                {trip.stopsSummary?.length > 0 ? (
                  <div className="flex items-start gap-2 pt-1">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="flex flex-wrap gap-1.5">
                      {trip.stopsSummary.map((stop) => (
                        <span
                          key={stop.stopCode}
                          className="rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
                        >
                          {stop.sequenceOrder + 1}. {stop.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {trip.status === 'ASSIGNED' ? (
                  <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={respondMutation.isPending}
                      onClick={() =>
                        respondMutation.mutate({
                          tripId: trip._id,
                          decision: 'ACCEPT',
                        })
                      }
                    >
                      <Check className="h-3.5 w-3.5" />
                      Accept Trip
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={respondMutation.isPending}
                      onClick={() => setDeclineTripId(trip._id)}
                    >
                      <X className="h-3.5 w-3.5" />
                      Report Inability to Execute
                    </Button>
                  </div>
                ) : null}

                {declineTripId === trip._id ? (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <label className="block text-[11px] font-medium text-amber-950">
                      Reason for inability to execute (triggers automated reassignment):
                    </label>
                    <input
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="e.g. Vehicle maintenance / personal emergency"
                      className="w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={respondMutation.isPending}
                        onClick={() =>
                          respondMutation.mutate({
                            tripId: trip._id,
                            decision: 'REJECT',
                            reason: declineReason,
                          })
                        }
                      >
                        Confirm & Reassign
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeclineTripId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  CloudOff,
  CreditCard,
  ExternalLink,
  KeyRound,
  MapPin,
  Navigation,
  Package,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Truck,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  collectDriverPickupBalance,
  fetchDriverNotifications,
  fetchDriverProfile,
  fetchDriverTripExceptions,
  fetchDriverTrips,
  generateDeliveryOtp,
  markDriverNotificationRead,
  optimizeDriverTripRoute,
  reportDriverTripException,
  respondToDriverTrip,
  submitLoadingOverride,
  syncOfflineDriverEventsBatch,
  transitionDriverTrip,
  updateDriverAvailability,
  updateDriverShipmentStatus,
  verifyDeliveryProof,
} from '../../api/client';
import { TruckBedVisualizer } from '../../components/trip/TruckBedVisualizer';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import {
  cacheTripsOffline,
  driverDb,
  getCachedTripsOffline,
  queueOfflineEvent,
  type OfflineSyncEventRecord,
} from '../../offline/driverDb';
import { useAuthStore } from '../../stores/authStore';
import type {
  DriverAvailability,
  ExceptionRecord,
  ExceptionType,
  TripSummary,
} from '../../types/api';

const EXCEPTION_OPTIONS: Array<{ value: ExceptionType; label: string }> = [
  { value: 'VEHICLE_BREAKDOWN', label: 'Vehicle Breakdown (Trigger Automated Rescue)' },
  { value: 'ROAD_BLOCKED', label: 'Road Blocked / Delay (Recalculate Route)' },
  { value: 'CUSTOMER_UNAVAILABLE', label: 'Customer Unavailable' },
  { value: 'INCORRECT_ADDRESS', label: 'Incorrect / Unreachable Address' },
  { value: 'SHIPMENT_DAMAGED', label: 'Shipment Damaged' },
  { value: 'RECIPIENT_REFUSES', label: 'Recipient Refuses Delivery' },
  { value: 'PARTIAL_DELIVERY', label: 'Partial Delivery' },
  { value: 'PICKUP_FAILURE', label: 'Pickup Failure' },
  { value: 'DRIVER_UNAVAILABLE', label: 'Driver Unavailable' },
  { value: 'ROUTE_INFEASIBILITY', label: 'Route Infeasibility' },
];

function makeEventKey(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function DriverTripsPage() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);

  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [cachedTrips, setCachedTrips] = useState<TripSummary[]>([]);
  const [offlineQueue, setOfflineQueue] = useState<OfflineSyncEventRecord[]>([]);

  const [declineTripId, setDeclineTripId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [pauseTripId, setPauseTripId] = useState<string | null>(null);
  const [pauseReason, setPauseReason] = useState('');
  const [overrideNote, setOverrideNote] = useState<Record<string, string>>({});

  // Delivery proof state per shipment
  const [otpHints, setOtpHints] = useState<Record<string, string>>({});
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [b2bNames, setB2bNames] = useState<Record<string, string>>({});
  const [confirmModes, setConfirmModes] = useState<
    Record<string, 'OTP' | 'B2B_WAREHOUSE_SIGN_OFF'>
  >({});
  const [podPhotos, setPodPhotos] = useState<Record<string, File | null>>({});
  const [collectionMethods, setCollectionMethods] = useState<
    Record<string, 'SIMULATED_UPI' | 'CASH_AT_PICKUP'>
  >({});

  // Exception & breakdown reporting state
  const [exceptionTripId, setExceptionTripId] = useState<string | null>(null);
  const [exceptionType, setExceptionType] = useState<ExceptionType>('VEHICLE_BREAKDOWN');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionShipmentId, setExceptionShipmentId] = useState('');
  const [exceptionEvidence, setExceptionEvidence] = useState<File | null>(null);
  const [exceptionSubmitting, setExceptionSubmitting] = useState(false);
  const [tripExceptionsMap, setTripExceptionsMap] = useState<Record<string, ExceptionRecord[]>>({});

  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['driver-profile'],
    queryFn: fetchDriverProfile,
    enabled: isOnline,
  });

  const tripsQuery = useQuery({
    queryKey: ['driver-trips'],
    queryFn: async () => {
      const res = await fetchDriverTrips();
      await cacheTripsOffline(res.trips).catch(() => undefined);
      return res;
    },
    enabled: isOnline,
  });

  const notificationsQuery = useQuery({
    queryKey: ['driver-notifications'],
    queryFn: fetchDriverNotifications,
    enabled: isOnline,
  });

  const reloadOfflineState = async () => {
    const [trips, events] = await Promise.all([
      getCachedTripsOffline().catch(() => []),
      driverDb.offlineEvents.toArray().catch(() => []),
    ]);
    setCachedTrips(trips);
    setOfflineQueue(events);
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getCachedTripsOffline().catch(() => []),
      driverDb.offlineEvents.toArray().catch(() => []),
    ]).then(([trips, events]) => {
      if (!cancelled) {
        setCachedTrips(trips);
        setOfflineQueue(events);
      }
    });
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      cancelled = true;
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    if (!user?.id || !isOnline) return;
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
  }, [user?.id, isOnline, queryClient]);

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
    },
    onError: (err: Error) => setErrorBanner(err.message),
  });

  const optimizeMutation = useMutation({
    mutationFn: optimizeDriverTripRoute,
    onSuccess: (res) => {
      setErrorBanner(null);
      setActionBanner(
        res.optimized
          ? 'OR-Tools route & LIFO loading plan generated.'
          : res.routePlan?.failureReason ?? 'Route optimization failed.'
      );
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    },
    onError: (err: Error) => setErrorBanner(err.message),
  });

  const overrideMutation = useMutation({
    mutationFn: ({
      tripId,
      shipmentId,
      note,
    }: {
      tripId: string;
      shipmentId: string;
      note: string;
    }) => submitLoadingOverride(tripId, { shipmentId, note }),
    onSuccess: () => {
      setActionBanner('Manual loading override recorded in trip audit.');
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    },
  });

  const handleTripAction = async (
    tripId: string,
    action: 'start' | 'pause' | 'resume' | 'complete',
    reason?: string
  ) => {
    setErrorBanner(null);
    const idempotencyKey = makeEventKey(`trip_${action}`);
    if (!isOnline) {
      const targetMap = {
        start: 'IN_PROGRESS',
        pause: 'PAUSED',
        resume: 'IN_PROGRESS',
        complete: 'COMPLETED',
      } as const;
      await queueOfflineEvent({
        idempotencyKey,
        tripId,
        kind: 'TRIP_STATUS',
        targetStatus: targetMap[action],
        reason,
        occurredAt: new Date().toISOString(),
      });
      await reloadOfflineState();
      setActionBanner(`Queued ${action.toUpperCase()} offline in IndexedDB.`);
      setPauseTripId(null);
      setPauseReason('');
      return;
    }

    try {
      await transitionDriverTrip(tripId, action, {
        reason,
        idempotencyKey,
        locationDisclosureAccepted: true,
      });
      setPauseTripId(null);
      setPauseReason('');
      setActionBanner(`Trip ${action} recorded.`);
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Trip action failed');
    }
  };

  const handleShipmentStatus = async (
    tripId: string,
    shipmentId: string,
    status: 'IN_TRANSIT' | 'AT_DESTINATION' | 'FAILED',
    reason?: string
  ) => {
    setErrorBanner(null);
    const idempotencyKey = makeEventKey(`ship_${status}`);
    if (!isOnline) {
      await queueOfflineEvent({
        idempotencyKey,
        tripId,
        shipmentId,
        kind: 'SHIPMENT_STATUS',
        targetStatus: status,
        reason,
        occurredAt: new Date().toISOString(),
      });
      await reloadOfflineState();
      setActionBanner(`Queued shipment ${status} offline in IndexedDB.`);
      return;
    }

    try {
      await updateDriverShipmentStatus(tripId, shipmentId, {
        status,
        reason,
        idempotencyKey,
      });
      setActionBanner(`Shipment marked ${status}.`);
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Status update failed');
    }
  };

  const handleSyncOfflineQueue = async () => {
    setErrorBanner(null);
    const pending = offlineQueue.filter((e) => e.syncStatus === 'PENDING');
    if (pending.length === 0) return;

    const byTrip = new Map<string, OfflineSyncEventRecord[]>();
    for (const ev of pending) {
      const list = byTrip.get(ev.tripId) ?? [];
      list.push(ev);
      byTrip.set(ev.tripId, list);
    }

    for (const [tripId, items] of byTrip.entries()) {
      const res = await syncOfflineDriverEventsBatch(
        tripId,
        items.map((i) => ({
          idempotencyKey: i.idempotencyKey,
          kind: i.kind,
          targetStatus: i.targetStatus,
          shipmentId: i.shipmentId,
          reason: i.reason,
          occurredAt: i.occurredAt,
        }))
      );

      for (const r of res.results) {
        const local = items.find((i) => i.idempotencyKey === r.idempotencyKey);
        if (local?.id !== undefined) {
          await driverDb.offlineEvents.update(local.id, {
            syncStatus: r.status === 'CONFLICT' ? 'CONFLICT' : 'SYNCED',
            syncMessage: r.message,
          });
        }
      }
    }

    await reloadOfflineState();
    void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    setActionBanner('Offline queue synchronized with server.');
  };

  const handleGenerateOtp = async (tripId: string, shipmentId: string) => {
    setErrorBanner(null);
    try {
      const res = await generateDeliveryOtp(tripId, shipmentId);
      setActionBanner(
        res.demoOtp
          ? `OTP generated for ${res.reference} (Demo OTP: ${res.demoOtp})`
          : `OTP generated for ${res.reference}.`
      );
      if (res.demoOtp) {
        setOtpHints((prev) => ({ ...prev, [shipmentId]: res.demoOtp! }));
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'OTP generation failed');
    }
  };

  const handleDeliver = async (tripId: string, shipmentId: string) => {
    setErrorBanner(null);
    if (!isOnline) {
      setErrorBanner('OTP and photo proof delivery confirmation require online verification.');
      return;
    }
    const mode = confirmModes[shipmentId] ?? 'OTP';
    const form = new FormData();
    form.append('confirmationMode', mode);
    if (mode === 'OTP') {
      form.append('otp', otpInputs[shipmentId] ?? '');
    } else {
      form.append('b2bSignOffName', b2bNames[shipmentId] ?? '');
    }
    const file = podPhotos[shipmentId];
    if (file) {
      form.append('photo', file);
    }

    try {
      await verifyDeliveryProof(tripId, shipmentId, form);
      setActionBanner('Delivery verified and proof recorded.');
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Delivery verification failed');
    }
  };

  const markReadMutation = useMutation({
    mutationFn: markDriverNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['driver-notifications'] });
    },
  });

  const trips = isOnline ? tripsQuery.data?.trips ?? cachedTrips : cachedTrips;
  const availability =
    profileQuery.data?.driverProfile?.availabilityStatus ?? 'AVAILABLE';
  const unreadNotifications = (notificationsQuery.data?.notifications ?? []).filter(
    (n) => !n.readAt
  );
  const pendingCount = offlineQueue.filter((e) => e.syncStatus === 'PENDING').length;
  const conflictCount = offlineQueue.filter((e) => e.syncStatus === 'CONFLICT').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Assigned Trips</h1>
          <p className="text-xs text-slate-500">
            Mobile PWA • Cached offline in IndexedDB
          </p>
        </div>

        <select
          aria-label="Driver availability"
          value={availability}
          disabled={!isOnline || availabilityMutation.isPending || !profileQuery.data?.driverProfile}
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

      {!isOnline ? (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-950">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>
            Offline mode active. Basic trip/shipment status updates queue locally; QR &amp; OTP verification require connectivity.
          </span>
        </div>
      ) : null}

      {offlineQueue.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-semibold text-slate-900">
              Offline Sync Queue: {pendingCount} pending, {conflictCount} conflict(s)
            </span>
            {isOnline && pendingCount > 0 ? (
              <Button size="sm" variant="primary" onClick={() => void handleSyncOfflineQueue()}>
                <UploadCloud className="h-3.5 w-3.5" />
                Sync Now
              </Button>
            ) : null}
          </div>
          {offlineQueue.slice(-4).map((ev) => (
            <div
              key={ev.id}
              className="flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-[11px]"
            >
              <span>
                {ev.kind}: {ev.targetStatus}
              </span>
              <Badge
                variant={
                  ev.syncStatus === 'SYNCED'
                    ? 'success'
                    : ev.syncStatus === 'CONFLICT'
                      ? 'danger'
                      : 'warning'
                }
              >
                {ev.syncStatus}
              </Badge>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-lg bg-slate-200/70 px-3 py-2 text-[11px] text-slate-700">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
        Location tracking is active only while a trip is IN_PROGRESS and is never exposed publicly to recipients.
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

      {isOnline && tripsQuery.isLoading ? (
        <LoadingState title="Loading assigned trips..." />
      ) : isOnline && tripsQuery.isError && cachedTrips.length === 0 ? (
        <ErrorState
          title="Could not load trips"
          description={tripsQuery.error.message}
          onRetry={() => void tripsQuery.refetch()}
        />
      ) : trips.length === 0 ? (
        <EmptyState
          icon={<Truck className="h-6 w-6" />}
          title="No active trip assignments"
          description="You will see corridor trips here as soon as a locked pool is assigned to your vehicle."
        />
      ) : (
        <div className="space-y-4">
          {trips.map((trip) => (
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
                    trip.status === 'IN_PROGRESS' || trip.status === 'COMPLETED'
                      ? 'success'
                      : trip.status === 'PAUSED'
                        ? 'warning'
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

                {/* Trip Execution Controls */}
                <div className="flex flex-wrap gap-2 border-y border-slate-100 py-2.5">
                  {trip.status === 'ASSIGNED' ? (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={respondMutation.isPending}
                        onClick={() =>
                          respondMutation.mutate({ tripId: trip._id, decision: 'ACCEPT' })
                        }
                      >
                        <Check className="h-3.5 w-3.5" />
                        Accept Trip
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeclineTripId(trip._id)}
                      >
                        <X className="h-3.5 w-3.5" />
                        Decline
                      </Button>
                    </>
                  ) : null}

                  {['ASSIGNED', 'DRIVER_ACCEPTED'].includes(trip.status) ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void handleTripAction(trip._id, 'start')}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Start Trip
                    </Button>
                  ) : null}

                  {trip.status === 'IN_PROGRESS' ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPauseTripId(trip._id)}
                      >
                        <Pause className="h-3.5 w-3.5" />
                        Pause
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => void handleTripAction(trip._id, 'complete')}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Complete Trip
                      </Button>
                    </>
                  ) : null}

                  {trip.status === 'PAUSED' ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => void handleTripAction(trip._id, 'resume')}
                    >
                      <Play className="h-3.5 w-3.5" />
                      Resume Trip
                    </Button>
                  ) : null}

                  {isOnline ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={optimizeMutation.isPending}
                      onClick={() => optimizeMutation.mutate(trip._id)}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Optimize &amp; Plan
                    </Button>
                  ) : null}

                  {isOnline &&
                  ['ASSIGNED', 'DRIVER_ACCEPTED', 'IN_PROGRESS', 'PAUSED'].includes(trip.status) ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const nextOpen = exceptionTripId === trip._id ? null : trip._id;
                        setExceptionTripId(nextOpen);
                        setExceptionReason('');
                        setExceptionShipmentId('');
                        setExceptionEvidence(null);
                        if (nextOpen) {
                          void fetchDriverTripExceptions(trip._id)
                            .then((res) =>
                              setTripExceptionsMap((prev) => ({
                                ...prev,
                                [trip._id]: res.exceptions,
                              }))
                            )
                            .catch(() => undefined);
                        }
                      }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                      Report Exception / Breakdown
                    </Button>
                  ) : null}
                </div>

                {exceptionTripId === trip._id ? (
                  <div className="space-y-2.5 rounded-lg border border-rose-200 bg-rose-50/70 p-3 text-xs">
                    <p className="font-semibold text-rose-950">
                      Report Trip Exception, Delay, or Vehicle Breakdown
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <select
                        value={exceptionType}
                        onChange={(e) => setExceptionType(e.target.value as ExceptionType)}
                        className="rounded border border-rose-300 bg-white px-2 py-1.5 text-xs"
                      >
                        {EXCEPTION_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={exceptionShipmentId}
                        onChange={(e) => setExceptionShipmentId(e.target.value)}
                        className="rounded border border-rose-300 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="">All active trip cargo (Trip-level)</option>
                        {(trip.shipmentIds ?? []).map((sh) => (
                          <option key={sh._id} value={sh._id}>
                            {sh.reference} ({sh.deliveryStopCode})
                          </option>
                        ))}
                      </select>
                    </div>
                    <input
                      value={exceptionReason}
                      onChange={(e) => setExceptionReason(e.target.value)}
                      placeholder="Describe breakdown, delay, damage, or refusal details..."
                      className="w-full rounded border border-rose-300 bg-white px-2 py-1.5 text-xs"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => setExceptionEvidence(e.target.files?.[0] ?? null)}
                        className="max-w-[220px] text-[10px] text-slate-700"
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={exceptionSubmitting || exceptionReason.trim().length < 3}
                          onClick={() => {
                            setExceptionSubmitting(true);
                            const fd = new FormData();
                            fd.append('exceptionType', exceptionType);
                            fd.append('reason', exceptionReason.trim());
                            if (exceptionShipmentId) {
                              fd.append('shipmentId', exceptionShipmentId);
                            }
                            if (exceptionEvidence) {
                              fd.append('evidence', exceptionEvidence);
                            }
                            void reportDriverTripException(trip._id, fd)
                              .then((res) => {
                                const rescueMsg = res.reassignment?.reassigned
                                  ? ` Rescue trip ${res.reassignment.rescueTrip?.tripCode ?? ''} assigned automatically.`
                                  : res.reassignment?.reason
                                    ? ` ${res.reassignment.reason}`
                                    : '';
                                setActionBanner(
                                  `Exception ${res.exception.exceptionType} logged.${rescueMsg}`
                                );
                                setExceptionReason('');
                                setExceptionEvidence(null);
                                void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
                                return fetchDriverTripExceptions(trip._id);
                              })
                              .then((listRes) => {
                                if (listRes) {
                                  setTripExceptionsMap((prev) => ({
                                    ...prev,
                                    [trip._id]: listRes.exceptions,
                                  }));
                                }
                              })
                              .catch((err) =>
                                setErrorBanner(
                                  err instanceof Error ? err.message : 'Exception submission failed'
                                )
                              )
                              .finally(() => setExceptionSubmitting(false));
                          }}
                        >
                          {exceptionSubmitting ? 'Submitting...' : 'Submit Exception'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setExceptionTripId(null)}
                        >
                          Close
                        </Button>
                      </div>
                    </div>

                    {(tripExceptionsMap[trip._id] ?? []).length > 0 ? (
                      <div className="space-y-1 border-t border-rose-200 pt-2">
                        <p className="text-[11px] font-semibold text-rose-900">
                          Recent Exceptions on {trip.tripCode}
                        </p>
                        {(tripExceptionsMap[trip._id] ?? []).slice(0, 4).map((ex) => (
                          <div
                            key={ex._id}
                            className="flex items-center justify-between rounded bg-white px-2 py-1 text-[11px] text-slate-700"
                          >
                            <span>
                              <strong>{ex.exceptionType}</strong>: {ex.reason}
                            </span>
                            <Badge variant="warning">{ex.resolutionStatus}</Badge>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {pauseTripId === trip._id ? (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5">
                    <input
                      value={pauseReason}
                      onChange={(e) => setPauseReason(e.target.value)}
                      placeholder="Pause reason (e.g. Fuel / Traffic / Rest)"
                      className="w-full rounded border border-amber-300 bg-white px-2 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={pauseReason.trim().length < 3}
                        onClick={() =>
                          void handleTripAction(trip._id, 'pause', pauseReason)
                        }
                      >
                        Confirm Pause
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPauseTripId(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : null}

                {declineTripId === trip._id ? (
                  <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <input
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      placeholder="Reason for inability to execute..."
                      className="w-full rounded border border-amber-300 bg-white px-2.5 py-1.5 text-xs"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() =>
                          respondMutation.mutate({
                            tripId: trip._id,
                            decision: 'REJECT',
                            reason: declineReason,
                          })
                        }
                      >
                        Confirm &amp; Reassign
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

                {trip.routePlan ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800">
                        <Navigation className="mr-1 inline h-3.5 w-3.5 text-emerald-700" />
                        Route Optimization: {trip.routePlan.optimizationStatus}
                      </span>
                      <span>Matrix: {trip.routePlan.matrixProvider}</span>
                    </div>
                    {trip.routePlan.optimizationStatus === 'OPTIMAL' ? (
                      <p className="mt-1 text-slate-700">
                        Road Distance:{' '}
                        <strong>
                          {(trip.routePlan.totalDistanceMeters / 1000).toFixed(1)} km
                        </strong>{' '}
                        • Est. Drive:{' '}
                        <strong>
                          {Math.round(trip.routePlan.estimatedDurationSeconds / 60)} min
                        </strong>
                      </p>
                    ) : (
                      <p className="mt-1 text-rose-700">{trip.routePlan.failureReason}</p>
                    )}
                  </div>
                ) : null}

                {trip.stopsSummary?.length > 0 ? (
                  <div className="flex items-start gap-2 pt-1">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    <div className="flex flex-wrap gap-1.5">
                      {trip.stopsSummary.map((stop) => (
                        <a
                          key={stop.stopCode}
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            `${stop.name}, Gujarat, India`
                          )}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                        >
                          {stop.sequenceOrder + 1}. {stop.name}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}

                {/* Shipments Manifest & Delivery Proof */}
                {trip.shipmentIds && trip.shipmentIds.length > 0 ? (
                  <div className="space-y-2.5 pt-2">
                    <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                      <Package className="h-3.5 w-3.5 text-emerald-700" />
                      Trip Shipments &amp; Delivery Proof ({trip.shipmentIds.length})
                    </p>
                    {trip.shipmentIds.map((sh) => {
                      const coords = sh.deliveryAddress?.location?.coordinates;
                      const mapHref = coords
                        ? `https://www.google.com/maps/search/?api=1&query=${coords[1]},${coords[0]}`
                        : '#';
                      const mode = confirmModes[sh._id] ?? 'OTP';

                      return (
                        <div
                          key={sh._id}
                          className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px]"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-mono font-bold text-slate-900">
                              {sh.reference} → {sh.deliveryStopCode}
                            </span>
                            <Badge
                              variant={
                                sh.status === 'DELIVERED'
                                  ? 'success'
                                  : sh.status === 'FAILED'
                                    ? 'danger'
                                    : 'info'
                              }
                            >
                              {sh.status}
                            </Badge>
                          </div>

                          <p className="text-slate-700">
                            {sh.recipientName} • {sh.deliveryAddress?.villageOrTown} •{' '}
                            {sh.cargo?.quantity}× {sh.cargo?.category} (
                            {sh.cargo?.chargeableWeightKg} kg)
                          </p>
                          {sh.cargo?.handlingNotes ? (
                            <p className="text-amber-800">
                              Notes: {sh.cargo.handlingNotes}
                            </p>
                          ) : null}

                          {(sh.pricingSnapshot?.remainingBalancePaise ?? 0) > 0 ? (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2">
                              <div>
                                <p className="font-semibold text-sky-950">
                                  Pickup Balance Due:{' '}
                                  {formatPaise(sh.pricingSnapshot?.remainingBalancePaise)}
                                </p>
                                <p className="text-[10px] text-sky-800">
                                  Simulated collection record (distinct from settlement)
                                </p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <select
                                  value={collectionMethods[sh._id] ?? 'SIMULATED_UPI'}
                                  onChange={(e) =>
                                    setCollectionMethods((prev) => ({
                                      ...prev,
                                      [sh._id]: e.target.value as
                                        | 'SIMULATED_UPI'
                                        | 'CASH_AT_PICKUP',
                                    }))
                                  }
                                  className="rounded border border-sky-300 bg-white px-1.5 py-1 text-[10px]"
                                >
                                  <option value="SIMULATED_UPI">Simulated UPI</option>
                                  <option value="CASH_AT_PICKUP">Cash at Pickup</option>
                                </select>
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => {
                                    void collectDriverPickupBalance(trip._id, sh._id, {
                                      paymentMethod:
                                        collectionMethods[sh._id] ?? 'SIMULATED_UPI',
                                      idempotencyKey: `col_${trip._id}_${sh._id}`,
                                    })
                                      .then((res) => {
                                        setActionBanner(
                                          `Collected ${formatPaise(
                                            res.collection.collectedAmountPaise
                                          )} (${res.collection.providerRef}, state: ${
                                            res.collection.collectionState
                                          } / settlement: ${
                                            res.collection.settlementState
                                          }).`
                                        );
                                        void queryClient.invalidateQueries({
                                          queryKey: ['driver-trips'],
                                        });
                                      })
                                      .catch((err) =>
                                        setErrorBanner(
                                          err instanceof Error
                                            ? err.message
                                            : 'Collection failed'
                                        )
                                      );
                                  }}
                                >
                                  <CreditCard className="h-3 w-3" />
                                  Record Collection
                                </Button>
                              </div>
                            </div>
                          ) : null}

                          <div className="flex flex-wrap gap-1.5">
                            <a
                              href={mapHref}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700"
                            >
                              <Navigation className="h-3 w-3" />
                              Navigate Stop
                            </a>

                            {sh.status === 'PICKED_UP' ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void handleShipmentStatus(trip._id, sh._id, 'IN_TRANSIT')
                                }
                              >
                                Mark In-Transit
                              </Button>
                            ) : null}

                            {['PICKED_UP', 'IN_TRANSIT'].includes(sh.status) ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  void handleShipmentStatus(
                                    trip._id,
                                    sh._id,
                                    'AT_DESTINATION'
                                  )
                                }
                              >
                                At Destination
                              </Button>
                            ) : null}
                          </div>

                          {['PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'].includes(
                            sh.status
                          ) ? (
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-slate-800">
                                  Delivery Verification (Online Required)
                                </span>
                                <select
                                  value={mode}
                                  onChange={(e) =>
                                    setConfirmModes((prev) => ({
                                      ...prev,
                                      [sh._id]: e.target.value as
                                        | 'OTP'
                                        | 'B2B_WAREHOUSE_SIGN_OFF',
                                    }))
                                  }
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px]"
                                >
                                  <option value="OTP">Recipient OTP</option>
                                  {sh.allowB2bWarehouseConfirm ? (
                                    <option value="B2B_WAREHOUSE_SIGN_OFF">
                                      B2B Warehouse Sign-Off
                                    </option>
                                  ) : null}
                                </select>
                              </div>

                              {mode === 'OTP' ? (
                                <div className="flex flex-wrap gap-1.5">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleGenerateOtp(trip._id, sh._id)}
                                  >
                                    <KeyRound className="h-3 w-3" />
                                    Generate OTP
                                  </Button>
                                  <input
                                    value={otpInputs[sh._id] ?? ''}
                                    onChange={(e) =>
                                      setOtpInputs((prev) => ({
                                        ...prev,
                                        [sh._id]: e.target.value,
                                      }))
                                    }
                                    placeholder={
                                      otpHints[sh._id]
                                        ? `Enter OTP (${otpHints[sh._id]})`
                                        : '6-digit OTP'
                                    }
                                    className="w-32 rounded border border-slate-300 px-2 py-1 font-mono text-xs"
                                  />
                                </div>
                              ) : (
                                <input
                                  value={b2bNames[sh._id] ?? ''}
                                  onChange={(e) =>
                                    setB2bNames((prev) => ({
                                      ...prev,
                                      [sh._id]: e.target.value,
                                    }))
                                  }
                                  placeholder="Warehouse receiver full name..."
                                  className="w-full rounded border border-slate-300 px-2 py-1 text-xs"
                                />
                              )}

                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp"
                                  onChange={(e) =>
                                    setPodPhotos((prev) => ({
                                      ...prev,
                                      [sh._id]: e.target.files?.[0] ?? null,
                                    }))
                                  }
                                  className="max-w-[200px] text-[10px] text-slate-600"
                                />
                                <Button
                                  size="sm"
                                  variant="primary"
                                  onClick={() => void handleDeliver(trip._id, sh._id)}
                                >
                                  Confirm Delivery
                                </Button>
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {/* LIFO Manifest + 2D Truck-Bed Visualizer */}
                {trip.loadingPlan && trip.vehicleId ? (
                  <div className="space-y-3 pt-1">
                    <TruckBedVisualizer
                      bedDimensionsCm={trip.vehicleId.bedDimensionsCm}
                      loadingPlan={trip.loadingPlan}
                    />

                    {trip.loadingPlan.sequenceItems.length > 0 ? (
                      <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-900">
                          <Package className="h-3.5 w-3.5 text-emerald-700" />
                          LIFO Loading Sequence (Load #1 First)
                        </p>
                        {trip.loadingPlan.sequenceItems.map((item) => (
                          <div
                            key={item.shipmentId}
                            className="flex flex-col gap-1.5 rounded-lg border border-slate-200 bg-white p-2.5 text-[11px]"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-slate-900">
                                #{item.loadOrder} • {item.reference}
                              </span>
                              <Badge variant="neutral">{item.zoneLabel}</Badge>
                            </div>
                            <div className="flex gap-1.5">
                              <input
                                value={overrideNote[item.shipmentId] ?? ''}
                                onChange={(e) =>
                                  setOverrideNote((prev) => ({
                                    ...prev,
                                    [item.shipmentId]: e.target.value,
                                  }))
                                }
                                placeholder="Manual load override note..."
                                className="flex-1 rounded border border-slate-200 px-2 py-1 text-[11px]"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={
                                  !(overrideNote[item.shipmentId] ?? '').trim() ||
                                  overrideMutation.isPending
                                }
                                onClick={() =>
                                  overrideMutation.mutate({
                                    tripId: trip._id,
                                    shipmentId: item.shipmentId,
                                    note: overrideNote[item.shipmentId],
                                  })
                                }
                              >
                                Record Override
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {trip.backhaulDecision ? (
                  <div className="rounded-lg border border-sky-200 bg-sky-50 p-2.5 text-[11px] text-sky-950">
                    <p className="font-semibold">
                      Return Plan: {trip.backhaulDecision.decision}
                      {trip.backhaulDecision.requestCode
                        ? ` (${trip.backhaulDecision.requestCode})`
                        : ''}
                    </p>
                    <p className="mt-0.5">{trip.backhaulDecision.reason}</p>
                    {trip.backhaulDecision.decision === 'MATCHED' ? (
                      <p className="mt-0.5">
                        Return Revenue:{' '}
                        <strong>
                          {formatPaise(trip.backhaulDecision.expectedReturnRevenuePaise)}
                        </strong>
                      </p>
                    ) : null}
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

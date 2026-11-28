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
  History,
  KeyRound,
  Lock,
  MapPin,
  Navigation,
  Package,
  Pause,
  Play,
  QrCode,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
  UploadCloud,
  X,
} from 'lucide-react';
import {
  acceptTier2MarketplaceOpportunity,
  collectDriverPickupBalance,
  declineTier2MarketplaceOpportunity,
  fetchDriverNotifications,
  fetchDriverProfile,
  fetchDriverTripExceptions,
  fetchDriverTrips,
  fetchTier2MarketplaceOpportunities,
  generateDeliveryOtp,
  markDriverNotificationRead,
  reportDriverTripException,
  respondToDriverTrip,
  scanDriverQrPickup,
  submitLoadingOverride,
  syncOfflineDriverEventsBatch,
  transitionDriverTrip,
  updateDriverAvailability,
  updateDriverShipmentStatus,
  verifyDeliveryProof,
  viewTier2MarketplaceOpportunity,
} from '@/api/client';
import { Tier2ApplicationPortalCard } from '@/components/driver/Tier2ApplicationPortalCard';
import { TruckBedVisualizer } from '@/components/trip/TruckBedVisualizer';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/format';
import {
  cacheTripsOffline,
  driverDb,
  getCachedTripsOffline,
  queueOfflineEvent,
  type OfflineSyncEventRecord,
} from '@/offline/driverDb';
import { useAuthStore } from '@/stores/authStore';
import type {
  DriverAvailability,
  ExceptionRecord,
  ExceptionType,
  TripSummary,
} from '@/types/api';

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

function getTripStatusPillClasses(status: string) {
  if (status === 'IN_PROGRESS') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'COMPLETED') {
    return 'border-[#cddbfa] bg-[#eef3ff] text-[#3563e4]';
  }
  if (status === 'PAUSED') {
    return 'border-amber-200 bg-amber-50 text-amber-800';
  }
  if (status === 'CANCELLED' || status === 'DRIVER_REJECTED') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-[#cddbfa] bg-[#eef3ff] text-[#3563e4]';
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
  const [routePlanOpenFor, setRoutePlanOpenFor] = useState<Record<string, boolean>>({});
  const [qrInputs, setQrInputs] = useState<Record<string, string>>({});

  // Delivery proof state per shipment
  const [otpHints, setOtpHints] = useState<Record<string, string>>({});
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [b2bNames, setB2bNames] = useState<Record<string, string>>({});
  const [confirmModes, setConfirmModes] = useState<
    Record<string, 'OTP' | 'B2B_WAREHOUSE_SIGN_OFF'>
  >({});
  const [podPhotos, setPodPhotos] = useState<Record<string, File | null>>({});
  const [podConsent, setPodConsent] = useState<Record<string, boolean>>({});
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

  const driverProfile = profileQuery.data?.driverProfile ?? null;
  const isTier2 = driverProfile?.fleetTier === 'TIER_2';
  const isTier2Approved = isTier2 && driverProfile?.tier2ApplicationStatus === 'APPROVED';
  const isTier2Locked = isTier2 && driverProfile?.tier2ApplicationStatus !== 'APPROVED';

  const tripsQuery = useQuery({
    queryKey: ['driver-trips'],
    queryFn: async () => {
      const res = await fetchDriverTrips();
      await cacheTripsOffline(res.trips).catch(() => undefined);
      return res;
    },
    enabled: isOnline && !isTier2Locked,
  });

  const marketplaceQuery = useQuery({
    queryKey: ['driver-marketplace-opportunities'],
    queryFn: fetchTier2MarketplaceOpportunities,
    enabled: isOnline && isTier2Approved,
  });

  const notificationsQuery = useQuery({
    queryKey: ['driver-notifications'],
    queryFn: fetchDriverNotifications,
    enabled: isOnline && !isTier2Locked,
  });

  const [expandedOppId, setExpandedOppId] = useState<string | null>(null);

  const acceptMarketplaceMutation = useMutation({
    mutationFn: (tripOrOppId: string) => acceptTier2MarketplaceOpportunity(tripOrOppId),
    onSuccess: (res) => {
      setErrorBanner(null);
      setActionBanner(
        res.message ??
          `Marketplace job claimed (${res.trip?.tripCode ?? 'Trip ready'}). Earnings locked!`
      );
      void queryClient.invalidateQueries({ queryKey: ['driver-marketplace-opportunities'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-trips'] });
      void queryClient.invalidateQueries({ queryKey: ['driver-tier2-earnings'] });
    },
    onError: (err: Error) => setErrorBanner(err.message),
  });

  const declineMarketplaceMutation = useMutation({
    mutationFn: (opportunityId: string) =>
      declineTier2MarketplaceOpportunity(opportunityId, 'Declined by driver from portal'),
    onSuccess: () => {
      setActionBanner('Marketplace offer declined and released to eligible pool.');
      void queryClient.invalidateQueries({ queryKey: ['driver-marketplace-opportunities'] });
    },
    onError: (err: Error) => setErrorBanner(err.message),
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
      if (!podConsent[shipmentId]) {
        setErrorBanner('Confirm recipient photo capture consent before uploading proof.');
        return;
      }
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

  if (isOnline && profileQuery.isLoading) {
    return <LoadingState title="Loading driver workspace..." />;
  }

  if (isTier2Locked) {
    return <Tier2ApplicationPortalCard />;
  }

  const opportunities = marketplaceQuery.data?.opportunities ?? [];
  const hybridOpportunities = marketplaceQuery.data?.marketplaceOpportunities ?? [];
  const totalAvailableOpps = hybridOpportunities.length + opportunities.length;

  return (
    <div className="space-y-6">
      {/* Orbit Editorial Workspace Header */}
      <section className="orbit-reveal-1 flex flex-col justify-between gap-4 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_18px_55px_-28px_rgba(24,60,115,0.22)] sm:flex-row sm:items-center sm:p-7">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#7a94df]">
            {isTier2Approved
              ? 'Tier 2 Independent Marketplace • IndexedDB Offline Cache'
              : 'Corridor Execution PWA • IndexedDB Offline Cache'}
          </p>
          <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-[#080e2b] sm:text-[36px]">
            {isTier2Approved ? 'Marketplace & ' : 'Assigned '}
            <em
              className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
              style={{ fontStyle: 'italic' }}
            >
              trips.
            </em>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#5c6b94]">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e3ebfc] bg-[#f8faff] px-3 py-1 font-medium text-[#080e2b]">
              <Truck className="h-3.5 w-3.5 text-[#4673eb]" />
              {trips.length} {trips.length === 1 ? 'Trip' : 'Trips'}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e3ebfc] bg-[#f8faff] px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5 text-[#4673eb]" />
              Location tracked only when IN_PROGRESS
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="rounded-2xl border border-[#dce5fa] bg-[#f8faff] px-3.5 py-2">
            <label
              htmlFor="driver-availability-select"
              className="block text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]"
            >
              Driver Availability
            </label>
            <select
              id="driver-availability-select"
              aria-label="Driver availability"
              value={availability}
              disabled={
                !isOnline || availabilityMutation.isPending || !profileQuery.data?.driverProfile
              }
              onChange={(e) =>
                availabilityMutation.mutate(e.target.value as DriverAvailability)
              }
              className="mt-0.5 cursor-pointer bg-transparent text-sm font-semibold text-[#080e2b] outline-none"
            >
              <option value="AVAILABLE">Available</option>
              <option value="ON_TRIP">On Trip</option>
              <option value="OFFLINE">Offline</option>
            </select>
          </div>
        </div>
      </section>

      {/* Tier 2 Marketplace Opportunities */}
      {isTier2Approved ? (
        <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#b7caf7] bg-white/95 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.22)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f7faff] px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#4673eb] text-white">
                <Truck className="h-4 w-4" />
              </div>
              <h2 className="text-sm font-semibold text-[#080e2b] sm:text-base">
                Marketplace Trip Opportunities
              </h2>
            </div>
            <span className="rounded-full border border-[#cddbfa] bg-white px-3 py-1 text-xs font-semibold text-[#3563e4]">
              {totalAvailableOpps} available
            </span>
          </div>

          <div className="p-5 sm:p-6">
            {marketplaceQuery.isLoading ? (
              <p className="text-xs text-[#5c6b94]">Checking eligible marketplace trips...</p>
            ) : totalAvailableOpps === 0 ? (
              <p className="text-xs text-[#5c6b94]">
                No open Tier 2 marketplace opportunities right now. Assigned trips appear below.
              </p>
            ) : (
              <div className="grid gap-4 lg:grid-cols-2">
                {hybridOpportunities.map((mOpp) => {
                  const isExpanded = expandedOppId === mOpp.id;
                  return (
                    <div
                      key={mOpp.id}
                      className="flex flex-col justify-between space-y-3 rounded-2xl border border-[#cddbfa] bg-[#f8faff] p-4 text-xs transition hover:border-[#4673eb] hover:bg-white"
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono font-bold text-[#3563e4]">
                                {mOpp.opportunityCode}
                              </span>
                              <Badge variant="info">{mOpp.opportunityType}</Badge>
                              {mOpp.driverOfferStatus ? (
                                <Badge variant="neutral">{mOpp.driverOfferStatus}</Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 text-sm font-semibold text-[#080e2b]">
                              {mOpp.originLabel} → {mOpp.destinationLabel}
                            </p>
                            <p className="text-[11px] text-[#5c6b94]">
                              {mOpp.stopsSummary.map((st) => st.name).join(' → ')}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                              Spot Payout
                            </p>
                            <p className="text-base font-bold text-emerald-700">
                              {formatPaise(mOpp.payoutQuote.spotPayoutPaise)}
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#e3ebfc] bg-white p-2.5 text-[11px] text-[#4d5a83]">
                          <div>
                            <span className="block text-[10px] text-[#7a87aa]">Cargo</span>
                            <strong className="text-[#080e2b]">
                              {mOpp.cargoSummary.totalWeightKg} kg
                            </strong>{' '}
                            ({mOpp.cargoSummary.totalVolumeCbm} m³)
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#7a87aa]">Est. Route</span>
                            <strong className="text-[#080e2b]">
                              {mOpp.estimatedDistanceKm} km
                            </strong>{' '}
                            ({mOpp.estimatedDurationMin}m)
                          </div>
                          <div>
                            <span className="block text-[10px] text-[#7a87aa]">Expires</span>
                            <strong className="text-[#080e2b]">
                              {new Date(mOpp.offerExpiresAt).toLocaleTimeString('en-IN')}
                            </strong>
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="space-y-1.5 rounded-xl border border-[#dce5fa] bg-white p-3 text-[11px] text-[#5c6b94]">
                            <p>
                              <strong className="text-[#080e2b]">Cargo Spec:</strong>{' '}
                              {mOpp.cargoSummary.summaryLabel} • Max item:{' '}
                              {mOpp.cargoSummary.maxUnitLengthCm}×
                              {mOpp.cargoSummary.maxUnitWidthCm}×
                              {mOpp.cargoSummary.maxUnitHeightCm} cm
                            </p>
                            <p>
                              <strong className="text-[#080e2b]">Pickup Deadline:</strong>{' '}
                              {new Date(mOpp.pickupDeadlineAt).toLocaleString('en-IN')} •{' '}
                              <strong className="text-[#080e2b]">Delivery Deadline:</strong>{' '}
                              {new Date(mOpp.deliveryDeadlineAt).toLocaleString('en-IN')}
                            </p>
                            <p>
                              Shipper/recipient contact &amp; street address unlock automatically
                              after acceptance. Fixed spot payout excludes Tier 1 guarantees.
                            </p>
                          </div>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e3ebfc] pt-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (!isExpanded) {
                              void viewTier2MarketplaceOpportunity(mOpp.id).catch(() => undefined);
                            }
                            setExpandedOppId(isExpanded ? null : mOpp.id);
                          }}
                          className="cursor-pointer rounded-xl border border-[#d6e0f8] bg-white px-3 py-1.5 text-xs font-medium text-[#080e2b] transition hover:border-[#4673eb]"
                        >
                          {isExpanded ? 'Hide Details' : 'View Details'}
                        </button>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={declineMarketplaceMutation.isPending}
                            onClick={() => declineMarketplaceMutation.mutate(mOpp.id)}
                            className="cursor-pointer rounded-xl border border-[#d6e0f8] bg-white px-3 py-1.5 text-xs font-medium text-[#5c6b94] transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                          >
                            Decline
                          </button>
                          <button
                            type="button"
                            disabled={acceptMarketplaceMutation.isPending}
                            onClick={() => acceptMarketplaceMutation.mutate(mOpp.id)}
                            className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#4673eb] px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda] disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept Job
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {opportunities.map((opp) => (
                  <div
                    key={opp._id}
                    className="flex flex-col justify-between space-y-3 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4 text-xs transition hover:border-[#b7caf7] hover:bg-white"
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-mono font-bold text-[#3563e4]">{opp.tripCode}</p>
                          <p className="mt-0.5 text-sm font-semibold text-[#080e2b]">
                            {opp.corridor
                              ? `${opp.corridor.code} — ${opp.corridor.name}`
                              : 'Corridor Trip'}
                          </p>
                          <p className="text-[11px] text-[#5c6b94]">
                            {opp.stopsSummary.map((st) => st.name).join(' → ')}
                          </p>
                        </div>
                        <Badge variant={opp.eligibleToAccept ? 'success' : 'warning'}>
                          {opp.isAssignedToMe ? 'OFFERED' : 'OPEN'}
                        </Badge>
                      </div>

                      <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#e3ebfc] bg-white p-2.5 text-[11px] text-[#4d5a83]">
                        <div>
                          <span className="block text-[10px] text-[#7a87aa]">Cargo</span>
                          <strong className="text-[#080e2b]">
                            {opp.totalChargeableWeightKg} kg
                          </strong>{' '}
                          ({opp.totalVolumeCbm} m³)
                        </div>
                        <div>
                          <span className="block text-[10px] text-[#7a87aa]">Shipments</span>
                          <strong className="text-[#080e2b]">{opp.shipmentCount}</strong>
                        </div>
                        <div>
                          <span className="block text-[10px] text-[#7a87aa]">Est. Payout</span>
                          <strong className="text-emerald-700">
                            {formatPaise(opp.estimatedPayoutPaise)}
                          </strong>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e3ebfc] pt-3">
                      <span className="text-[11px] text-[#5c6b94]">
                        Departs: {new Date(opp.plannedDepartureAt).toLocaleString('en-IN')}
                      </span>
                      {opp.eligibleToAccept ? (
                        <button
                          type="button"
                          disabled={acceptMarketplaceMutation.isPending}
                          onClick={() => acceptMarketplaceMutation.mutate(opp._id)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#4673eb] px-4 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda] disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Accept Opportunity
                        </button>
                      ) : (
                        <span className="text-[11px] font-medium text-rose-700">
                          {opp.ineligibleReason}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      ) : null}

      {/* Offline Mode & Sync Queue Strip */}
      {!isOnline ? (
        <div className="flex items-center gap-2.5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-medium text-amber-950 shadow-2xs">
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>
            Offline mode active. Basic trip/shipment status updates queue locally in IndexedDB; QR &amp;
            OTP verification require connectivity.
          </span>
        </div>
      ) : null}

      {offlineQueue.length > 0 ? (
        <div className="space-y-2.5 rounded-[24px] border border-[#dce5fa] bg-white/95 p-4 text-xs shadow-xs sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-semibold text-[#080e2b]">
              Offline Sync Queue: {pendingCount} pending, {conflictCount} conflict(s)
            </span>
            {isOnline && pendingCount > 0 ? (
              <button
                type="button"
                onClick={() => void handleSyncOfflineQueue()}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#4673eb] px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-[#345fda]"
              >
                <UploadCloud className="h-3.5 w-3.5" />
                Sync Now
              </button>
            ) : null}
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {offlineQueue.slice(-4).map((ev) => (
              <div
                key={ev.id}
                className="flex items-center justify-between rounded-xl border border-[#e3ebfc] bg-[#f8faff] px-3 py-2 text-[11px]"
              >
                <span className="font-medium text-[#080e2b]">
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
        </div>
      ) : null}

      {actionBanner ? (
        <div className="orbit-reveal-1 flex items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{actionBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setActionBanner(null)}
            className="cursor-pointer rounded-lg px-2 py-0.5 text-[11px] hover:bg-emerald-100"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {errorBanner ? (
        <div className="orbit-reveal-1 flex items-center justify-between gap-2 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{errorBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorBanner(null)}
            className="cursor-pointer rounded-lg px-2 py-0.5 text-[11px] hover:bg-rose-100"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      {unreadNotifications.length > 0 ? (
        <div className="grid gap-2.5 sm:grid-cols-2">
          {unreadNotifications.map((notif) => (
            <div
              key={notif._id}
              className="flex items-start justify-between gap-3 rounded-2xl border border-[#cddbfa] bg-[#eef3ff]/80 px-4 py-3 text-xs text-[#080e2b]"
            >
              <div className="flex items-start gap-2.5">
                <Bell className="mt-0.5 h-4 w-4 shrink-0 text-[#4673eb]" />
                <div>
                  <p className="font-semibold">{notif.title}</p>
                  <p className="mt-0.5 text-[#4d5a83]">{notif.message}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => markReadMutation.mutate(notif._id)}
                className="cursor-pointer rounded-lg px-2 py-1 text-[11px] font-semibold text-[#3563e4] hover:bg-white"
              >
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {/* Main Trips Deck */}
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
          icon={<Truck className="h-6 w-6 text-[#4673eb]" />}
          title="No active trip assignments"
          description="You will see corridor trips here after committing to a pooling window and receiving automated allocation upon pool closure."
        />
      ) : (
        <div className="orbit-reveal-3 space-y-6">
          {trips.map((trip) => {
            const isTier1Trip =
              trip.allocationEconomics?.allocatedTier === 'TIER_1' ||
              Boolean(trip.sourceCommitmentId);
            const isReadOnlyTrip =
              trip.status === 'COMPLETED' ||
              trip.status === 'CANCELLED' ||
              trip.status === 'DRIVER_REJECTED';

            // MC-054: Read schedule strictly from locked trip/commitment snapshot
            const snap = trip.scheduleSnapshot;
            const slotNumber = snap?.slotNumber ?? trip.slotId?.slotNumber;
            const outboundPickupTime =
              snap?.outboundPickupTime ??
              new Date(trip.plannedDepartureAt).toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
              });
            const lockedReturnTime =
              snap?.selectedReturnTime ??
              trip.slotId?.lockedReturnTime ??
              (trip.estimatedEndAt
                ? new Date(trip.estimatedEndAt).toLocaleTimeString('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                  })
                : '—');
            const isLockedReturn = Boolean(
              snap?.returnTimeLocked ?? trip.slotId?.returnTimeLocked
            );
            const serviceDateLabel = snap?.serviceDate
              ? new Date(snap.serviceDate).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : new Date(trip.plannedDepartureAt).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                });

            // MC-055: Use registered vehicle snapshot or vehicle dimensions cleanly
            const effectiveBedDims =
              trip.vehicleSnapshot?.bedDimensionsCm ?? trip.vehicleId?.bedDimensionsCm;
            const effectiveVehicleReg =
              trip.vehicleSnapshot?.registrationNumber ?? trip.vehicleId?.registrationNumber;

            // MC-057: Determine current stop from official orderedStops / stopsSummary for pending shipments
            const pendingShipmentStopCodes = new Set(
              (trip.shipmentIds ?? [])
                .filter((s) => !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(s.status))
                .map((s) =>
                  s.status === 'LOCKED'
                    ? (s.pickupStopCode ?? trip.stopsSummary?.[0]?.stopCode ?? '').toUpperCase()
                    : s.deliveryStopCode.toUpperCase()
                )
            );
            const orderedStops =
              trip.routePlan?.orderedStops?.length
                ? trip.routePlan.orderedStops
                : (trip.stopsSummary ?? []).map((st) => ({
                    sequence: st.sequenceOrder,
                    stopCode: st.stopCode,
                    name: st.name,
                    arrivalMin: 0,
                    cumulativeDistanceMeters: 0,
                    shipmentIds: [] as string[],
                  }));
            const currentStop =
              orderedStops.find((st) =>
                pendingShipmentStopCodes.has(st.stopCode.toUpperCase())
              ) ?? orderedStops[0];
            const matchedCorridorStop = currentStop
              ? trip.corridorId?.stops?.find(
                  (cs) => cs.stopCode.toUpperCase() === currentStop.stopCode.toUpperCase()
                )
              : undefined;
            const currentStopCoords = matchedCorridorStop?.location?.coordinates;
            const navUrl = currentStopCoords
              ? `https://www.google.com/maps/search/?api=1&query=${currentStopCoords[1]},${currentStopCoords[0]}`
              : currentStop?.name
                ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                    `${currentStop.name}, Gujarat, India`
                  )}`
                : null;

            return (
              <article
                key={trip._id}
                className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_60px_-28px_rgba(24,60,115,0.22)] transition hover:border-[#c3d4f8]"
              >
                {/* Trip Card Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0fd] bg-[#f8faff] px-5 py-4 sm:px-7">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg border border-[#cddbfa] bg-white px-2.5 py-0.5 font-mono text-xs font-semibold text-[#3563e4]">
                        {trip.tripCode}
                      </span>
                      {slotNumber ? (
                        <span className="rounded-full border border-[#d6e0f8] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#4d5a83]">
                          Slot {slotNumber}
                        </span>
                      ) : null}
                      {trip.sourceCommitmentId ? (
                        <span className="rounded-full border border-[#cddbfa] bg-[#eef3ff] px-2.5 py-0.5 text-[11px] font-medium text-[#3563e4]">
                          Allocated from Slot Commitment
                        </span>
                      ) : null}
                    </div>
                    <h2 className="mt-1.5 text-base font-semibold text-[#080e2b] sm:text-lg">
                      {trip.corridorId?.code ? `${trip.corridorId.code} — ` : ''}
                      {trip.corridorId?.name ?? 'Corridor Assignment'}
                    </h2>
                  </div>

                  <span
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-semibold',
                      getTripStatusPillClasses(trip.status)
                    )}
                  >
                    {trip.status === 'IN_PROGRESS' && (
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    )}
                    {trip.status}
                  </span>
                </div>

                {/* Responsive Two-Column Desktop Split Inside Trip */}
                <div className="grid gap-6 p-5 text-xs text-[#4d5a83] sm:p-7 xl:grid-cols-12">
                  {/* Left Column: Schedule, Controls, Manifest & Proofs */}
                  <div className="space-y-5 xl:col-span-7">
                    {/* Locked Schedule Snapshot */}
                    <div className="space-y-2 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[#080e2b]">
                          <CalendarClock className="h-4 w-4 text-[#4673eb]" />
                          Locked Trip Schedule ({serviceDateLabel})
                        </span>
                        <span className="text-[10px] font-medium text-[#7a87aa]">
                          Snapshot • Not a guaranteed ETA
                        </span>
                      </div>
                      <div className="grid gap-3 pt-1 sm:grid-cols-3">
                        <div className="rounded-xl border border-[#e3ebfc] bg-white px-3 py-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                            Slot
                          </span>
                          <p className="mt-0.5 font-semibold text-[#080e2b]">
                            {snap?.slotCode ?? trip.slotId?.slotCode ?? `Slot ${slotNumber ?? '—'}`}
                          </p>
                        </div>
                        <div className="rounded-xl border border-[#e3ebfc] bg-white px-3 py-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                            Outbound Pickup
                          </span>
                          <p className="mt-0.5 font-semibold text-[#080e2b]">{outboundPickupTime}</p>
                        </div>
                        <div className="rounded-xl border border-[#e3ebfc] bg-white px-3 py-2">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                            Return Schedule
                          </span>
                          <p className="mt-0.5 inline-flex items-center gap-1 font-semibold text-[#080e2b]">
                            {isLockedReturn ? <Lock className="h-3 w-3 text-amber-600" /> : null}
                            {lockedReturnTime}
                            {isLockedReturn ? ' (Locked)' : ' (Selected)'}
                          </p>
                        </div>
                      </div>
                    </div>

                    {trip.vehicleId || trip.vehicleSnapshot ? (
                      <div className="flex items-center gap-2 rounded-xl border border-[#e3ebfc] bg-white px-3.5 py-2.5 text-xs">
                        <Truck className="h-4 w-4 shrink-0 text-[#4673eb]" />
                        <span>
                          Vehicle:{' '}
                          <strong className="text-[#080e2b]">
                            {trip.vehicleSnapshot?.registrationNumber ??
                              trip.vehicleId?.registrationNumber}
                          </strong>{' '}
                          ({trip.vehicleSnapshot?.vehicleClass ?? trip.vehicleId?.vehicleClass} •{' '}
                          {trip.vehicleSnapshot?.ownershipType ??
                            trip.allocationEconomics?.allocatedTier ??
                            trip.vehicleId?.tier}
                          )
                        </span>
                      </div>
                    ) : null}

                    {/* Execution Controls Bar */}
                    <div className="flex flex-wrap gap-2 border-y border-[#eaf0fd] py-3">
                      {!isTier1Trip && trip.status === 'ASSIGNED' ? (
                        <>
                          <button
                            type="button"
                            disabled={respondMutation.isPending}
                            onClick={() =>
                              respondMutation.mutate({ tripId: trip._id, decision: 'ACCEPT' })
                            }
                            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl bg-[#4673eb] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda] disabled:opacity-50"
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept Trip
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeclineTripId(trip._id)}
                            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2 text-xs font-medium text-[#080e2b] transition hover:border-rose-300 hover:text-rose-700"
                          >
                            <X className="h-3.5 w-3.5" />
                            Decline
                          </button>
                        </>
                      ) : null}

                      {['ASSIGNED', 'DRIVER_ACCEPTED'].includes(trip.status) ? (
                        <button
                          type="button"
                          onClick={() => void handleTripAction(trip._id, 'start')}
                          className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl bg-[#4673eb] px-4 py-2 text-xs font-semibold text-white shadow-[0_10px_24px_-10px_rgba(70,115,235,0.65)] transition hover:-translate-y-0.5 hover:bg-[#345fda]"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Start Trip
                        </button>
                      ) : null}

                      {trip.status === 'IN_PROGRESS' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setPauseTripId(trip._id)}
                            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2 text-xs font-medium text-[#080e2b] transition hover:border-[#4673eb]"
                          >
                            <Pause className="h-3.5 w-3.5" />
                            Pause
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleTripAction(trip._id, 'complete')}
                            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl bg-[#4673eb] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda]"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Complete Trip
                          </button>
                        </>
                      ) : null}

                      {trip.status === 'PAUSED' ? (
                        <button
                          type="button"
                          onClick={() => void handleTripAction(trip._id, 'resume')}
                          className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl bg-[#4673eb] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda]"
                        >
                          <Play className="h-3.5 w-3.5" />
                          Resume Trip
                        </button>
                      ) : null}

                      <button
                        type="button"
                        onClick={() =>
                          setRoutePlanOpenFor((prev) => ({
                            ...prev,
                            [trip._id]: !prev[trip._id],
                          }))
                        }
                        className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2 text-xs font-medium text-[#080e2b] transition hover:border-[#4673eb] hover:bg-[#eef3ff]"
                      >
                        <RouteIcon className="h-3.5 w-3.5 text-[#4673eb]" />
                        {routePlanOpenFor[trip._id] ? 'Hide Route Plan' : 'View Route Plan'}
                      </button>

                      {!isReadOnlyTrip && currentStop ? (
                        navUrl ? (
                          <a
                            href={navUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2 text-xs font-medium text-[#080e2b] transition hover:border-[#4673eb] hover:bg-[#eef3ff]"
                          >
                            <Navigation className="h-3.5 w-3.5 text-[#4673eb]" />
                            Navigate to {currentStop.stopCode}
                          </a>
                        ) : (
                          <span className="inline-flex min-h-[38px] items-center gap-1 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-3 py-2 text-[11px] text-[#7a87aa]">
                            Navigation unavailable for {currentStop.stopCode}
                          </span>
                        )
                      ) : null}

                      {isOnline && !isReadOnlyTrip ? (
                        <>
                          {trip.status === 'IN_PROGRESS' || trip.status === 'PAUSED' ? (
                            <button
                              type="button"
                              onClick={() => {
                                setExceptionTripId(trip._id);
                                setExceptionType('ROAD_BLOCKED');
                                setExceptionReason('');
                                setExceptionShipmentId('');
                                setExceptionEvidence(null);
                              }}
                              className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2 text-xs font-medium text-[#080e2b] transition hover:border-amber-400 hover:bg-amber-50/50"
                            >
                              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                              Report Route Issue
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => {
                              const nextOpen = exceptionTripId === trip._id ? null : trip._id;
                              setExceptionTripId(nextOpen);
                              setExceptionType(
                                ['ASSIGNED', 'DRIVER_ACCEPTED'].includes(trip.status)
                                  ? 'DRIVER_UNAVAILABLE'
                                  : 'VEHICLE_BREAKDOWN'
                              );
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
                            className="inline-flex min-h-[38px] cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d6e0f8] bg-white px-4 py-2 text-xs font-medium text-[#080e2b] transition hover:border-amber-400 hover:bg-amber-50/50"
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                            {['ASSIGNED', 'DRIVER_ACCEPTED'].includes(trip.status)
                              ? 'Report Issue / Cannot Operate'
                              : 'Report Exception'}
                          </button>
                        </>
                      ) : null}
                    </div>

                    {/* Inline Panels: Exception, Pause, Decline, Route Plan */}
                    {exceptionTripId === trip._id ? (
                      <div className="space-y-3 rounded-2xl border border-rose-200 bg-rose-50/75 p-4 text-xs">
                        <p className="font-semibold text-rose-950">
                          Report Trip Exception, Delay, or Vehicle Breakdown
                        </p>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          <select
                            value={exceptionType}
                            onChange={(e) => setExceptionType(e.target.value as ExceptionType)}
                            className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs text-[#080e2b]"
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
                            className="rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs text-[#080e2b]"
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
                          className="w-full rounded-xl border border-rose-300 bg-white px-3 py-2 text-xs text-[#080e2b]"
                        />
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <input
                            type="file"
                            accept="image/jpeg,image/png,image/webp"
                            onChange={(e) => setExceptionEvidence(e.target.files?.[0] ?? null)}
                            className="max-w-[230px] text-[11px] text-[#4d5a83]"
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
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
                                      err instanceof Error
                                        ? err.message
                                        : 'Exception submission failed'
                                    )
                                  )
                                  .finally(() => setExceptionSubmitting(false));
                              }}
                              className="cursor-pointer rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
                            >
                              {exceptionSubmitting ? 'Submitting...' : 'Submit Exception'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setExceptionTripId(null)}
                              className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-[#4d5a83] hover:bg-white"
                            >
                              Close
                            </button>
                          </div>
                        </div>

                        {(tripExceptionsMap[trip._id] ?? []).length > 0 ? (
                          <div className="space-y-1.5 border-t border-rose-200 pt-2">
                            <p className="text-[11px] font-semibold text-rose-900">
                              Recent Exceptions on {trip.tripCode}
                            </p>
                            {(tripExceptionsMap[trip._id] ?? []).slice(0, 4).map((ex) => (
                              <div
                                key={ex._id}
                                className="flex items-center justify-between rounded-xl bg-white px-3 py-1.5 text-[11px] text-[#4d5a83]"
                              >
                                <span>
                                  <strong className="text-[#080e2b]">{ex.exceptionType}</strong>:{' '}
                                  {ex.reason}
                                </span>
                                <Badge variant="warning">{ex.resolutionStatus}</Badge>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {pauseTripId === trip._id ? (
                      <div className="space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                        <input
                          value={pauseReason}
                          onChange={(e) => setPauseReason(e.target.value)}
                          placeholder="Pause reason (e.g. Fuel / Traffic / Rest)"
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs text-[#080e2b]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={pauseReason.trim().length < 3}
                            onClick={() =>
                              void handleTripAction(trip._id, 'pause', pauseReason)
                            }
                            className="cursor-pointer rounded-xl bg-[#080e2b] px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            Confirm Pause
                          </button>
                          <button
                            type="button"
                            onClick={() => setPauseTripId(null)}
                            className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-[#4d5a83] hover:bg-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {declineTripId === trip._id ? (
                      <div className="space-y-2.5 rounded-2xl border border-amber-200 bg-amber-50 p-3.5">
                        <input
                          value={declineReason}
                          onChange={(e) => setDeclineReason(e.target.value)}
                          placeholder="Reason for inability to execute..."
                          className="w-full rounded-xl border border-amber-300 bg-white px-3 py-2 text-xs text-[#080e2b]"
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              respondMutation.mutate({
                                tripId: trip._id,
                                decision: 'REJECT',
                                reason: declineReason,
                              })
                            }
                            className="cursor-pointer rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white"
                          >
                            Confirm &amp; Reassign
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeclineTripId(null)}
                            className="cursor-pointer rounded-xl px-3 py-2 text-xs font-medium text-[#4d5a83] hover:bg-white"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : null}

                    {trip.routePlan && routePlanOpenFor[trip._id] ? (
                      <div className="space-y-2 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4 text-[11px]">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-semibold text-[#080e2b]">
                            <Navigation className="mr-1 inline h-3.5 w-3.5 text-[#4673eb]" />
                            Official Route v{trip.routePlan.routeVersion ?? 1} (
                            {trip.routePlan.optimizationStatus})
                          </span>
                          <span className="text-[#7a87aa]">
                            Backend Matrix: {trip.routePlan.matrixProvider}
                          </span>
                        </div>
                        {trip.routePlan.optimizationStatus === 'OPTIMAL' ? (
                          <>
                            <p className="text-[#4d5a83]">
                              Road Distance:{' '}
                              <strong className="text-[#080e2b]">
                                {(trip.routePlan.totalDistanceMeters / 1000).toFixed(1)} km
                              </strong>{' '}
                              • Est. Drive:{' '}
                              <strong className="text-[#080e2b]">
                                {Math.round(trip.routePlan.estimatedDurationSeconds / 60)} min
                              </strong>
                            </p>
                            {trip.routePlan.orderedStops.length > 0 ? (
                              <div className="space-y-1 border-t border-[#e3ebfc] pt-2">
                                {trip.routePlan.orderedStops.map((st) => (
                                  <div
                                    key={`${st.sequence}-${st.stopCode}`}
                                    className="flex items-center justify-between text-[#4d5a83]"
                                  >
                                    <span>
                                      {st.sequence + 1}.{' '}
                                      <strong className="text-[#080e2b]">{st.stopCode}</strong> —{' '}
                                      {st.name}
                                    </span>
                                    <span className="text-[#7a87aa]">
                                      {(st.cumulativeDistanceMeters / 1000).toFixed(1)} km • +
                                      {st.arrivalMin}m
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-rose-700">{trip.routePlan.failureReason}</p>
                        )}

                        {(trip.routePlan.routeHistory ?? []).length > 0 ? (
                          <div className="border-t border-[#e3ebfc] pt-2 text-[10px] text-[#7a87aa]">
                            <p className="inline-flex items-center gap-1 font-semibold text-[#4d5a83]">
                              <History className="h-3 w-3" /> Route Version Audit History
                            </p>
                            {trip.routePlan.routeHistory!.map((h) => (
                              <p key={h.version}>
                                v{h.version} (superseded{' '}
                                {new Date(h.supersededAt).toLocaleString('en-IN')})
                                {h.reason ? ` — ${h.reason}` : ''}
                              </p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Route Stops Bar */}
                    {trip.stopsSummary?.length > 0 ? (
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-1 h-4 w-4 shrink-0 text-[#4673eb]" />
                        <div className="flex flex-wrap gap-1.5">
                          {trip.stopsSummary.map((stop) => {
                            const cStop = trip.corridorId?.stops?.find(
                              (cs) => cs.stopCode.toUpperCase() === stop.stopCode.toUpperCase()
                            );
                            const coords = cStop?.location?.coordinates;
                            const stopMapHref = coords
                              ? `https://www.google.com/maps/search/?api=1&query=${coords[1]},${coords[0]}`
                              : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                                  `${stop.name}, Gujarat, India`
                                )}`;
                            return (
                              <a
                                key={stop.stopCode}
                                href={stopMapHref}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-full border border-[#d6e0f8] bg-[#f8faff] px-3 py-1 text-[11px] font-medium text-[#080e2b] transition hover:border-[#4673eb] hover:bg-[#eef3ff]"
                              >
                                {stop.sequenceOrder + 1}. {stop.name}
                                <ExternalLink className="h-2.5 w-2.5 text-[#4673eb]" />
                              </a>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Shipments Manifest & Delivery Proof */}
                    {trip.shipmentIds && trip.shipmentIds.length > 0 ? (
                      <div className="space-y-3 pt-1">
                        <p className="flex items-center gap-2 text-xs font-semibold text-[#080e2b]">
                          <Package className="h-4 w-4 text-[#4673eb]" />
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
                              className="space-y-2.5 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4 text-[11px]"
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-bold text-[#080e2b]">
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

                              <p className="text-[#4d5a83]">
                                <strong className="text-[#080e2b]">{sh.recipientName}</strong> •{' '}
                                {sh.deliveryAddress?.villageOrTown} • {sh.cargo?.quantity}×{' '}
                                {sh.cargo?.category} ({sh.cargo?.chargeableWeightKg} kg)
                              </p>
                              {sh.cargo?.handlingNotes ? (
                                <p className="text-amber-800">Notes: {sh.cargo.handlingNotes}</p>
                              ) : null}

                              {(sh.pricingSnapshot?.remainingBalancePaise ?? 0) > 0 ? (
                                sh.pickupBalanceCollectedAt ? (
                                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-900">
                                    <span className="font-semibold">
                                      Pickup Balance Collected:{' '}
                                      {formatPaise(sh.pricingSnapshot?.remainingBalancePaise)}
                                    </span>
                                    <Badge variant="success">
                                      COLLECTED (Distinct from Settlement)
                                    </Badge>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#cddbfa] bg-[#eef3ff]/80 p-3">
                                    <div>
                                      <p className="font-semibold text-[#080e2b]">
                                        Pickup Balance Due:{' '}
                                        {formatPaise(sh.pricingSnapshot?.remainingBalancePaise)}
                                      </p>
                                      <p className="text-[10px] text-[#5c6b94]">
                                        Simulated collection record — distinct from driver
                                        payout/settlement
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
                                        className="rounded-xl border border-[#c5d4f7] bg-white px-2.5 py-1.5 text-[11px] text-[#080e2b]"
                                      >
                                        <option value="SIMULATED_UPI">Simulated UPI</option>
                                        <option value="CASH_AT_PICKUP">Cash at Pickup</option>
                                      </select>
                                      <button
                                        type="button"
                                        disabled={!isOnline}
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
                                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#4673eb] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#345fda] disabled:opacity-50"
                                      >
                                        <CreditCard className="h-3 w-3" />
                                        Record Collection
                                      </button>
                                    </div>
                                  </div>
                                )
                              ) : null}

                              {/* Inline QR Pickup Verification for LOCKED shipments */}
                              {sh.status === 'LOCKED' && isOnline && !isReadOnlyTrip ? (
                                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#cddbfa] bg-white p-2.5">
                                  <QrCode className="h-4 w-4 shrink-0 text-[#4673eb]" />
                                  <input
                                    value={qrInputs[sh._id] ?? ''}
                                    onChange={(e) =>
                                      setQrInputs((prev) => ({
                                        ...prev,
                                        [sh._id]: e.target.value,
                                      }))
                                    }
                                    placeholder={`Verify pickup QR at ${sh.pickupStopCode ?? 'origin'}...`}
                                    className="min-w-[160px] flex-1 rounded-xl border border-[#d6e0f8] bg-[#f8faff] px-2.5 py-1.5 font-mono text-[11px] text-[#080e2b]"
                                  />
                                  <button
                                    type="button"
                                    disabled={!(qrInputs[sh._id] ?? '').trim()}
                                    onClick={() => {
                                      const token = (qrInputs[sh._id] ?? '').trim();
                                      void scanDriverQrPickup(trip._id, {
                                        qrToken: token,
                                        expectedPickupStopCode: sh.pickupStopCode,
                                        idempotencyKey: `qr_${trip._id}_${token}`,
                                      })
                                        .then((res) => {
                                          setErrorBanner(null);
                                          setActionBanner(
                                            `QR verified for ${res.shipment.reference} pickup.`
                                          );
                                          void queryClient.invalidateQueries({
                                            queryKey: ['driver-trips'],
                                          });
                                        })
                                        .catch((err) =>
                                          setErrorBanner(
                                            err instanceof Error
                                              ? err.message
                                              : 'QR verification failed'
                                          )
                                        );
                                    }}
                                    className="cursor-pointer rounded-xl bg-[#4673eb] px-3 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#345fda] disabled:opacity-50"
                                  >
                                    Verify Pickup QR
                                  </button>
                                </div>
                              ) : null}

                              <div className="flex flex-wrap gap-1.5">
                                <a
                                  href={mapHref}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 rounded-xl border border-[#d6e0f8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#080e2b] transition hover:border-[#4673eb]"
                                >
                                  <Navigation className="h-3 w-3 text-[#4673eb]" />
                                  Navigate Stop
                                </a>

                                {sh.status === 'PICKED_UP' ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleShipmentStatus(trip._id, sh._id, 'IN_TRANSIT')
                                    }
                                    className="cursor-pointer rounded-xl border border-[#d6e0f8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#080e2b] transition hover:border-[#4673eb]"
                                  >
                                    Mark In-Transit
                                  </button>
                                ) : null}

                                {['PICKED_UP', 'IN_TRANSIT'].includes(sh.status) ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleShipmentStatus(trip._id, sh._id, 'AT_DESTINATION')
                                    }
                                    className="cursor-pointer rounded-xl border border-[#d6e0f8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#080e2b] transition hover:border-[#4673eb]"
                                  >
                                    At Destination
                                  </button>
                                ) : null}

                                {['PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'].includes(
                                  sh.status
                                ) && isOnline ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setExceptionTripId(trip._id);
                                      setExceptionShipmentId(sh._id);
                                      setExceptionType('CUSTOMER_UNAVAILABLE');
                                      setExceptionReason('');
                                      setExceptionEvidence(null);
                                    }}
                                    className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-[#d6e0f8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#080e2b] transition hover:border-amber-400"
                                  >
                                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                                    Report Failed Delivery
                                  </button>
                                ) : null}
                              </div>

                              {['PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'].includes(sh.status) ? (
                                <div className="space-y-2.5 rounded-xl border border-[#dce5fa] bg-white p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-[#080e2b]">
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
                                      className="rounded-xl border border-[#d6e0f8] bg-[#f8faff] px-2.5 py-1 text-[11px] text-[#080e2b]"
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
                                    <div className="flex flex-wrap gap-2">
                                      <button
                                        type="button"
                                        onClick={() => void handleGenerateOtp(trip._id, sh._id)}
                                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#d6e0f8] bg-[#f8faff] px-3 py-1.5 text-[11px] font-medium text-[#080e2b] hover:border-[#4673eb]"
                                      >
                                        <KeyRound className="h-3 w-3 text-[#4673eb]" />
                                        Generate OTP
                                      </button>
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
                                        className="w-36 rounded-xl border border-[#d6e0f8] bg-[#f8faff] px-2.5 py-1.5 font-mono text-xs text-[#080e2b]"
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
                                      className="w-full rounded-xl border border-[#d6e0f8] bg-[#f8faff] px-2.5 py-1.5 text-xs text-[#080e2b]"
                                    />
                                  )}

                                  <div className="space-y-2">
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
                                        className="max-w-[200px] text-[10px] text-[#5c6b94]"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void handleDeliver(trip._id, sh._id)}
                                        className="cursor-pointer rounded-xl bg-[#4673eb] px-3.5 py-1.5 text-[11px] font-semibold text-white transition hover:bg-[#345fda]"
                                      >
                                        Confirm Delivery
                                      </button>
                                    </div>
                                    {podPhotos[sh._id] ? (
                                      <label className="flex items-center gap-1.5 text-[10px] text-[#5c6b94]">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(podConsent[sh._id])}
                                          onChange={(e) =>
                                            setPodConsent((prev) => ({
                                              ...prev,
                                              [sh._id]: e.target.checked,
                                            }))
                                          }
                                        />
                                        Recipient consent obtained for delivery proof photo
                                      </label>
                                    ) : null}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>

                  {/* Right Column: Truck Bed Visualizer, LIFO Override, and Return Plan */}
                  <div className="space-y-4 xl:col-span-5">
                    <TruckBedVisualizer
                      bedDimensionsCm={effectiveBedDims}
                      vehicleLabel={effectiveVehicleReg}
                      loadingPlan={trip.loadingPlan}
                    />

                    {trip.loadingPlan && trip.loadingPlan.sequenceItems.length > 0 ? (
                      <div className="space-y-2 rounded-[22px] border border-[#dce5fa] bg-[#f8faff] p-4">
                        <p className="flex items-center gap-1.5 text-xs font-semibold text-[#080e2b]">
                          <Package className="h-3.5 w-3.5 text-[#4673eb]" />
                          LIFO Loading Sequence (Load #1 First)
                        </p>
                        {trip.loadingPlan.sequenceItems.map((item) => (
                          <div
                            key={item.shipmentId}
                            className="flex flex-col gap-2 rounded-xl border border-[#e3ebfc] bg-white p-3 text-[11px]"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono font-bold text-[#080e2b]">
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
                                className="flex-1 rounded-xl border border-[#d6e0f8] bg-[#f8faff] px-2.5 py-1.5 text-[11px] text-[#080e2b]"
                              />
                              <button
                                type="button"
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
                                className="cursor-pointer rounded-xl border border-[#d6e0f8] bg-white px-2.5 py-1.5 text-[11px] font-medium text-[#080e2b] transition hover:border-[#4673eb] disabled:opacity-45"
                              >
                                Record Override
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {/* Return Plan Card */}
                    <div className="space-y-2 rounded-[22px] border border-[#cddbfa] bg-[#eef3ff]/75 p-4 text-[11px] text-[#3b476b]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-[#080e2b]">
                          Return Plan:{' '}
                          {trip.backhaulDecision?.decision === 'MATCHED'
                            ? `Backhaul Assigned (${trip.backhaulDecision.requestCode ?? 'Matched'})`
                            : 'Scheduled Empty Return'}
                        </p>
                        <Badge
                          variant={
                            trip.backhaulDecision?.decision === 'MATCHED' ? 'success' : 'neutral'
                          }
                        >
                          Return Time:{' '}
                          {trip.backhaulDecision?.scheduledReturnTime ?? lockedReturnTime}
                        </Badge>
                      </div>

                      {trip.backhaulDecision?.decision === 'MATCHED' ? (
                        <div className="space-y-1">
                          <p>{trip.backhaulDecision.reason}</p>
                          {trip.backhaulDecision.returnCargoSummary ? (
                            <p>
                              Return Cargo ({trip.backhaulDecision.returnShipmentCount ?? 1}{' '}
                              shipment):{' '}
                              <strong className="text-[#080e2b]">
                                {trip.backhaulDecision.returnCargoSummary}
                              </strong>
                            </p>
                          ) : null}
                          {(trip.backhaulDecision.returnStops ?? []).length > 0 ? (
                            <p>
                              Return Stops:{' '}
                              {trip.backhaulDecision.returnStops!
                                .map((rs) => `${rs.stopCode} (${rs.action.replace('_', ' ')})`)
                                .join(' → ')}
                            </p>
                          ) : null}
                          <p>
                            Est. Return Revenue Contribution:{' '}
                            <strong className="text-[#080e2b]">
                              {formatPaise(trip.backhaulDecision.expectedReturnRevenuePaise)}
                            </strong>
                          </p>
                        </div>
                      ) : (
                        <p>
                          {trip.backhaulDecision?.reason ??
                            'Scheduled empty return — no return backhaul cargo allocated for this window.'}
                        </p>
                      )}

                      {trip.backhaulDecision?.evaluatedAt ? (
                        <p className="text-[10px] text-[#5c6b94]">
                          Last updated:{' '}
                          {new Date(trip.backhaulDecision.evaluatedAt).toLocaleString('en-IN')}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

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
} from '../../api/client';
import { Tier2ApplicationPortalCard } from '../../components/driver/Tier2ApplicationPortalCard';
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-slate-900">
            {isTier2Approved ? 'Marketplace & Trips' : 'Assigned Trips'}
          </h1>
          <p className="text-xs text-slate-500">
            {isTier2Approved
              ? 'Tier 2 Independent Marketplace • Cached offline in IndexedDB'
              : 'Mobile PWA • Cached offline in IndexedDB'}
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

      {isTier2Approved ? (
        <Card className="border-emerald-200">
          <CardHeader className="flex items-center justify-between border-b border-slate-100 py-3">
            <div className="flex items-center gap-2">
              <Truck className="h-4 w-4 text-emerald-700" />
              <h2 className="text-sm font-bold text-slate-900">
                Marketplace Trip Opportunities
              </h2>
            </div>
            <Badge variant="info">{totalAvailableOpps} available</Badge>
          </CardHeader>
          <CardContent className="space-y-3 pt-3">
            {marketplaceQuery.isLoading ? (
              <p className="text-xs text-slate-500">Checking eligible marketplace trips...</p>
            ) : totalAvailableOpps === 0 ? (
              <p className="text-xs text-slate-500">
                No open Tier 2 marketplace opportunities right now. Assigned trips appear below.
              </p>
            ) : (
              <>
                {hybridOpportunities.map((mOpp) => {
                  const isExpanded = expandedOppId === mOpp.id;
                  return (
                    <div
                      key={mOpp.id}
                      className="space-y-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 text-xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold text-emerald-800">
                              {mOpp.opportunityCode}
                            </span>
                            <Badge variant="info">{mOpp.opportunityType}</Badge>
                            {mOpp.driverOfferStatus ? (
                              <Badge variant="neutral">{mOpp.driverOfferStatus}</Badge>
                            ) : null}
                          </div>
                          <p className="mt-0.5 font-semibold text-slate-900">
                            {mOpp.originLabel} → {mOpp.destinationLabel}
                          </p>
                          <p className="text-[11px] text-slate-600">
                            {mOpp.stopsSummary.map((st) => st.name).join(' → ')}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase text-slate-500">Fixed Spot Payout</p>
                          <p className="text-sm font-bold text-emerald-700">
                            {formatPaise(mOpp.payoutQuote.spotPayoutPaise)}
                          </p>
                        </div>
                      </div>

                      <div className="grid grid-cols-3 gap-2 rounded bg-white p-2 text-[11px] text-slate-700">
                        <div>
                          <span className="text-slate-400">Cargo:</span>{' '}
                          <strong>{mOpp.cargoSummary.totalWeightKg} kg</strong> ({mOpp.cargoSummary.totalVolumeCbm} m³)
                        </div>
                        <div>
                          <span className="text-slate-400">Est. Route:</span>{' '}
                          <strong>{mOpp.estimatedDistanceKm} km</strong> ({mOpp.estimatedDurationMin} min)
                        </div>
                        <div>
                          <span className="text-slate-400">Expires:</span>{' '}
                          <strong>{new Date(mOpp.offerExpiresAt).toLocaleTimeString('en-IN')}</strong>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="space-y-1 rounded border border-slate-200 bg-white p-2 text-[11px] text-slate-600">
                          <p>
                            <strong>Cargo Spec:</strong> {mOpp.cargoSummary.summaryLabel} • Max item:{' '}
                            {mOpp.cargoSummary.maxUnitLengthCm}×{mOpp.cargoSummary.maxUnitWidthCm}×
                            {mOpp.cargoSummary.maxUnitHeightCm} cm
                          </p>
                          <p>
                            <strong>Pickup Deadline:</strong>{' '}
                            {new Date(mOpp.pickupDeadlineAt).toLocaleString('en-IN')} •{' '}
                            <strong>Delivery Deadline:</strong>{' '}
                            {new Date(mOpp.deliveryDeadlineAt).toLocaleString('en-IN')}
                          </p>
                          <p className="text-slate-500">
                            Shipper/recipient contact &amp; street address unlock automatically after acceptance. Fixed spot payout excludes Tier 1 guarantees.
                          </p>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            if (!isExpanded) {
                              void viewTier2MarketplaceOpportunity(mOpp.id).catch(() => undefined);
                            }
                            setExpandedOppId(isExpanded ? null : mOpp.id);
                          }}
                        >
                          {isExpanded ? 'Hide Details' : 'View Details'}
                        </Button>
                        <div className="flex items-center gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={declineMarketplaceMutation.isPending}
                            onClick={() => declineMarketplaceMutation.mutate(mOpp.id)}
                          >
                            Decline
                          </Button>
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={acceptMarketplaceMutation.isPending}
                            onClick={() => acceptMarketplaceMutation.mutate(mOpp.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            Accept Job
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {opportunities.map((opp) => (
                <div
                  key={opp._id}
                  className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-mono font-bold text-emerald-800">{opp.tripCode}</p>
                      <p className="font-semibold text-slate-900">
                        {opp.corridor ? `${opp.corridor.code} — ${opp.corridor.name}` : 'Corridor Trip'}
                      </p>
                      <p className="text-[11px] text-slate-600">
                        {opp.stopsSummary.map((st) => st.name).join(' → ')}
                      </p>
                    </div>
                    <Badge variant={opp.eligibleToAccept ? 'success' : 'warning'}>
                      {opp.isAssignedToMe ? 'OFFERED' : 'OPEN'}
                    </Badge>
                  </div>

                  <div className="grid grid-cols-3 gap-2 rounded bg-white p-2 text-[11px] text-slate-700">
                    <div>
                      <span className="text-slate-400">Cargo:</span>{' '}
                      <strong>{opp.totalChargeableWeightKg} kg</strong> ({opp.totalVolumeCbm} m³)
                    </div>
                    <div>
                      <span className="text-slate-400">Shipments:</span>{' '}
                      <strong>{opp.shipmentCount}</strong>
                    </div>
                    <div>
                      <span className="text-slate-400">Est. Payout:</span>{' '}
                      <strong className="text-emerald-700">{formatPaise(opp.estimatedPayoutPaise)}</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-500">
                      Departs: {new Date(opp.plannedDepartureAt).toLocaleString('en-IN')}
                    </span>
                    {opp.eligibleToAccept ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={acceptMarketplaceMutation.isPending}
                        onClick={() => acceptMarketplaceMutation.mutate(opp._id)}
                      >
                        <Check className="h-3.5 w-3.5" />
                        Accept Opportunity
                      </Button>
                    ) : (
                      <span className="text-[11px] font-medium text-rose-700">
                        {opp.ineligibleReason}
                      </span>
                    )}
                  </div>
                </div>
                ))}
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

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
          description="You will see corridor trips here after committing to a pooling window and receiving automated allocation upon pool closure."
        />
      ) : (
        <div className="space-y-4">
          {trips.map((trip) => {
            const isTier1Trip =
              trip.allocationEconomics?.allocatedTier === 'TIER_1' ||
              Boolean(trip.sourceCommitmentId);
            const isReadOnlyTrip =
              trip.status === 'COMPLETED' ||
              trip.status === 'CANCELLED' ||
              trip.status === 'DRIVER_REJECTED';

            // MC-054: Read schedule strictly from locked trip/commitment snapshot (never live template)
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
              <Card key={trip._id}>
                <CardHeader className="flex items-center justify-between py-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-mono text-xs font-semibold text-emerald-700">
                        {trip.tripCode}
                      </p>
                      {slotNumber ? (
                        <Badge variant="neutral">Slot {slotNumber}</Badge>
                      ) : null}
                      {trip.sourceCommitmentId ? (
                        <Badge variant="info">Allocated from Slot Commitment</Badge>
                      ) : null}
                    </div>
                    <p className="mt-0.5 text-sm font-semibold text-slate-900">
                      {trip.corridorId?.code ? `${trip.corridorId.code} — ` : ''}
                      {trip.corridorId?.name ?? 'Corridor Assignment'}
                    </p>
                  </div>
                  <Badge
                    variant={
                      trip.status === 'IN_PROGRESS' || trip.status === 'COMPLETED'
                        ? 'success'
                        : trip.status === 'PAUSED'
                          ? 'warning'
                          : trip.status === 'CANCELLED' || trip.status === 'DRIVER_REJECTED'
                            ? 'danger'
                            : 'info'
                    }
                  >
                    {trip.status}
                  </Badge>
                </CardHeader>

                <CardContent className="space-y-3 text-xs text-slate-600">
                  {/* MC-054: Locked Schedule Snapshot */}
                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5 space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1.5 font-semibold text-slate-800">
                        <CalendarClock className="h-3.5 w-3.5 text-emerald-700" />
                        Locked Trip Schedule ({serviceDateLabel})
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Snapshot • Not a guaranteed ETA
                      </span>
                    </div>
                    <div className="grid gap-2 pt-1 sm:grid-cols-3">
                      <div>
                        <span className="text-[10px] uppercase text-slate-500">Slot</span>
                        <p className="font-semibold text-slate-900">
                          {snap?.slotCode ?? trip.slotId?.slotCode ?? `Slot ${slotNumber ?? '—'}`}
                        </p>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase text-slate-500">
                          Outbound Pickup
                        </span>
                        <p className="font-semibold text-slate-900">{outboundPickupTime}</p>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase text-slate-500">
                          Return Schedule
                        </span>
                        <p className="inline-flex items-center gap-1 font-semibold text-slate-900">
                          {isLockedReturn ? <Lock className="h-3 w-3 text-amber-700" /> : null}
                          {lockedReturnTime}
                          {isLockedReturn ? ' (Locked)' : ' (Selected)'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {trip.vehicleId || trip.vehicleSnapshot ? (
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-slate-400" />
                      <span>
                        Vehicle:{' '}
                        <strong>
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

                  {/* MC-053 & MC-057: Trip Execution Controls */}
                  <div className="flex flex-wrap gap-2 border-y border-slate-100 py-2.5">
                    {/* Routine Accept/Decline ONLY for independent non-Tier-1 trips */}
                    {!isTier1Trip && trip.status === 'ASSIGNED' ? (
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

                    {/* MC-057: View Route Plan replaces Optimize & Plan */}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setRoutePlanOpenFor((prev) => ({
                          ...prev,
                          [trip._id]: !prev[trip._id],
                        }))
                      }
                    >
                      <RouteIcon className="h-3.5 w-3.5" />
                      {routePlanOpenFor[trip._id] ? 'Hide Route Plan' : 'View Route Plan'}
                    </Button>

                    {/* MC-057: Navigate to Current Stop */}
                    {!isReadOnlyTrip && currentStop ? (
                      navUrl ? (
                        <a
                          href={navUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Navigation className="h-3.5 w-3.5 text-emerald-700" />
                          Navigate to {currentStop.stopCode}
                        </a>
                      ) : (
                        <span className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2.5 text-[11px] text-slate-500">
                          Navigation unavailable for {currentStop.stopCode}
                        </span>
                      )
                    ) : null}

                    {/* MC-053 / MC-057: Pre-start Issue or In-Progress Route Issue */}
                    {isOnline && !isReadOnlyTrip ? (
                      <>
                        {trip.status === 'IN_PROGRESS' || trip.status === 'PAUSED' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setExceptionTripId(trip._id);
                              setExceptionType('ROAD_BLOCKED');
                              setExceptionReason('');
                              setExceptionShipmentId('');
                              setExceptionEvidence(null);
                            }}
                          >
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                            Report Route Issue
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
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
                        >
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                          {['ASSIGNED', 'DRIVER_ACCEPTED'].includes(trip.status)
                            ? 'Report Issue / Cannot Operate'
                            : 'Report Exception'}
                        </Button>
                      </>
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

                {trip.routePlan && routePlanOpenFor[trip._id] ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px]">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        <Navigation className="mr-1 inline h-3.5 w-3.5 text-emerald-700" />
                        Official Route v{trip.routePlan.routeVersion ?? 1} (
                        {trip.routePlan.optimizationStatus})
                      </span>
                      <span className="text-slate-500">
                        Backend Matrix: {trip.routePlan.matrixProvider}
                      </span>
                    </div>
                    {trip.routePlan.optimizationStatus === 'OPTIMAL' ? (
                      <>
                        <p className="text-slate-700">
                          Road Distance:{' '}
                          <strong>
                            {(trip.routePlan.totalDistanceMeters / 1000).toFixed(1)} km
                          </strong>{' '}
                          • Est. Drive:{' '}
                          <strong>
                            {Math.round(trip.routePlan.estimatedDurationSeconds / 60)} min
                          </strong>
                        </p>
                        {trip.routePlan.orderedStops.length > 0 ? (
                          <div className="space-y-1 border-t border-slate-200 pt-1.5">
                            {trip.routePlan.orderedStops.map((st) => (
                              <div
                                key={`${st.sequence}-${st.stopCode}`}
                                className="flex items-center justify-between text-slate-700"
                              >
                                <span>
                                  {st.sequence + 1}. <strong>{st.stopCode}</strong> — {st.name}
                                </span>
                                <span className="text-slate-500">
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
                      <div className="border-t border-slate-200 pt-1.5 text-[10px] text-slate-500">
                        <p className="inline-flex items-center gap-1 font-semibold text-slate-600">
                          <History className="h-3 w-3" /> Route Version Audit History
                        </p>
                        {trip.routePlan.routeHistory!.map((h) => (
                          <p key={h.version}>
                            v{h.version} (superseded {new Date(h.supersededAt).toLocaleString('en-IN')})
                            {h.reason ? ` — ${h.reason}` : ''}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {trip.stopsSummary?.length > 0 ? (
                  <div className="flex items-start gap-2 pt-1">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
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
                            className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700 hover:bg-slate-200"
                          >
                            {stop.sequenceOrder + 1}. {stop.name}
                            <ExternalLink className="h-2.5 w-2.5" />
                          </a>
                        );
                      })}
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
                            sh.pickupBalanceCollectedAt ? (
                              <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-emerald-900">
                                <span className="font-semibold">
                                  Pickup Balance Collected:{' '}
                                  {formatPaise(sh.pricingSnapshot?.remainingBalancePaise)}
                                </span>
                                <Badge variant="success">COLLECTED (Distinct from Settlement)</Badge>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 p-2">
                                <div>
                                  <p className="font-semibold text-sky-950">
                                    Pickup Balance Due:{' '}
                                    {formatPaise(sh.pricingSnapshot?.remainingBalancePaise)}
                                  </p>
                                  <p className="text-[10px] text-sky-800">
                                    Simulated collection record — distinct from driver payout/settlement
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
                                  >
                                    <CreditCard className="h-3 w-3" />
                                    Record Collection
                                  </Button>
                                </div>
                              </div>
                            )
                          ) : null}

                          {/* MC-056: Inline QR Pickup Verification for LOCKED shipments */}
                          {sh.status === 'LOCKED' && isOnline && !isReadOnlyTrip ? (
                            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/70 p-2">
                              <QrCode className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                              <input
                                value={qrInputs[sh._id] ?? ''}
                                onChange={(e) =>
                                  setQrInputs((prev) => ({ ...prev, [sh._id]: e.target.value }))
                                }
                                placeholder={`Verify pickup QR at ${sh.pickupStopCode ?? 'origin'}...`}
                                className="min-w-[160px] flex-1 rounded border border-emerald-300 bg-white px-2 py-1 font-mono text-[11px]"
                              />
                              <Button
                                size="sm"
                                variant="primary"
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
                                        err instanceof Error ? err.message : 'QR verification failed'
                                      )
                                    );
                                }}
                              >
                                Verify Pickup QR
                              </Button>
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

                            {['PICKED_UP', 'IN_TRANSIT', 'AT_DESTINATION'].includes(sh.status) &&
                            isOnline ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setExceptionTripId(trip._id);
                                  setExceptionShipmentId(sh._id);
                                  setExceptionType('CUSTOMER_UNAVAILABLE');
                                  setExceptionReason('');
                                  setExceptionEvidence(null);
                                }}
                              >
                                <AlertTriangle className="h-3 w-3 text-amber-600" />
                                Report Failed Delivery
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

                              <div className="space-y-1.5">
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
                                {podPhotos[sh._id] ? (
                                  <label className="flex items-center gap-1.5 text-[10px] text-slate-600">
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

                {/* MC-055: LIFO Manifest + 2D Truck-Bed Visualizer using registered vehicle dims */}
                <div className="space-y-3 pt-1">
                  <TruckBedVisualizer
                    bedDimensionsCm={effectiveBedDims}
                    vehicleLabel={effectiveVehicleReg}
                    loadingPlan={trip.loadingPlan}
                  />

                  {trip.loadingPlan && trip.loadingPlan.sequenceItems.length > 0 ? (
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

                {/* MC-054: Return Plan (always renders explicit scheduled or empty return state) */}
                <div className="space-y-1.5 rounded-lg border border-sky-200 bg-sky-50 p-3 text-[11px] text-sky-950">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">
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
                          Return Cargo ({trip.backhaulDecision.returnShipmentCount ?? 1} shipment):{' '}
                          <strong>{trip.backhaulDecision.returnCargoSummary}</strong>
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
                        <strong>
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
                    <p className="text-[10px] text-sky-800">
                      Last updated: {new Date(trip.backhaulDecision.evaluatedAt).toLocaleString('en-IN')}
                    </p>
                  ) : null}
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

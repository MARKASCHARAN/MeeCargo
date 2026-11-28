import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  PackagePlus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  cancelShipment,
  exportShipmentsCsv,
  fetchCorridors,
  fetchShipmentExceptions,
  fetchShipments,
  payShipmentToken,
  resolveShipmentException,
  submitViabilityDecision,
} from '@/api/client';
import { ShipmentQrCode } from '@/components/shipments/ShipmentQrCode';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { formatPaise } from '@/lib/format';
import type { ExceptionRecord } from '@/types/api';

export function ShipmentsHistoryPage() {
  const queryClient = useQueryClient();
  const [rolloverTargets, setRolloverTargets] = useState<Record<string, string>>({});
  const [shipmentExceptions, setShipmentExceptions] = useState<Record<string, ExceptionRecord[]>>(
    {}
  );
  const [expandedExceptionShipmentId, setExpandedExceptionShipmentId] = useState<string | null>(
    null
  );
  const [rescheduleSlots, setRescheduleSlots] = useState<Record<string, string>>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [statusGroup, setStatusGroup] = useState<string>('');
  const [corridorFilter, setCorridorFilter] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  const shipmentsQuery = useQuery({
    queryKey: ['shipments', statusGroup, corridorFilter, fromDate, toDate],
    queryFn: () =>
      fetchShipments({
        statusGroup: statusGroup || undefined,
        corridorId: corridorFilter || undefined,
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
      }),
  });

  const corridorsQuery = useQuery({
    queryKey: ['corridors'],
    queryFn: fetchCorridors,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    void queryClient.invalidateQueries({ queryKey: ['pools'] });
    void queryClient.invalidateQueries({ queryKey: ['corridors'] });
  };

  useEffect(() => {
    const apiOrigin = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(apiOrigin, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });
    socket.on('shipments:changed', () => {
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    });
    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  const payMutation = useMutation({
    mutationFn: (shipmentId: string) =>
      payShipmentToken(shipmentId, {
        idempotencyKey: `pay_${shipmentId}_${Date.now()}`,
        simulateOutcome: 'SUCCESS',
      }),
    onSuccess: (res) => {
      setActionMsg(
        `Simulated token payment (${res.payment.providerRef}) succeeded and shipment joined pool.`
      );
      invalidateAll();
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (shipmentId: string) =>
      cancelShipment(shipmentId, 'Cancelled by shipper from dashboard'),
    onSuccess: (res) => {
      setActionMsg(
        res.refund
          ? `Shipment cancelled and token refunded (${res.refund.refundReference}).`
          : 'Shipment cancelled.'
      );
      invalidateAll();
    },
  });

  const viabilityMutation = useMutation({
    mutationFn: ({
      shipmentId,
      decision,
      targetServiceDate,
    }: {
      shipmentId: string;
      decision: 'ROLLOVER' | 'REFUND';
      targetServiceDate?: string;
    }) => submitViabilityDecision(shipmentId, { decision, targetServiceDate }),
    onSuccess: (res) => {
      setActionMsg(
        res.decision === 'ROLLOVER'
          ? 'Shipment rolled over to selected future service date with your consent.'
          : 'Full token refund issued for non-viable new route.'
      );
      invalidateAll();
    },
  });

  if (shipmentsQuery.isLoading) {
    return <LoadingState title="Loading your shipments..." />;
  }

  if (shipmentsQuery.isError) {
    return (
      <ErrorState
        title="Could not load shipments"
        description={shipmentsQuery.error.message}
        onRetry={() => void shipmentsQuery.refetch()}
      />
    );
  }

  const shipments = shipmentsQuery.data?.shipments ?? [];
  const corridors = corridorsQuery.data?.corridors ?? [];

  return (
    <div className="space-y-6">
      {/* Obsidian Hero Header */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#8ea5e2]">
              Shipment Ledger &amp; Recovery
            </p>
            <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[36px]">
              Shipments &amp;{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                style={{ fontStyle: 'italic' }}
              >
                bookings.
              </em>
            </h1>
            <p className="mt-1 text-xs text-[#a8b5d6] sm:text-sm">
              Scoped exclusively to your B2B business ownership. Payments shown are simulated.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void exportShipmentsCsv({
                  statusGroup: statusGroup || undefined,
                  corridorId: corridorFilter || undefined,
                  fromDate: fromDate || undefined,
                  toDate: toDate || undefined,
                }).then((csv) => {
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'meecargo-shipments-export.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                });
              }}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white transition hover:border-white/30 hover:bg-white/12"
            >
              <Download className="h-3.5 w-3.5 text-[#82a2ff]" />
              Export CSV
            </button>
            <Link
              to="/shipper/import"
              className="inline-flex items-center rounded-full border border-white/15 bg-white/[0.06] px-4 py-2 text-xs font-medium text-white transition hover:border-white/30 hover:bg-white/12"
            >
              Import CSV
            </Link>
            <Link
              to="/shipper/book"
              className="inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-xs font-semibold text-[#080b14] shadow-xs transition hover:-translate-y-0.5 hover:bg-[#eef3ff]"
            >
              <PackagePlus className="h-3.5 w-3.5 text-[#4673eb]" />
              New Booking
            </Link>
          </div>
        </div>
      </section>

      {/* Filters */}
      <div className="orbit-reveal-2 grid gap-3 rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-xs sm:grid-cols-4">
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[#4d5a83]">
            Status Group
          </label>
          <select
            value={statusGroup}
            onChange={(e) => setStatusGroup(e.target.value)}
            className="orbit-input-dark py-2 text-xs"
          >
            <option value="">All Shipments</option>
            <option value="UPCOMING">Upcoming (Pending / Confirmed / Pooled / Locked)</option>
            <option value="ACTIVE">Active (Picked Up / In Transit / At Destination)</option>
            <option value="DELIVERED">Delivered</option>
            <option value="FAILED">Failed</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="ROLLED_OVER">Rolled Over</option>
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[#4d5a83]">Corridor</label>
          <select
            value={corridorFilter}
            onChange={(e) => setCorridorFilter(e.target.value)}
            className="orbit-input-dark py-2 text-xs"
          >
            <option value="">All Corridors</option>
            {corridors.map((c) => (
              <option key={c._id} value={c._id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[#4d5a83]">From Date</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="orbit-input-dark py-2 text-xs"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-[11px] font-medium text-[#4d5a83]">To Date</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="orbit-input-dark py-2 text-xs"
          />
        </div>
      </div>

      {actionMsg ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-900">
          {actionMsg}
        </div>
      ) : null}

      {shipments.length === 0 ? (
        <EmptyState
          title="No shipments booked yet"
          description="Create a single booking or bulk import orders via CSV."
          action={
            <Link
              to="/shipper/book"
              className="inline-flex items-center gap-1.5 rounded-2xl bg-[#080b14] px-4 py-2 text-xs font-semibold text-white"
            >
              Book First Shipment
            </Link>
          }
        />
      ) : (
        <div className="orbit-reveal-3 space-y-5">
          {shipments.map((s) => {
            const corridorIdStr =
              typeof s.corridorId === 'object' ? s.corridorId._id : s.corridorId;
            const corridorName =
              typeof s.corridorId === 'object' ? s.corridorId.name : 'Corridor';
            const slotObj = typeof s.slotId === 'object' ? s.slotId : null;
            const serviceDateRaw = slotObj?.departureDate ?? slotObj?.plannedDepartureAt;
            const serviceDateKey = serviceDateRaw
              ? new Date(serviceDateRaw).toISOString().slice(0, 10)
              : '';
            const serviceDateLabel = serviceDateRaw
              ? new Date(serviceDateRaw).toLocaleDateString('en-IN', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : 'Scheduled Dispatch';

            const futureServiceDates =
              corridors
                .find((c) => c._id === corridorIdStr)
                ?.serviceDates?.filter(
                  (sd) => sd.bookable && sd.serviceDate !== serviceDateKey
                ) ?? [];

            const selectedRolloverDate =
              rolloverTargets[s._id] ?? futureServiceDates[0]?.serviceDate ?? '';

            const pricing = s.pricingSnapshot;

            return (
              <article
                key={s._id}
                className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_18px_50px_-28px_rgba(8,11,20,0.18)]"
              >
                <div className="flex flex-col gap-3 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-[#080b14] px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                        {s.reference}
                      </span>
                      {s.externalOrderRef ? (
                        <Badge variant="neutral">Ref: {s.externalOrderRef}</Badge>
                      ) : null}
                      <Badge
                        variant={
                          s.status === 'LOCKED' || s.status === 'POOLED'
                            ? 'success'
                            : s.status === 'CANCELLED'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {s.status}
                      </Badge>
                      <Badge variant="info">Token: {s.tokenStatus}</Badge>
                      {pricing?.isAnchorEligible ? (
                        <Badge variant="success">
                          <Award className="h-3 w-3" />
                          Anchor Reward
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-1.5 text-xs text-[#5c6b94]">
                      {corridorName} • Service Date:{' '}
                      <strong className="text-[#080b14]">{serviceDateLabel}</strong>
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {s.status === 'PENDING_TOKEN' ? (
                      <button
                        type="button"
                        disabled={payMutation.isPending}
                        onClick={() => payMutation.mutate(s._id)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#080b14] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#192038] disabled:opacity-50"
                      >
                        <CreditCard className="h-3.5 w-3.5 text-[#82a2ff]" />
                        Pay Token (Simulated)
                      </button>
                    ) : null}

                    {['PENDING_TOKEN', 'CONFIRMED', 'POOLED'].includes(s.status) ? (
                      <button
                        type="button"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(s._id)}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#d5ddf0] bg-white px-3 py-2 text-xs font-medium text-[#080b14] transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel &amp; Refund
                      </button>
                    ) : null}

                    <Link
                      to={`/track/${s.trackingToken}`}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#d5ddf0] bg-white px-3.5 py-2 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-[#4673eb]" />
                      Recipient Link
                    </Link>
                  </div>
                </div>

                <div className="space-y-4 p-6">
                  <div className="grid gap-3 text-xs text-[#5c6b94] sm:grid-cols-4">
                    <div>
                      <span className="text-[11px] text-[#7a87aa]">Route Stops</span>
                      <p className="mt-0.5 font-semibold text-[#080b14]">
                        {s.pickupStopCode} → {s.deliveryStopCode}
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#7a87aa]">Recipient</span>
                      <p className="mt-0.5 font-semibold text-[#080b14]">
                        {s.recipientName} ({s.deliveryAddress.villageOrTown})
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#7a87aa]">Cargo &amp; Chargeable Wt</span>
                      <p className="mt-0.5 font-semibold text-[#080b14]">
                        {s.cargo.quantity}× {s.cargo.category} • {s.cargo.chargeableWeightKg} kg (
                        {s.cargo.billingBasis})
                      </p>
                    </div>
                    <div>
                      <span className="text-[11px] text-[#7a87aa]">Volume (separate)</span>
                      <p className="mt-0.5 font-semibold text-[#080b14]">{s.cargo.volumeCbm} m³</p>
                    </div>
                  </div>

                  {s.qrToken && !['CANCELLED', 'DRAFT'].includes(s.status) ? (
                    <ShipmentQrCode qrToken={s.qrToken} reference={s.reference} />
                  ) : null}

                  {pricing ? (
                    <div className="grid gap-3 rounded-2xl border border-[#1d2542] bg-[#080b14] p-4 text-xs text-white sm:grid-cols-5">
                      <div>
                        <span className="text-[#9aa7c7]">Rate Ceiling</span>
                        <p className="mt-0.5 font-semibold">
                          {formatPaise(pricing.ceilingPricePaise)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[#9aa7c7]">
                          {pricing.finalLockedPricePaise !== undefined
                            ? 'Final Locked Price'
                            : 'Projected (Non-Final)'}
                        </span>
                        <p className="mt-0.5 font-bold">
                          {formatPaise(
                            pricing.finalLockedPricePaise ?? pricing.projectedPricePaise
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-[#9aa7c7]">Discounts (Pool + Anchor)</span>
                        <p className="mt-0.5 font-semibold text-emerald-400">
                          -{formatPaise(pricing.poolDiscountPaise + pricing.anchorDiscountPaise)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[#9aa7c7]">Token Paid (Simulated)</span>
                        <p className="mt-0.5 font-semibold">
                          {formatPaise(pricing.tokenPaidPaise)}
                        </p>
                      </div>
                      <div>
                        <span className="text-[#9aa7c7]">Pickup Balance</span>
                        <p className="mt-0.5 font-bold text-[#82a2ff]">
                          {formatPaise(pricing.remainingBalancePaise)}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {s.pickupCollectionSummary ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#cddbfa] bg-[#eef3ff] px-4 py-2.5 text-xs text-[#080b14]">
                      <span>
                        Pickup Balance Collected:{' '}
                        <strong>
                          {formatPaise(s.pickupCollectionSummary.collectedAmountPaise)}
                        </strong>{' '}
                        ({s.pickupCollectionSummary.paymentMethod} •{' '}
                        {s.pickupCollectionSummary.providerRef})
                      </span>
                      <Badge variant="info">
                        Collection: {s.pickupCollectionSummary.collectionState} / Settlement:{' '}
                        {s.pickupCollectionSummary.settlementState}
                      </Badge>
                    </div>
                  ) : null}

                  {s.podSummary ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs text-emerald-950">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        <span>
                          POD Verified ({s.podSummary.confirmationMode}) at{' '}
                          {new Date(s.podSummary.verifiedAt).toLocaleString()}
                          {s.podSummary.b2bSignOffName
                            ? ` • Signed by ${s.podSummary.b2bSignOffName}`
                            : ''}
                        </span>
                      </div>
                      {s.podSummary.photoUrl ? (
                        <a
                          href={s.podSummary.photoUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-semibold underline"
                        >
                          View POD Photo
                        </a>
                      ) : null}
                    </div>
                  ) : null}

                  {s.viabilityDecision === 'PENDING_CHOICE' ? (
                    <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-xs">
                      <div className="flex items-start gap-2 text-amber-950">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-semibold">
                            Action Required: New Route Below Minimum Viability Threshold
                          </p>
                          <p className="mt-0.5 text-amber-900">
                            No trip was created. Choose whether to roll over your shipment to a
                            future service date or receive a full token refund.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {futureServiceDates.length > 0 ? (
                          <>
                            <select
                              value={selectedRolloverDate}
                              onChange={(e) =>
                                setRolloverTargets((prev) => ({
                                  ...prev,
                                  [s._id]: e.target.value,
                                }))
                              }
                              className="rounded-xl border border-amber-300 bg-white px-3 py-1.5 text-xs text-[#080b14]"
                            >
                              {futureServiceDates.map((sd) => (
                                <option key={sd.serviceDate} value={sd.serviceDate}>
                                  {new Date(sd.departureDate ?? sd.serviceDate).toLocaleDateString(
                                    'en-IN',
                                    {
                                      weekday: 'short',
                                      day: '2-digit',
                                      month: 'short',
                                      year: 'numeric',
                                    }
                                  )}{' '}
                                  ({sd.availableWeightKg.toFixed(0)} kg free)
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              disabled={viabilityMutation.isPending}
                              onClick={() =>
                                viabilityMutation.mutate({
                                  shipmentId: s._id,
                                  decision: 'ROLLOVER',
                                  targetServiceDate: selectedRolloverDate,
                                })
                              }
                              className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#080b14] px-3.5 py-2 text-xs font-semibold text-white"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Consent &amp; Roll Over
                            </button>
                          </>
                        ) : (
                          <span className="text-amber-900">
                            No future bookable service dates available for rollover.
                          </span>
                        )}

                        <button
                          type="button"
                          disabled={viabilityMutation.isPending}
                          onClick={() =>
                            viabilityMutation.mutate({
                              shipmentId: s._id,
                              decision: 'REFUND',
                            })
                          }
                          className="cursor-pointer rounded-xl bg-rose-600 px-3.5 py-2 text-xs font-semibold text-white"
                        >
                          Request Full Token Refund
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {[
                    'FAILED',
                    'PARTIALLY_DELIVERED',
                    'RETURNED',
                    'LOCKED',
                    'PICKED_UP',
                    'IN_TRANSIT',
                    'AT_DESTINATION',
                  ].includes(s.status) ? (
                    <div className="space-y-2.5 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-[#080b14]">
                          Delivery Exceptions &amp; Recovery Actions
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const nextId =
                              expandedExceptionShipmentId === s._id ? null : s._id;
                            setExpandedExceptionShipmentId(nextId);
                            if (nextId) {
                              void fetchShipmentExceptions(s._id)
                                .then((res) =>
                                  setShipmentExceptions((prev) => ({
                                    ...prev,
                                    [s._id]: res.exceptions,
                                  }))
                                )
                                .catch(() => undefined);
                            }
                          }}
                          className="cursor-pointer rounded-xl border border-[#d5ddf0] bg-white px-3 py-1.5 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]"
                        >
                          {expandedExceptionShipmentId === s._id
                            ? 'Hide Exceptions'
                            : 'Check Exceptions'}
                        </button>
                      </div>

                      {expandedExceptionShipmentId === s._id ? (
                        <div className="space-y-2 pt-1">
                          {(shipmentExceptions[s._id] ?? []).length === 0 ? (
                            <p className="text-[#5c6b94]">
                              No delivery or route exceptions recorded for this shipment.
                            </p>
                          ) : (
                            (shipmentExceptions[s._id] ?? []).map((ex) => (
                              <div
                                key={ex._id}
                                className="space-y-2 rounded-xl border border-rose-200 bg-white p-3"
                              >
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-semibold text-rose-950">
                                    {ex.exceptionType}: {ex.reason}
                                  </span>
                                  <Badge
                                    variant={ex.resolutionStatus === 'OPEN' ? 'warning' : 'success'}
                                  >
                                    {ex.resolutionStatus}
                                  </Badge>
                                </div>
                                {ex.resolutionStatus === 'OPEN' ? (
                                  <div className="flex flex-wrap items-center gap-2">
                                    {futureServiceDates.length > 0 ? (
                                      <>
                                        <select
                                          value={
                                            rescheduleSlots[ex._id] ??
                                            futureServiceDates[0]?.serviceDate ??
                                            ''
                                          }
                                          onChange={(e) =>
                                            setRescheduleSlots((prev) => ({
                                              ...prev,
                                              [ex._id]: e.target.value,
                                            }))
                                          }
                                          className="rounded-xl border border-[#d5ddf0] bg-[#f8faff] px-2.5 py-1.5 text-xs text-[#080b14]"
                                        >
                                          {futureServiceDates.map((sd) => (
                                            <option key={sd.serviceDate} value={sd.serviceDate}>
                                              {new Date(
                                                sd.departureDate ?? sd.serviceDate
                                              ).toLocaleDateString('en-IN', {
                                                weekday: 'short',
                                                day: '2-digit',
                                                month: 'short',
                                                year: 'numeric',
                                              })}{' '}
                                              ({sd.availableWeightKg.toFixed(0)} kg free)
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const targetServiceDate =
                                              rescheduleSlots[ex._id] ??
                                              futureServiceDates[0]?.serviceDate;
                                            void resolveShipmentException(ex._id, {
                                              action: 'RESCHEDULE',
                                              targetServiceDate,
                                              note: 'Rescheduled from shipper console',
                                            }).then(() => {
                                              setActionMsg(
                                                `Shipment ${s.reference} rescheduled to selected service date.`
                                              );
                                              invalidateAll();
                                              return fetchShipmentExceptions(s._id).then((r) =>
                                                setShipmentExceptions((prev) => ({
                                                  ...prev,
                                                  [s._id]: r.exceptions,
                                                }))
                                              );
                                            });
                                          }}
                                          className="cursor-pointer rounded-xl bg-[#080b14] px-3 py-1.5 text-xs font-semibold text-white"
                                        >
                                          Reschedule Date
                                        </button>
                                      </>
                                    ) : null}
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void resolveShipmentException(ex._id, {
                                          action: 'RETURN',
                                          note: 'Returned to shipper',
                                        }).then(() => {
                                          setActionMsg(
                                            `Shipment ${s.reference} marked RETURNED.`
                                          );
                                          invalidateAll();
                                          return fetchShipmentExceptions(s._id).then((r) =>
                                            setShipmentExceptions((prev) => ({
                                              ...prev,
                                              [s._id]: r.exceptions,
                                            }))
                                          );
                                        });
                                      }}
                                      className="cursor-pointer rounded-xl bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
                                    >
                                      Mark Returned
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            ))
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

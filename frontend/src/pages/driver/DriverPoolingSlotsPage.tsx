import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  Calendar,
  CalendarClock,
  CheckCircle2,
  Clock,
  Info,
  Lock,
  Route as RouteIcon,
  XCircle,
} from 'lucide-react';
import {
  commitDriverPoolingSlot,
  fetchDriverPoolingSlots,
  withdrawDriverPoolingSlot,
} from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { cn } from '@/lib/cn';
import type {
  DriverPoolingSlotItem,
  DriverSlotCommitmentStatus,
  DriverWindowConflictDetail,
} from '@/types/api';

function formatTime12h(hhmm?: string): string {
  if (!hhmm) return '—';
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return hhmm;
  const h24 = Number(match[1]);
  const mins = match[2];
  const period = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${String(h12).padStart(2, '0')}:${mins} ${period}`;
}

function getPeriodDescriptor(hhmm?: string): 'morning' | 'afternoon' | 'evening' {
  const match = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? '').trim());
  if (!match) return 'afternoon';
  const hour = Number(match[1]);
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

function formatDeadlineCountdown(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'Closed';
  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}

function formatPoolStatusLabel(status?: string): string {
  switch (status) {
    case 'OPEN':
      return 'Open';
    case 'LOCKING':
      return 'Locking';
    case 'LOCKED':
      return 'Locked';
    case 'CANCELLED':
    case 'COMPLETED':
      return 'Closed';
    case 'AWAITING_VIABILITY_DECISION':
      return 'Review';
    default:
      return 'Open';
  }
}

function formatActivityStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function getCommitmentVariant(
  status: DriverSlotCommitmentStatus | string
): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ALLOCATED':
    case 'COMMITTED':
      return 'success';
    case 'LOCKED':
      return 'warning';
    case 'INVALIDATED':
    case 'CANCELLED':
      return 'danger';
    case 'NOT_ALLOCATED':
    case 'WITHDRAWN':
    default:
      return 'neutral';
  }
}

interface CorridorDateGroup {
  dateKey: string;
  departureDate: string;
  slots: DriverPoolingSlotItem[];
}

interface CorridorPoolingGroup {
  corridorId: string;
  code: string;
  name: string;
  stops: DriverPoolingSlotItem['corridor']['stops'];
  dates: CorridorDateGroup[];
}

function buildFriendlyConflictCopy(
  detail?: DriverWindowConflictDetail | null,
  fallback?: string | null
) {
  if (!detail) {
    return {
      reason: fallback ?? 'This trip overlaps with another active commitment.',
      breakNote: 'Allow a 30-minute break between trips.',
      resolution: 'Change or withdraw your conflicting commitment to become available.',
      manageSlotId: undefined as string | undefined,
      actionLabel: 'Manage conflicting trip',
    };
  }

  const period = getPeriodDescriptor(detail.pickupTime);
  const interval = `${formatTime12h(detail.pickupTime)}–${formatTime12h(detail.returnTime)}`;
  const reason =
    detail.sourceType === 'COMMITMENT'
      ? `You already committed to the ${period} trip (${interval}). The two trips overlap.`
      : `You are assigned to trip ${detail.tripCode ?? ''} (${interval}). The two trips overlap.`;

  return {
    reason,
    breakNote: `Allow a ${detail.turnaroundBufferMin}-minute break between trips.`,
    resolution:
      detail.sourceType === 'COMMITMENT'
        ? `Change or withdraw your ${period} commitment to become available.`
        : 'Complete or reassign your active trip to open this window.',
    manageSlotId: detail.sourceType === 'COMMITMENT' ? detail.slotId : undefined,
    actionLabel:
      detail.sourceType === 'COMMITMENT' ? `Manage ${period} trip` : 'View active trip',
  };
}

export function DriverPoolingSlotsPage() {
  const queryClient = useQueryClient();
  const [returnDrafts, setReturnDrafts] = useState<Record<string, string>>({});
  const [highlightedSlotId, setHighlightedSlotId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const poolingQuery = useQuery({
    queryKey: ['driver-pooling-slots'],
    queryFn: fetchDriverPoolingSlots,
  });

  const commitMutation = useMutation({
    mutationFn: ({ slot, returnTime }: { slot: DriverPoolingSlotItem; returnTime?: string }) =>
      commitDriverPoolingSlot(slot.slotId, returnTime),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        `Trip confirmed: Pickup ${formatTime12h(res.commitment.selectedPickupTime)} • Return ${formatTime12h(
          res.commitment.selectedReturnTime
        )}.`
      );
      void queryClient.invalidateQueries({ queryKey: ['driver-pooling-slots'] });
    },
    onError: (err) => {
      setBanner(null);
      setErrorBanner(err instanceof Error ? err.message : 'Unable to commit trip availability');
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (slotId: string) => withdrawDriverPoolingSlot(slotId),
    onSuccess: () => {
      setErrorBanner(null);
      setBanner('Trip availability withdrawn.');
      void queryClient.invalidateQueries({ queryKey: ['driver-pooling-slots'] });
    },
    onError: (err) => {
      setBanner(null);
      setErrorBanner(err instanceof Error ? err.message : 'Unable to withdraw commitment');
    },
  });

  const groupedCorridors = useMemo<CorridorPoolingGroup[]>(() => {
    const rawSlots = poolingQuery.data?.slots ?? [];
    const byCorridor = new Map<
      string,
      {
        corridor: DriverPoolingSlotItem['corridor'];
        byDate: Map<string, DriverPoolingSlotItem[]>;
      }
    >();

    for (const slot of rawSlots) {
      const cId = slot.corridor._id;
      let cEntry = byCorridor.get(cId);
      if (!cEntry) {
        cEntry = {
          corridor: slot.corridor,
          byDate: new Map<string, DriverPoolingSlotItem[]>(),
        };
        byCorridor.set(cId, cEntry);
      }
      const dateKey = new Date(slot.departureDate).toISOString().slice(0, 10);
      const list = cEntry.byDate.get(dateKey) ?? [];
      list.push(slot);
      cEntry.byDate.set(dateKey, list);
    }

    return Array.from(byCorridor.entries())
      .sort((a, b) => a[1].corridor.code.localeCompare(b[1].corridor.code))
      .map(([corridorId, entry]) => ({
        corridorId,
        code: entry.corridor.code,
        name: entry.corridor.name,
        stops: entry.corridor.stops.slice().sort((a, b) => a.sequenceOrder - b.sequenceOrder),
        dates: Array.from(entry.byDate.entries())
          .sort(([da], [db]) => da.localeCompare(db))
          .map(([dateKey, slots]) => ({
            dateKey,
            departureDate: slots[0].departureDate,
            slots: slots.slice().sort((a, b) => a.slotNumber - b.slotNumber),
          })),
      }));
  }, [poolingQuery.data?.slots]);

  const historicalCommitments = useMemo(() => {
    const data = poolingQuery.data;
    if (!data) return [];
    const activeUpcomingSlotIds = new Set(data.slots.map((s) => s.slotId));
    return data.commitments.filter((c) => {
      const cSlotId = typeof c.slotId === 'string' ? c.slotId : c.slotId._id;
      const isShownAbove =
        activeUpcomingSlotIds.has(cSlotId) &&
        (c.status === 'COMMITTED' || c.status === 'LOCKED');
      return !isShownAbove;
    });
  }, [poolingQuery.data]);

  const scrollToConflictingSlot = (targetSlotId: string) => {
    const el = document.getElementById(`driver-slot-${targetSlotId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setHighlightedSlotId(targetSlotId);
      setTimeout(() => {
        setHighlightedSlotId((prev) => (prev === targetSlotId ? null : prev));
      }, 2400);
    }
  };

  if (poolingQuery.isLoading) {
    return <LoadingState title="Loading available trips..." />;
  }

  if (poolingQuery.isError || !poolingQuery.data) {
    return (
      <ErrorState
        description={
          poolingQuery.error instanceof Error
            ? poolingQuery.error.message
            : 'Failed to load available trips.'
        }
        onRetry={() => void poolingQuery.refetch()}
      />
    );
  }

  const data = poolingQuery.data;

  return (
    <div className="space-y-6">
      {/* Orbit Editorial Header */}
      <section className="orbit-reveal-1 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_18px_55px_-28px_rgba(24,60,115,0.22)] sm:p-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#7a94df]">
          Scheduled Corridor Availability
        </p>
        <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-[#080e2b] sm:text-[36px]">
          Choose your{' '}
          <em
            className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
            style={{ fontStyle: 'italic' }}
          >
            trips.
          </em>
        </h1>
        <p className="mt-1.5 text-xs text-[#5c6b94] sm:text-sm">
          Select the departure windows you&apos;re available to drive. Confirm return preference
          before the pool cutoff time.
        </p>
      </section>

      {banner && (
        <div className="orbit-reveal-1 flex items-center gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{banner}</span>
        </div>
      )}
      {errorBanner && (
        <div className="orbit-reveal-1 flex items-center gap-2.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      )}

      {!data.eligible ? (
        <div className="rounded-[28px] border border-[#dce5fa] bg-white/95 p-10 text-center shadow-xs">
          <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-amber-500" />
          <p className="text-base font-semibold text-[#080e2b]">Not Eligible for Trips</p>
          <p className="mt-1 text-xs text-[#5c6b94]">{data.ineligibleReason}</p>
        </div>
      ) : groupedCorridors.length === 0 ? (
        <EmptyState
          title="No upcoming trips open right now"
          description="Check back when new trip dates open before cutoff."
        />
      ) : (
        <div className="orbit-reveal-2 space-y-6">
          {groupedCorridors.map((corridorGroup) => (
            <section
              key={corridorGroup.corridorId}
              className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_60px_-28px_rgba(24,60,115,0.22)]"
            >
              <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-5 py-4 sm:px-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-[#cddbfa] bg-white px-2.5 py-0.5 font-mono text-xs font-bold text-[#3563e4]">
                    {corridorGroup.code}
                  </span>
                  <span
                    title="Contracts let you choose trips dynamically before cutoff."
                    className="inline-flex cursor-help items-center gap-1 rounded-full border border-[#dce5fa] bg-white px-3 py-0.5 text-[11px] font-medium text-[#5c6b94]"
                  >
                    <Info className="h-3 w-3 text-[#4673eb]" />
                    Trip selection open
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-semibold text-[#080e2b] sm:text-xl">
                  {corridorGroup.name}
                </h2>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[#5c6b94]">
                  <RouteIcon className="h-3.5 w-3.5 shrink-0 text-[#4673eb]" />
                  {corridorGroup.stops.map((stop, idx, arr) => (
                    <span key={stop.stopCode} className="font-medium text-[#4d5a83]">
                      {stop.name}
                      {idx < arr.length - 1 ? ' → ' : ''}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-6 p-5 sm:p-7">
                {corridorGroup.dates.map((dateGroup) => {
                  const openPickupCount = dateGroup.slots.filter(
                    (s) => s.availabilityState !== 'UNAVAILABLE_SCHEDULE_CONFLICT'
                  ).length;

                  return (
                    <div key={dateGroup.dateKey} className="space-y-4">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-2.5 text-xs">
                        <div className="flex items-center gap-2 font-semibold text-[#080e2b]">
                          <Calendar className="h-4 w-4 text-[#4673eb]" />
                          <span>
                            {new Date(dateGroup.departureDate).toLocaleDateString('en-IN', {
                              weekday: 'short',
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-[#5c6b94]">
                          {openPickupCount} of {dateGroup.slots.length} pickup options available
                        </span>
                      </div>

                      <div className="grid gap-5 lg:grid-cols-2">
                        {dateGroup.slots.map((slot) => {
                          const commitmentStatus = slot.commitment?.status;
                          const committed =
                            commitmentStatus === 'COMMITTED' || commitmentStatus === 'LOCKED';
                          const isLockedWindow = commitmentStatus === 'LOCKED';
                          const isConflictBlocked =
                            !committed && slot.availabilityState === 'UNAVAILABLE_SCHEDULE_CONFLICT';
                          const optionConflicts = slot.optionConflicts ?? {};

                          const selectedReturn = slot.template.returnTimeLocked
                            ? slot.template.lockedReturnTime ?? ''
                            : returnDrafts[slot.slotId] ??
                              slot.commitment?.selectedReturnTime ??
                              '';

                          const selectedOptionConflict = selectedReturn
                            ? optionConflicts[selectedReturn] ?? null
                            : null;

                          const conflictCopy = isConflictBlocked
                            ? buildFriendlyConflictCopy(slot.conflictDetail, slot.conflictReason)
                            : null;

                          const capWeight = slot.capacity?.capacityWeightKg ?? 0;
                          const capVol = slot.capacity?.capacityVolumeCbm ?? 0;
                          const resWeight =
                            slot.poolSummary?.reservedWeightKg ??
                            slot.capacity?.reservedWeightKg ??
                            0;
                          const resVol =
                            slot.poolSummary?.reservedVolumeCbm ??
                            slot.capacity?.reservedVolumeCbm ??
                            0;
                          const remainingWeight = Math.max(0, capWeight - resWeight);
                          const remainingVol = Math.max(0, Number((capVol - resVol).toFixed(2)));
                          const weightPct =
                            capWeight > 0
                              ? Math.min(100, Math.round((resWeight / capWeight) * 100))
                              : 0;
                          const volPct =
                            capVol > 0 ? Math.min(100, Math.round((resVol / capVol) * 100)) : 0;

                          const poolStatusText = formatPoolStatusLabel(
                            slot.poolSummary?.status ?? slot.slotStatus
                          );
                          const isHighlighted = highlightedSlotId === slot.slotId;

                          return (
                            <div
                              id={`driver-slot-${slot.slotId}`}
                              key={slot.slotId}
                              className={cn(
                                'flex flex-col justify-between space-y-4 rounded-[24px] border p-5 transition-all duration-300',
                                isHighlighted
                                  ? 'border-[#4673eb] bg-[#eef3ff]/70 ring-2 ring-[#4673eb]/35'
                                  : committed
                                    ? 'border-[#9db9f8] bg-[#f6f9ff] shadow-[0_14px_38px_-22px_rgba(70,115,235,0.35)]'
                                    : isConflictBlocked
                                      ? 'border-rose-200 bg-rose-50/25'
                                      : 'border-[#dce5fa] bg-white hover:border-[#b7caf7]'
                              )}
                            >
                              <div className="space-y-3.5">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <Badge variant="neutral">Slot {slot.slotNumber}</Badge>
                                    {committed ? (
                                      <Badge variant="success">
                                        {commitmentStatus === 'LOCKED' ? 'Locked' : 'Committed'} •{' '}
                                        {formatTime12h(slot.commitment?.selectedReturnTime)} Return
                                      </Badge>
                                    ) : isConflictBlocked ? (
                                      <Badge variant="danger">Your schedule conflicts</Badge>
                                    ) : (
                                      <Badge variant="warning">Available</Badge>
                                    )}
                                  </div>

                                  <span
                                    title={`Cutoff: ${new Date(slot.cutoffAt).toLocaleString('en-IN')}`}
                                    className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800"
                                  >
                                    <Clock className="h-3 w-3" />
                                    Cutoff: {formatDeadlineCountdown(slot.cutoffAt)}
                                  </span>
                                </div>

                                {isConflictBlocked && conflictCopy ? (
                                  <div className="space-y-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-3.5 py-3 text-xs text-rose-950">
                                    <p className="font-semibold text-rose-900">
                                      {conflictCopy.reason}
                                    </p>
                                    <p className="text-[11px] text-rose-800">
                                      {conflictCopy.breakNote}
                                    </p>
                                    <p className="text-[11px] text-rose-800">
                                      {conflictCopy.resolution}
                                    </p>
                                    {conflictCopy.manageSlotId ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          scrollToConflictingSlot(conflictCopy.manageSlotId!)
                                        }
                                        className="mt-1 inline-flex cursor-pointer items-center gap-1 text-[11px] font-bold text-rose-900 underline hover:text-rose-700"
                                      >
                                        <ArrowDownRight className="h-3.5 w-3.5" />
                                        {conflictCopy.actionLabel}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}

                                <div className="grid gap-3 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3.5 sm:grid-cols-2">
                                  <div>
                                    <p className="text-[11px] font-medium text-[#7a87aa]">Pickup</p>
                                    <p className="mt-0.5 text-base font-bold text-[#080e2b]">
                                      {formatTime12h(slot.template.outboundPickupTime)}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-medium text-[#7a87aa]">Return</p>
                                    {slot.template.returnTimeLocked ? (
                                      <div className="mt-1 inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
                                        <Lock className="h-3.5 w-3.5 shrink-0" />
                                        <span>
                                          {formatTime12h(slot.template.lockedReturnTime)} — Fixed
                                          return
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="mt-1 space-y-1.5">
                                        <div className="flex flex-wrap gap-1.5">
                                          {slot.template.returnTimeOptions.map((opt) => {
                                            const optConflict = !committed
                                              ? optionConflicts[opt] ?? null
                                              : null;
                                            const isDisabled =
                                              isConflictBlocked ||
                                              isLockedWindow ||
                                              Boolean(optConflict);
                                            const active = selectedReturn === opt;
                                            return (
                                              <button
                                                key={opt}
                                                type="button"
                                                disabled={isDisabled}
                                                title={
                                                  optConflict ??
                                                  (isConflictBlocked
                                                    ? 'Disabled due to schedule conflict'
                                                    : undefined)
                                                }
                                                onClick={() =>
                                                  setReturnDrafts((prev) => ({
                                                    ...prev,
                                                    [slot.slotId]: opt,
                                                  }))
                                                }
                                                className={cn(
                                                  'rounded-xl border px-3 py-1.5 text-xs font-semibold transition',
                                                  isDisabled
                                                    ? 'cursor-not-allowed border-[#e3ebfc] bg-[#f4f7ff] text-[#a6b2d0] line-through'
                                                    : active
                                                      ? 'cursor-pointer border-[#4673eb] bg-[#4673eb] text-white shadow-xs'
                                                      : 'cursor-pointer border-[#d6e0f8] bg-white text-[#080e2b] hover:border-[#4673eb]'
                                                )}
                                              >
                                                {formatTime12h(opt)}
                                              </button>
                                            );
                                          })}
                                        </div>
                                        {!selectedReturn && !isConflictBlocked && (
                                          <p className="text-[11px] text-amber-700">
                                            Select a return time
                                          </p>
                                        )}
                                        {selectedOptionConflict && !isConflictBlocked ? (
                                          <p className="text-[11px] text-rose-700">
                                            This return overlaps with another trip.
                                          </p>
                                        ) : null}
                                      </div>
                                    )}
                                  </div>
                                </div>

                                <div className="space-y-2.5 rounded-2xl border border-[#e3ebfc] bg-white p-3.5 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-[#5c6b94]">
                                      Pool Status:{' '}
                                      <strong className="text-[#080e2b]">{poolStatusText}</strong>
                                    </span>
                                    <span className="text-[11px] text-[#7a87aa]">
                                      {slot.poolSummary?.shipmentCount ?? 0} shipment(s)
                                    </span>
                                  </div>

                                  {(capWeight > 0 || capVol > 0) && (
                                    <div className="space-y-2 pt-0.5 text-[11px]">
                                      <div>
                                        <div className="flex justify-between text-[#4d5a83]">
                                          <span>
                                            Weight: {resWeight.toLocaleString('en-IN')} /{' '}
                                            {capWeight.toLocaleString('en-IN')} kg ({weightPct}%)
                                          </span>
                                          <span className="text-[#7a87aa]">
                                            {remainingWeight.toLocaleString('en-IN')} kg left
                                          </span>
                                        </div>
                                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#eef3ff]">
                                          <div
                                            className="h-full rounded-full bg-[#4673eb] transition-all duration-500"
                                            style={{ width: `${weightPct}%` }}
                                          />
                                        </div>
                                      </div>

                                      <div>
                                        <div className="flex justify-between text-[#4d5a83]">
                                          <span>
                                            Volume: {resVol} / {capVol} m³ ({volPct}%)
                                          </span>
                                          <span className="text-[#7a87aa]">
                                            {remainingVol} m³ left
                                          </span>
                                        </div>
                                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#eef3ff]">
                                          <div
                                            className="h-full rounded-full bg-[#6389f0] transition-all duration-500"
                                            style={{ width: `${volPct}%` }}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#eaf0fd] pt-3">
                                <span className="text-[11px] text-[#7a87aa]">
                                  Cutoff: {new Date(slot.cutoffAt).toLocaleString('en-IN')}
                                </span>

                                <div className="flex flex-wrap gap-2">
                                  {commitmentStatus === 'COMMITTED' && (
                                    <button
                                      type="button"
                                      disabled={withdrawMutation.isPending}
                                      onClick={() => withdrawMutation.mutate(slot.slotId)}
                                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#d6e0f8] bg-white px-3.5 py-2 text-xs font-medium text-[#080e2b] transition hover:border-rose-300 hover:text-rose-700 disabled:opacity-50"
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                      Withdraw
                                    </button>
                                  )}

                                  {isLockedWindow ? (
                                    <button
                                      type="button"
                                      disabled
                                      className="inline-flex items-center gap-1.5 rounded-xl border border-[#e3ebfc] bg-[#f8faff] px-3.5 py-2 text-xs font-medium text-[#7a87aa]"
                                    >
                                      <Lock className="h-3.5 w-3.5" />
                                      Locked at Cutoff
                                    </button>
                                  ) : !committed || !slot.template.returnTimeLocked ? (
                                    <button
                                      type="button"
                                      disabled={
                                        commitMutation.isPending ||
                                        isConflictBlocked ||
                                        !selectedReturn ||
                                        Boolean(!committed && selectedOptionConflict)
                                      }
                                      onClick={() =>
                                        commitMutation.mutate({
                                          slot,
                                          returnTime: slot.template.returnTimeLocked
                                            ? slot.template.lockedReturnTime
                                            : selectedReturn,
                                        })
                                      }
                                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#4673eb] px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-[#345fda] disabled:pointer-events-none disabled:opacity-45"
                                    >
                                      <CalendarClock className="h-3.5 w-3.5" />
                                      {committed ? 'Update Return' : 'Commit Availability'}
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {historicalCommitments.length > 0 && (
        <section className="orbit-reveal-3 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-xs sm:p-6">
          <h2 className="text-sm font-semibold text-[#080e2b]">Recent Activity</h2>
          <div className="mt-3 grid gap-2.5 md:grid-cols-2">
            {historicalCommitments.map((c) => {
              const corridorObj = typeof c.corridorId === 'string' ? null : c.corridorId;
              return (
                <div
                  key={c._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3 text-xs"
                >
                  <div>
                    <p className="font-semibold text-[#080e2b]">
                      {corridorObj?.name ?? corridorObj?.code ?? 'Corridor'} • Slot {c.slotNumber}
                    </p>
                    <p className="text-[#5c6b94]">
                      {new Date(c.departureDate).toLocaleDateString('en-IN', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}{' '}
                      • {formatTime12h(c.selectedPickupTime)} →{' '}
                      {formatTime12h(c.selectedReturnTime)}
                    </p>
                  </div>
                  <Badge variant={getCommitmentVariant(c.status)}>
                    {formatActivityStatus(c.status)}
                  </Badge>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

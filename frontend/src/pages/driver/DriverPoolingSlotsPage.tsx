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
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import type {
  DriverPoolingSlotItem,
  DriverSlotCommitmentStatus,
  DriverWindowConflictDetail,
} from '../../types/api';

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

function buildFriendlyConflictCopy(detail?: DriverWindowConflictDetail | null, fallback?: string | null) {
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
      detail.sourceType === 'COMMITMENT'
        ? `Manage ${period} trip`
        : 'View active trip',
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
        stops: entry.corridor.stops
          .slice()
          .sort((a, b) => a.sequenceOrder - b.sequenceOrder),
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
    <div className="space-y-5">
      {/* A. Page Header */}
      <div>
        <h1 className="text-xl font-bold text-slate-900">Choose Your Trips</h1>
        <p className="mt-0.5 text-xs text-slate-600">
          Select the trips you&apos;re available to drive. Confirm before the cutoff time.
        </p>
      </div>

      {banner && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{banner}</span>
        </div>
      )}
      {errorBanner && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{errorBanner}</span>
        </div>
      )}

      {!data.eligible ? (
        <Card>
          <CardContent className="py-8 text-center">
            <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-amber-500" />
            <p className="text-sm font-semibold text-slate-900">Not Eligible for Trips</p>
            <p className="mt-1 text-xs text-slate-600">{data.ineligibleReason}</p>
          </CardContent>
        </Card>
      ) : groupedCorridors.length === 0 ? (
        <EmptyState
          title="No upcoming trips open right now"
          description="Check back when new trip dates open before cutoff."
        />
      ) : (
        <div className="space-y-5">
          {/* C. Corridor Grouping (Displayed once per corridor) */}
          {groupedCorridors.map((corridorGroup) => (
            <Card key={corridorGroup.corridorId} className="border-slate-200">
              <CardHeader className="border-b border-slate-100 pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-emerald-700">
                        {corridorGroup.code}
                      </span>
                      <span
                        title="Contracts let you choose trips dynamically before cutoff."
                        className="inline-flex cursor-help items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                      >
                        <Info className="h-3 w-3" />
                        Trip selection open
                      </span>
                    </div>
                    <h2 className="mt-1 text-base font-bold text-slate-900">
                      {corridorGroup.name}
                    </h2>
                  </div>
                </div>

                {/* Ordered stops shown once */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
                  <RouteIcon className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                  {corridorGroup.stops.map((stop, idx, arr) => (
                    <span key={stop.stopCode} className="font-medium">
                      {stop.name}
                      {idx < arr.length - 1 ? ' → ' : ''}
                    </span>
                  ))}
                </div>
              </CardHeader>

              <CardContent className="space-y-5 pt-4">
                {corridorGroup.dates.map((dateGroup) => {
                  const openPickupCount = dateGroup.slots.filter(
                    (s) => s.availabilityState !== 'UNAVAILABLE_SCHEDULE_CONFLICT'
                  ).length;

                  return (
                    <div key={dateGroup.dateKey} className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-100/80 px-3 py-2 text-xs">
                        <div className="flex items-center gap-2 font-semibold text-slate-800">
                          <Calendar className="h-4 w-4 text-emerald-700" />
                          <span>
                            {new Date(dateGroup.departureDate).toLocaleDateString('en-IN', {
                              weekday: 'short',
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </div>
                        <span className="text-[11px] font-medium text-slate-600">
                          {openPickupCount} of {dateGroup.slots.length} pickup options available
                        </span>
                      </div>

                      {/* D. Separate Slot 1 & Slot 2 Cards */}
                      <div className="grid gap-4 lg:grid-cols-2">
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
                              className={`flex flex-col justify-between space-y-3 rounded-xl border p-4 transition-all ${isHighlighted
                                  ? 'border-indigo-500 bg-indigo-50/40 ring-2 ring-indigo-300'
                                  : committed
                                    ? 'border-emerald-300 bg-emerald-50/20 ring-1 ring-emerald-200'
                                    : isConflictBlocked
                                      ? 'border-rose-200 bg-slate-50/80'
                                      : 'border-slate-200 bg-white'
                                }`}
                            >
                              <div className="space-y-3">
                                {/* Card Header: Driver Availability Status & Cutoff Countdown */}
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
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
                                  </div>

                                  <span
                                    title={`Cutoff: ${new Date(slot.cutoffAt).toLocaleString('en-IN')}`}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800"
                                  >
                                    <Clock className="h-3 w-3" />
                                    Cutoff: {formatDeadlineCountdown(slot.cutoffAt)}
                                  </span>
                                </div>

                                {/* E. Conflict Explanation & Direct Link */}
                                {isConflictBlocked && conflictCopy ? (
                                  <div className="space-y-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-950">
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
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-rose-900 underline hover:text-rose-700"
                                      >
                                        <ArrowDownRight className="h-3.5 w-3.5" />
                                        {conflictCopy.actionLabel}
                                      </button>
                                    ) : null}
                                  </div>
                                ) : null}

                                {/* F. Pickup & Return Timing Controls */}
                                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2">
                                  <div>
                                    <p className="text-[11px] font-medium text-slate-500">
                                      Pickup
                                    </p>
                                    <p className="mt-0.5 text-base font-bold text-slate-900">
                                      {formatTime12h(slot.template.outboundPickupTime)}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="text-[11px] font-medium text-slate-500">
                                      Return
                                    </p>
                                    {slot.template.returnTimeLocked ? (
                                      <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-900">
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
                                                className={`rounded-lg border px-2.5 py-1 text-xs font-semibold transition ${isDisabled
                                                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 line-through'
                                                    : active
                                                      ? 'border-emerald-600 bg-emerald-600 text-white'
                                                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                                  }`}
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

                                {/* G. Independent Pool Status & Capacity Bars */}
                                <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="font-semibold text-slate-700">
                                      Pool Status:{' '}
                                      <strong className="text-slate-900">{poolStatusText}</strong>
                                    </span>
                                    <span className="text-[11px] text-slate-600">
                                      {slot.poolSummary?.shipmentCount ?? 0} shipment(s)
                                    </span>
                                  </div>

                                  {(capWeight > 0 || capVol > 0) && (
                                    <div className="space-y-2 pt-0.5 text-[11px]">
                                      <div>
                                        <div className="flex justify-between text-slate-700">
                                          <span>
                                            Weight: {resWeight.toLocaleString('en-IN')} /{' '}
                                            {capWeight.toLocaleString('en-IN')} kg ({weightPct}%)
                                          </span>
                                          <span className="text-slate-500">
                                            {remainingWeight.toLocaleString('en-IN')} kg left
                                          </span>
                                        </div>
                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                          <div
                                            className="h-full bg-emerald-600"
                                            style={{ width: `${weightPct}%` }}
                                          />
                                        </div>
                                      </div>

                                      <div>
                                        <div className="flex justify-between text-slate-700">
                                          <span>
                                            Volume: {resVol} / {capVol} m³ ({volPct}%)
                                          </span>
                                          <span className="text-slate-500">
                                            {remainingVol} m³ left
                                          </span>
                                        </div>
                                        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                                          <div
                                            className="h-full bg-sky-600"
                                            style={{ width: `${volPct}%` }}
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Cutoff & Actions */}
                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                                <span className="text-[11px] text-slate-500">
                                  Cutoff: {new Date(slot.cutoffAt).toLocaleString('en-IN')}
                                </span>

                                <div className="flex flex-wrap gap-2">
                                  {commitmentStatus === 'COMMITTED' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      disabled={withdrawMutation.isPending}
                                      onClick={() => withdrawMutation.mutate(slot.slotId)}
                                    >
                                      <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                      Withdraw
                                    </Button>
                                  )}

                                  {isLockedWindow ? (
                                    <Button size="sm" variant="outline" disabled>
                                      <Lock className="mr-1.5 h-3.5 w-3.5" />
                                      Locked at Cutoff
                                    </Button>
                                  ) : !committed || !slot.template.returnTimeLocked ? (
                                    <Button
                                      size="sm"
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
                                    >
                                      <CalendarClock className="mr-1.5 h-3.5 w-3.5" />
                                      {committed ? 'Update Return' : 'Commit Availability'}
                                    </Button>
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* H. Recent Activity */}
      {historicalCommitments.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">Recent Activity</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {historicalCommitments.map((c) => {
              const corridorObj = typeof c.corridorId === 'string' ? null : c.corridorId;
              return (
                <div
                  key={c._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {corridorObj?.name ?? corridorObj?.code ?? 'Corridor'} • Slot {c.slotNumber}
                    </p>
                    <p className="text-slate-600">
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
          </CardContent>
        </Card>
      )}
    </div>
  );
}

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  Lock,
  Route as RouteIcon,
  ShieldCheck,
  Truck,
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
import type { DriverPoolingSlotItem, DriverSlotCommitmentStatus } from '../../types/api';

function formatDeadlineCountdown(iso: string): string {
  const diffMs = new Date(iso).getTime() - Date.now();
  if (diffMs <= 0) return 'Closed';
  const totalMins = Math.floor(diffMs / 60000);
  const hrs = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  return hrs > 0 ? `${hrs}h ${mins}m left` : `${mins}m left`;
}

function getCommitmentVariant(status: DriverSlotCommitmentStatus): 'success' | 'warning' | 'danger' | 'neutral' {
  switch (status) {
    case 'ALLOCATED':
      return 'success';
    case 'COMMITTED':
      return 'warning';
    case 'INVALIDATED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function DriverPoolingSlotsPage() {
  const queryClient = useQueryClient();
  const [returnDrafts, setReturnDrafts] = useState<Record<string, string>>({});
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
        `Availability committed for Pickup ${res.commitment.selectedPickupTime} • Return ${res.commitment.selectedReturnTime}. Final trip assignment remains automated at pool cutoff.`
      );
      void queryClient.invalidateQueries({ queryKey: ['driver-pooling-slots'] });
    },
    onError: (err) => {
      setBanner(null);
      setErrorBanner(err instanceof Error ? err.message : 'Unable to commit slot availability');
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: (slotId: string) => withdrawDriverPoolingSlot(slotId),
    onSuccess: () => {
      setErrorBanner(null);
      setBanner('Slot commitment withdrawn before pooling cutoff.');
      void queryClient.invalidateQueries({ queryKey: ['driver-pooling-slots'] });
    },
    onError: (err) => {
      setBanner(null);
      setErrorBanner(err instanceof Error ? err.message : 'Unable to withdraw commitment');
    },
  });

  if (poolingQuery.isLoading) {
    return <LoadingState title="Loading open corridor pooling windows..." />;
  }

  if (poolingQuery.isError || !poolingQuery.data) {
    return (
      <ErrorState
        description={
          poolingQuery.error instanceof Error
            ? poolingQuery.error.message
            : 'Failed to load driver pooling slots.'
        }
        onRetry={() => void poolingQuery.refetch()}
      />
    );
  }

  const data = poolingQuery.data;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Corridor Pooling Windows</h1>
        <p className="mt-0.5 text-xs text-slate-600">
          Select open pickup slots & permitted return timings for your contract-eligible corridors.
        </p>
      </div>

      {/* Important non-guarantee policy notice */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 text-xs text-indigo-900">
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-700" />
          <div className="space-y-1">
            <p className="font-semibold">Dynamic Slot Participation Policy</p>
            <p>
              Contracts grant corridor eligibility without locking you into permanent pickup slots.
              Submitting a slot commitment marks your readiness before the cutoff deadline. Actual trip
              generation happens automatically upon window closure based on pool cargo fit, vehicle
              specifications, and overlap rules.
            </p>
          </div>
        </div>
      </div>

      {data.vehicle && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-xs">
          <div className="flex items-center gap-2 font-medium text-slate-800">
            <Truck className="h-4 w-4 text-slate-600" />
            <span>
              Driver-Owned Vehicle: <strong>{data.vehicle.registrationNumber}</strong> ({data.vehicle.vehicleClass})
            </span>
          </div>
          <span className="text-slate-600">
            Capacity: {data.vehicle.maxWeightKg} kg • {data.vehicle.maxVolumeCbm} m³
          </span>
        </div>
      )}

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
            <p className="text-sm font-semibold text-slate-900">Not Eligible for Scheduled Pooling Slots</p>
            <p className="mt-1 text-xs text-slate-600">{data.ineligibleReason}</p>
          </CardContent>
        </Card>
      ) : data.slots.length === 0 ? (
        <EmptyState
          title="No open pooling windows right now"
          description="Either no future corridor departure slots are open for your contracted corridors, or all windows have passed their locking deadline."
        />
      ) : (
        <div className="space-y-4">
          {data.slots.map((slot) => {
            const committed = slot.commitment?.status === 'COMMITTED';
            const selectedReturn =
              returnDrafts[slot.slotId] ??
              slot.commitment?.selectedReturnTime ??
              (slot.template.returnTimeLocked
                ? slot.template.lockedReturnTime ?? ''
                : slot.template.defaultReturnTime || slot.template.returnTimeOptions[0] || '');

            return (
              <Card key={slot.slotId} className={committed ? 'border-emerald-300 ring-1 ring-emerald-200' : ''}>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="neutral">{slot.corridor.code}</Badge>
                        <Badge variant="neutral">Slot {slot.slotNumber}</Badge>
                        {committed ? (
                          <Badge variant="success">COMMITTED ({slot.commitment?.selectedReturnTime} Return)</Badge>
                        ) : (
                          <Badge variant="warning">OPEN FOR SELECTION</Badge>
                        )}
                      </div>
                      <h2 className="mt-1.5 text-sm font-bold text-slate-900">{slot.corridor.name}</h2>
                      <p className="text-xs text-slate-600">{slot.label}</p>
                    </div>
                    <div className="text-right text-xs">
                      <p className="font-semibold text-slate-900">
                        {new Date(slot.departureDate).toLocaleDateString('en-IN', {
                          weekday: 'short',
                          day: '2-digit',
                          month: 'short',
                        })}
                      </p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-amber-700 font-medium">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDeadlineCountdown(slot.cutoffAt)}
                      </p>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-600">
                    <RouteIcon className="h-3.5 w-3.5 text-slate-400" />
                    {slot.corridor.stops
                      .slice()
                      .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
                      .map((stop, idx, arr) => (
                        <span key={stop.stopCode}>
                          {stop.name}
                          {idx < arr.length - 1 ? ' → ' : ''}
                        </span>
                      ))}
                  </div>

                  <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Outbound Pickup Time
                      </p>
                      <p className="mt-1 text-base font-bold text-slate-900">
                        {slot.template.outboundPickupTime}
                      </p>
                      {slot.poolSummary && (
                        <p className="mt-1 text-[11px] text-slate-600">
                          Active pool: {slot.poolSummary.shipmentCount} shipment(s) •{' '}
                          {slot.poolSummary.reservedWeightKg} kg reserved
                        </p>
                      )}
                    </div>

                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Return Timing Option
                      </p>
                      {slot.template.returnTimeLocked ? (
                        <div className="mt-1 flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-900">
                          <Lock className="h-3.5 w-3.5 shrink-0" />
                          <span>
                            Mandatory Locked Return: {slot.template.lockedReturnTime}
                          </span>
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-wrap gap-2">
                          {slot.template.returnTimeOptions.map((opt) => {
                            const active = selectedReturn === opt;
                            return (
                              <button
                                key={opt}
                                type="button"
                                onClick={() =>
                                  setReturnDrafts((prev) => ({ ...prev, [slot.slotId]: opt }))
                                }
                                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                                  active
                                    ? 'border-emerald-600 bg-emerald-600 text-white'
                                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                                }`}
                              >
                                Return {opt}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <span className="text-[11px] text-slate-500">
                      Cutoff: {new Date(slot.cutoffAt).toLocaleString('en-IN')}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {committed && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={withdrawMutation.isPending}
                          onClick={() => withdrawMutation.mutate(slot.slotId)}
                        >
                          <XCircle className="mr-1.5 h-3.5 w-3.5" />
                          Withdraw Availability
                        </Button>
                      )}
                      <Button
                        size="sm"
                        disabled={commitMutation.isPending}
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
                        {committed ? 'Update Commitment' : 'Commit Availability'}
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Commitment status & audit history */}
      {data.commitments.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-slate-900">Recent Slot Commitments & Outcome Status</h2>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.commitments.map((c) => {
              const corridorObj = typeof c.corridorId === 'string' ? null : c.corridorId;
              const slotObj = typeof c.slotId === 'string' ? null : c.slotId;
              return (
                <div
                  key={c._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs"
                >
                  <div>
                    <p className="font-semibold text-slate-900">
                      {corridorObj?.code ?? 'Corridor'} • {slotObj?.slotCode ?? `Slot ${c.slotNumber}`}
                    </p>
                    <p className="text-slate-600">
                      Pickup {c.selectedPickupTime} → Return {c.selectedReturnTime} •{' '}
                      {new Date(c.departureDate).toLocaleDateString('en-IN')}
                    </p>
                    {c.invalidationReason && (
                      <p className="text-[11px] text-rose-700">Reason: {c.invalidationReason}</p>
                    )}
                  </div>
                  <Badge variant={getCommitmentVariant(c.status)}>{c.status}</Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

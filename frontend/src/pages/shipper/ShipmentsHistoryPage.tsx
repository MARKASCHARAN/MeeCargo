import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  CreditCard,
  ExternalLink,
  PackagePlus,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import {
  cancelShipment,
  fetchCorridors,
  fetchShipments,
  payShipmentToken,
  submitViabilityDecision,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';

export function ShipmentsHistoryPage() {
  const queryClient = useQueryClient();
  const [rolloverTargets, setRolloverTargets] = useState<Record<string, string>>({});
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const shipmentsQuery = useQuery({
    queryKey: ['shipments'],
    queryFn: fetchShipments,
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
      targetSlotId,
    }: {
      shipmentId: string;
      decision: 'ROLLOVER' | 'REFUND';
      targetSlotId?: string;
    }) => submitViabilityDecision(shipmentId, { decision, targetSlotId }),
    onSuccess: (res) => {
      setActionMsg(
        res.decision === 'ROLLOVER'
          ? 'Shipment rolled over to selected future slot with your consent.'
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Shipments & Bookings</h1>
          <p className="text-sm text-slate-500">
            Scoped exclusively to your B2B business ownership. Payments shown in prototype are simulated.
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/shipper/import">
            <Button variant="outline" size="sm">
              Import CSV
            </Button>
          </Link>
          <Link to="/shipper/book">
            <Button variant="primary" size="sm">
              <PackagePlus className="h-4 w-4" />
              New Booking
            </Button>
          </Link>
        </div>
      </div>

      {actionMsg ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {actionMsg}
        </div>
      ) : null}

      {shipments.length === 0 ? (
        <EmptyState
          title="No shipments booked yet"
          description="Create a single booking or bulk import orders via CSV."
          action={
            <Link to="/shipper/book">
              <Button variant="primary" size="sm">
                Book First Shipment
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {shipments.map((s) => {
            const corridorIdStr =
              typeof s.corridorId === 'object' ? s.corridorId._id : s.corridorId;
            const corridorName =
              typeof s.corridorId === 'object' ? s.corridorId.name : 'Corridor';
            const slotIdStr = typeof s.slotId === 'object' ? s.slotId._id : s.slotId;
            const slotLabel =
              typeof s.slotId === 'object' ? s.slotId.label : 'Slot';

            const futureSlots =
              corridors
                .find((c) => c._id === corridorIdStr)
                ?.slots.filter(
                  (sl) => sl._id !== slotIdStr && sl.status === 'OPEN' && !sl.isPastCutoff
                ) ?? [];

            const selectedRolloverSlot =
              rolloverTargets[s._id] ?? futureSlots[0]?._id ?? '';

            const pricing = s.pricingSnapshot;

            return (
              <Card key={s._id}>
                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold text-emerald-700">
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
                    <p className="mt-1 text-xs text-slate-500">
                      {corridorName} • {slotLabel}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {s.status === 'PENDING_TOKEN' ? (
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={payMutation.isPending}
                        onClick={() => payMutation.mutate(s._id)}
                      >
                        <CreditCard className="h-3.5 w-3.5" />
                        Pay Token (Simulated)
                      </Button>
                    ) : null}

                    {['PENDING_TOKEN', 'CONFIRMED', 'POOLED'].includes(s.status) ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={cancelMutation.isPending}
                        onClick={() => cancelMutation.mutate(s._id)}
                      >
                        <XCircle className="h-3.5 w-3.5" />
                        Cancel & Refund
                      </Button>
                    ) : null}

                    <Link to={`/track/${s.trackingToken}`}>
                      <Button size="sm" variant="outline">
                        <ExternalLink className="h-3.5 w-3.5" />
                        Recipient Link
                      </Button>
                    </Link>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  <div className="grid gap-3 text-xs text-slate-600 sm:grid-cols-4">
                    <div>
                      <span className="text-slate-400">Route Stops</span>
                      <p className="mt-0.5 font-semibold text-slate-900">
                        {s.pickupStopCode} → {s.deliveryStopCode}
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">Recipient</span>
                      <p className="mt-0.5 font-semibold text-slate-900">
                        {s.recipientName} ({s.deliveryAddress.villageOrTown})
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">Cargo & Chargeable Wt</span>
                      <p className="mt-0.5 font-semibold text-slate-900">
                        {s.cargo.quantity}× {s.cargo.category} •{' '}
                        {s.cargo.chargeableWeightKg} kg ({s.cargo.billingBasis})
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">Volume (separate)</span>
                      <p className="mt-0.5 font-semibold text-slate-900">
                        {s.cargo.volumeCbm} m³
                      </p>
                    </div>
                  </div>

                  {pricing ? (
                    <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs sm:grid-cols-5">
                      <div>
                        <span className="text-slate-500">Rate Ceiling</span>
                        <p className="font-semibold text-slate-900">
                          {formatPaise(pricing.ceilingPricePaise)}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">
                          {pricing.finalLockedPricePaise !== undefined
                            ? 'Final Locked Price'
                            : 'Projected (Non-Final)'}
                        </span>
                        <p className="font-bold text-slate-900">
                          {formatPaise(
                            pricing.finalLockedPricePaise ?? pricing.projectedPricePaise
                          )}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Discounts (Pool + Anchor)</span>
                        <p className="font-semibold text-emerald-700">
                          -{formatPaise(pricing.poolDiscountPaise + pricing.anchorDiscountPaise)}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Token Paid (Simulated)</span>
                        <p className="font-semibold text-slate-900">
                          {formatPaise(pricing.tokenPaidPaise)}
                        </p>
                      </div>
                      <div>
                        <span className="text-slate-500">Pickup Balance</span>
                        <p className="font-bold text-sky-800">
                          {formatPaise(pricing.remainingBalancePaise)}
                        </p>
                      </div>
                    </div>
                  ) : null}

                  {s.viabilityDecision === 'PENDING_CHOICE' ? (
                    <div className="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs">
                      <div className="flex items-start gap-2 text-amber-950">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        <div>
                          <p className="font-semibold">
                            Action Required: New Route Below Minimum Viability Threshold
                          </p>
                          <p className="mt-0.5 text-amber-900">
                            No trip was created. Choose whether to roll over your shipment to a
                            future compatible slot or receive a full token refund.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        {futureSlots.length > 0 ? (
                          <>
                            <select
                              value={selectedRolloverSlot}
                              onChange={(e) =>
                                setRolloverTargets((prev) => ({
                                  ...prev,
                                  [s._id]: e.target.value,
                                }))
                              }
                              className="rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-xs"
                            >
                              {futureSlots.map((sl) => (
                                <option key={sl._id} value={sl._id}>
                                  {sl.label} ({sl.slotCode})
                                </option>
                              ))}
                            </select>
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={viabilityMutation.isPending}
                              onClick={() =>
                                viabilityMutation.mutate({
                                  shipmentId: s._id,
                                  decision: 'ROLLOVER',
                                  targetSlotId: selectedRolloverSlot,
                                })
                              }
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              Consent & Roll Over
                            </Button>
                          </>
                        ) : (
                          <span className="text-amber-900">
                            No future open slots available for rollover.
                          </span>
                        )}

                        <Button
                          size="sm"
                          variant="danger"
                          disabled={viabilityMutation.isPending}
                          onClick={() =>
                            viabilityMutation.mutate({
                              shipmentId: s._id,
                              decision: 'REFUND',
                            })
                          }
                        >
                          Request Full Token Refund
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

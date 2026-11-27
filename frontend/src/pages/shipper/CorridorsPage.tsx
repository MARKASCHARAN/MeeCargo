import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Activity,
  CalendarClock,
  Lock,
  MapPin,
  PackagePlus,
  Radio,
} from 'lucide-react';
import { fetchCorridors, fetchPools, triggerPoolCutoff } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import type { PoolLiveMetrics } from '../../types/api';

export function CorridorsPage() {
  const queryClient = useQueryClient();
  const [liveOverrides, setLiveOverrides] = useState<Record<string, PoolLiveMetrics>>({});
  const [socketConnected, setSocketConnected] = useState(false);

  const corridorsQuery = useQuery({
    queryKey: ['corridors'],
    queryFn: fetchCorridors,
  });

  const poolsQuery = useQuery({
    queryKey: ['pools'],
    queryFn: fetchPools,
  });

  useEffect(() => {
    const apiOrigin = import.meta.env.VITE_API_URL || window.location.origin;
    const socket = io(apiOrigin, {
      withCredentials: true,
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => setSocketConnected(true));
    socket.on('disconnect', () => setSocketConnected(false));
    socket.on('pools:changed', (event: PoolLiveMetrics) => {
      setLiveOverrides((prev) => ({
        ...prev,
        [event.poolId]: event,
      }));
      void queryClient.invalidateQueries({ queryKey: ['corridors'] });
    });

    return () => {
      socket.disconnect();
    };
  }, [queryClient]);

  const cutoffMutation = useMutation({
    mutationFn: triggerPoolCutoff,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['pools'] });
      void queryClient.invalidateQueries({ queryKey: ['corridors'] });
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });

  if (corridorsQuery.isLoading) {
    return <LoadingState title="Loading scheduled corridors & live pools..." />;
  }

  if (corridorsQuery.isError) {
    return (
      <ErrorState
        title="Could not load corridors"
        description={corridorsQuery.error.message}
        onRetry={() => void corridorsQuery.refetch()}
      />
    );
  }

  const corridors = corridorsQuery.data?.corridors ?? [];
  const pools = poolsQuery.data?.pools ?? [];

  if (corridors.length === 0) {
    return (
      <EmptyState
        title="No active corridors configured"
        description="Run the backend seed script to populate scheduled demo corridors and departure slots."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Scheduled Corridors & Live Pools
          </h1>
          <p className="text-sm text-slate-500">
            Weight and volume utilization are tracked independently; projected rates update live until cutoff lock.
          </p>
        </div>

        <Badge variant={socketConnected ? 'success' : 'neutral'}>
          <Radio className="h-3.5 w-3.5" />
          {socketConnected ? 'Socket.IO Live' : 'Polling Mode'}
        </Badge>
      </div>

      {/* Live Pools Section */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-700" />
            <h2 className="text-base font-semibold text-slate-900">
              Active Freight Pools
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Pricing Engine {poolsQuery.data?.pricingVersion ?? 'v1'}
          </span>
        </CardHeader>
        <CardContent>
          {pools.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active pools yet. Pools open automatically when the first paid-token booking joins a slot.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pools.map((pool) => {
                const metrics = liveOverrides[pool._id] ?? pool.liveMetrics;
                if (!metrics) return null;

                return (
                  <div
                    key={pool._id}
                    className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs font-bold text-emerald-700">
                          {pool.poolCode}
                        </p>
                        <p className="text-sm font-semibold text-slate-900">
                          {pool.corridorId?.name ?? 'Corridor Pool'}
                        </p>
                        <p className="text-xs text-slate-500">
                          {metrics.shipmentCount} pooled shipment(s) • {metrics.appliedTierLabel}
                        </p>
                      </div>
                      <Badge
                        variant={
                          pool.status === 'LOCKED'
                            ? 'success'
                            : pool.status === 'AWAITING_VIABILITY_DECISION'
                              ? 'danger'
                              : 'info'
                        }
                      >
                        {pool.status}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="flex justify-between font-medium text-slate-700">
                          <span>Weight Utilization</span>
                          <span>{metrics.weightUtilizationPct}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full bg-emerald-600 transition-all"
                            style={{ width: `${metrics.weightUtilizationPct}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {metrics.reservedWeightKg} / {metrics.capacityWeightKg} kg
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between font-medium text-slate-700">
                          <span>Volume Utilization</span>
                          <span>{metrics.volumeUtilizationPct}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full bg-sky-600 transition-all"
                            style={{ width: `${metrics.volumeUtilizationPct}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          {metrics.reservedVolumeCbm} / {metrics.capacityVolumeCbm} m³
                        </p>
                      </div>
                    </div>

                    <p className="text-[11px] text-slate-500">
                      Weight and volume limits apply separately — exceeding either cap closes the pool.
                    </p>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                      <div>
                        <p className="text-[11px] text-slate-500">
                          {metrics.isEstimateFinal
                            ? 'Final Locked Rate (Immutable)'
                            : 'Projected Rate (Non-Final Estimate)'}
                        </p>
                        <p className="text-base font-bold text-slate-900">
                          {formatPaise(metrics.projectedRatePaisePerKg)} / kg
                        </p>
                      </div>

                      {pool.status === 'OPEN' ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={cutoffMutation.isPending}
                          onClick={() => cutoffMutation.mutate(pool._id)}
                        >
                          <Lock className="h-3.5 w-3.5" />
                          Run Cutoff Lock
                        </Button>
                      ) : null}
                    </div>

                    {pool.viabilityStatus === 'FAILED' && pool.viabilityReason ? (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {pool.viabilityReason}
                      </div>
                    ) : null}

                    {pool.trip ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
                        Assigned Trip: <strong>{pool.trip.tripCode}</strong> ({pool.trip.status})
                        {pool.trip.vehicleId
                          ? ` • ${pool.trip.vehicleId.registrationNumber} (${pool.trip.vehicleId.tier})`
                          : ''}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Corridors & Slots */}
      {corridors.map((corridor) => (
        <Card key={corridor._id}>
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold text-emerald-700">
                  {corridor.code}
                </span>
                {corridor.isDemoData ? <Badge variant="warning">Demo Data</Badge> : null}
                <Badge variant={corridor.isEstablishedRoute ? 'success' : 'warning'}>
                  {corridor.isEstablishedRoute
                    ? 'Established Route'
                    : `New Route (${corridor.viabilityThresholdPct}% viability)`}
                </Badge>
                <Badge variant="info">
                  Ceiling {formatPaise(corridor.guaranteedCeilingPaisePerKg)}/kg
                </Badge>
              </div>
              <h2 className="mt-1 text-lg font-semibold text-slate-900">
                {corridor.name}
              </h2>
              {corridor.description ? (
                <p className="text-xs text-slate-500">{corridor.description}</p>
              ) : null}
            </div>

            <div className="text-xs text-slate-500">
              Operating:{' '}
              <strong className="text-slate-700">{corridor.operatingDays.join(', ')}</strong>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <MapPin className="h-4 w-4 text-emerald-600" />
              {corridor.stops.map((stop, idx) => (
                <div key={stop.stopCode} className="flex items-center gap-2">
                  <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800">
                    {stop.stopCode}: {stop.name}
                  </span>
                  {idx < corridor.stops.length - 1 ? (
                    <span className="text-slate-400">→</span>
                  ) : null}
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {corridor.slots.map((slot) => {
                const blocked = slot.isPastCutoff || slot.status !== 'OPEN';
                const weightPct = Math.min(
                  100,
                  Math.round((slot.reservedWeightKg / slot.capacityWeightKg) * 100)
                );
                const volPct = Math.min(
                  100,
                  Math.round((slot.reservedVolumeCbm / slot.capacityVolumeCbm) * 100)
                );

                return (
                  <div
                    key={slot._id}
                    className="flex flex-col justify-between rounded-xl border border-slate-200 p-4"
                  >
                    <div className="space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {slot.label}
                          </p>
                          <p className="font-mono text-[11px] text-slate-500">
                            {slot.slotCode}
                          </p>
                        </div>
                        <Badge variant={blocked ? 'danger' : 'success'}>
                          {slot.isPastCutoff ? 'Past Cutoff' : slot.status}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-xs text-slate-600">
                        <div className="flex items-center gap-1.5">
                          <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            Cutoff:{' '}
                            <strong>{new Date(slot.cutoffAt).toLocaleString()}</strong>
                          </span>
                        </div>
                        <p>
                          Departure:{' '}
                          <strong>
                            {new Date(slot.plannedDepartureAt).toLocaleString()}
                          </strong>
                        </p>
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                        <div>
                          <div className="flex justify-between text-slate-600">
                            <span>Weight Reserved</span>
                            <span>{weightPct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full bg-emerald-600"
                              style={{ width: `${weightPct}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {slot.availableWeightKg.toFixed(0)} / {slot.capacityWeightKg} kg free
                          </p>
                        </div>

                        <div>
                          <div className="flex justify-between text-slate-600">
                            <span>Volume Reserved</span>
                            <span>{volPct}%</span>
                          </div>
                          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full bg-sky-600"
                              style={{ width: `${volPct}%` }}
                            />
                          </div>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            {slot.availableVolumeCbm.toFixed(2)} / {slot.capacityVolumeCbm} m³ free
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4">
                      {blocked ? (
                        <Button variant="outline" size="sm" className="w-full" disabled>
                          Cutoff Closed — Choose Later Slot
                        </Button>
                      ) : (
                        <Link
                          to={`/shipper/book?corridorId=${corridor._id}&slotId=${slot._id}`}
                        >
                          <Button variant="primary" size="sm" className="w-full">
                            <PackagePlus className="h-4 w-4" />
                            Book on This Slot
                          </Button>
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

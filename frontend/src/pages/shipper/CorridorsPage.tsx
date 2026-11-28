import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { io } from 'socket.io-client';
import {
  Activity,
  Calculator,
  Calendar,
  CalendarClock,
  Lock,
  MapPin,
  PackagePlus,
  Radio,
} from 'lucide-react';
import { fetchCorridors, fetchPools } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import type { CorridorServiceDateSummary, PoolLiveMetrics } from '../../types/api';

function formatServiceDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function statusBadgeVariant(
  status: CorridorServiceDateSummary['status']
): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'OPEN') return 'success';
  if (status === 'FULL') return 'warning';
  if (status === 'CLOSED') return 'danger';
  return 'info' as 'neutral';
}

export function CorridorsPage() {
  const queryClient = useQueryClient();
  const [liveOverrides, setLiveOverrides] = useState<Record<string, PoolLiveMetrics>>({});
  const [socketConnected, setSocketConnected] = useState(false);
  const [dateFilter, setDateFilter] = useState<'UPCOMING_BOOKABLE' | 'ALL'>('UPCOMING_BOOKABLE');
  const [sampleChargeableKg, setSampleChargeableKg] = useState<string>('');

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
        title="No active corridors available"
        description="Scheduled freight corridors will appear here as soon as routes are activated."
      />
    );
  }

  const parsedChargeableKg = Number(sampleChargeableKg);
  const hasSampleWeight = Number.isFinite(parsedChargeableKg) && parsedChargeableKg > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Scheduled Corridors &amp; Live Pools
          </h1>
          <p className="text-sm text-slate-500">
            Browse active corridors and upcoming service dates. MeeCargo automatically matches your
            shipment to the right operational pool and never exposes driver slot selection.
          </p>
        </div>

        <Badge variant={socketConnected ? 'success' : 'neutral'}>
          <Radio className="h-3.5 w-3.5" />
          Live updates
        </Badge>
      </div>

      {/* Filters & optional Chargeable Weight Estimator */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-600">Service Dates:</span>
            <button
              type="button"
              onClick={() => setDateFilter('UPCOMING_BOOKABLE')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                dateFilter === 'UPCOMING_BOOKABLE'
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              Upcoming Bookable Dates
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('ALL')}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                dateFilter === 'ALL'
                  ? 'border-emerald-600 bg-emerald-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
              }`}
            >
              All Dates
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Calculator className="h-3.5 w-3.5 text-slate-500" />
            <label htmlFor="sample-kg" className="text-slate-600">
              Estimate Charge (Chargeable kg):
            </label>
            <input
              id="sample-kg"
              type="number"
              min="1"
              step="1"
              value={sampleChargeableKg}
              onChange={(e) => setSampleChargeableKg(e.target.value)}
              placeholder="e.g. 250"
              className="w-24 rounded-lg border border-slate-300 px-2.5 py-1 text-xs"
            />
            <span className="text-[11px] text-slate-500">
              Uses max(actual weight, volumetric weight)
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Live Pools Section (Service-date view without driver slot labels or internal IDs) */}
      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-emerald-700" />
            <h2 className="text-base font-semibold text-slate-900">
              Active Freight Pools
            </h2>
          </div>
          <span className="text-xs text-slate-500">
            Cutoff locks automatically on backend schedule
          </span>
        </CardHeader>
        <CardContent>
          {pools.length === 0 ? (
            <p className="text-sm text-slate-500">
              No active pools yet. Pools open automatically when shipments book onto a service date.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {pools.map((pool) => {
                const metrics = liveOverrides[pool._id] ?? pool.liveMetrics;
                if (!metrics) return null;

                const serviceDate = formatServiceDate(
                  pool.slotId?.departureDate ?? pool.slotId?.plannedDepartureAt
                );
                const ceilingPaise = pool.corridorId?.guaranteedCeilingPaisePerKg;
                const remainingKg = Math.max(
                  0,
                  metrics.capacityWeightKg - metrics.reservedWeightKg
                );
                const remainingCbm = Math.max(
                  0,
                  metrics.capacityVolumeCbm - metrics.reservedVolumeCbm
                );

                return (
                  <div
                    key={pool._id}
                    className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/60 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-emerald-700">
                            {pool.corridorId?.code ?? 'Corridor'}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                            <Calendar className="h-3 w-3 text-emerald-700" />
                            Service Date: {serviceDate}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-slate-900">
                          {pool.corridorId?.name ?? 'Scheduled Corridor'}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {metrics.shipmentCount} pooled shipment(s)
                          {metrics.appliedTierLabel &&
                          !metrics.appliedTierLabel.startsWith('Base Pool')
                            ? ` • ${metrics.appliedTierLabel}`
                            : ''}
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
                          {remainingKg.toFixed(0)} kg remaining ({metrics.reservedWeightKg} /{' '}
                          {metrics.capacityWeightKg} kg)
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
                          {remainingCbm.toFixed(2)} m³ remaining ({metrics.reservedVolumeCbm} /{' '}
                          {metrics.capacityVolumeCbm} m³)
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 pt-3">
                      <div>
                        <p className="text-[11px] text-slate-500">
                          {metrics.isEstimateFinal
                            ? 'Final Locked Rate / Chargeable kg'
                            : 'Projected Rate / Chargeable kg'}
                        </p>
                        <p className="text-base font-bold text-slate-900">
                          {formatPaise(metrics.projectedRatePaisePerKg)} / kg
                        </p>
                        {ceilingPaise ? (
                          <p className="text-[11px] text-slate-500">
                            Guaranteed Price Ceiling: {formatPaise(ceilingPaise)} / kg
                          </p>
                        ) : null}
                      </div>

                      {hasSampleWeight ? (
                        <div className="text-right text-xs">
                          <span className="text-slate-500">
                            Est. freight ({parsedChargeableKg} kg):
                          </span>
                          <p className="font-bold text-emerald-700">
                            {formatPaise(
                              Math.round(parsedChargeableKg * metrics.projectedRatePaisePerKg)
                            )}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {pool.viabilityStatus === 'FAILED' && pool.viabilityReason ? (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {pool.viabilityReason}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Corridors & Service Dates (NO slot-level buttons or driver pickup slot selectors) */}
      {corridors.map((corridor) => {
        const allDates = corridor.serviceDates ?? [];
        const visibleDates = allDates.filter((d) =>
          dateFilter === 'ALL' ? true : d.bookable
        );

        return (
          <Card key={corridor._id}>
            <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-emerald-700">
                    {corridor.code}
                  </span>
                  <Badge variant="info">
                    Guaranteed Ceiling: {formatPaise(corridor.guaranteedCeilingPaisePerKg)} /
                    Chargeable kg
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
                Operating Days:{' '}
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

              {visibleDates.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center text-xs text-slate-500">
                  No upcoming bookable service dates on this corridor. Switch to{' '}
                  <button
                    type="button"
                    onClick={() => setDateFilter('ALL')}
                    className="font-semibold text-emerald-700 underline"
                  >
                    All Dates
                  </button>{' '}
                  to inspect locked or closed dates.
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {visibleDates.map((sd) => (
                    <div
                      key={sd.serviceDate}
                      className="flex flex-col justify-between rounded-xl border border-slate-200 p-4"
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="inline-flex items-center gap-1 rounded bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800">
                              <Calendar className="h-3.5 w-3.5" />
                              Service Date: {formatServiceDate(sd.departureDate ?? sd.serviceDate)}
                            </span>
                            <p className="mt-1.5 text-[11px] font-medium text-slate-600">
                              {sd.pooledShipmentCount} pooled shipment(s) on this date
                            </p>
                          </div>
                          <Badge variant={statusBadgeVariant(sd.status)}>{sd.status}</Badge>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-slate-600">
                          <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
                          <span>
                            Automatic Cutoff:{' '}
                            <strong>{new Date(sd.cutoffAt).toLocaleString('en-IN')}</strong>
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                          <div>
                            <div className="flex justify-between text-slate-600">
                              <span>Weight Utilized</span>
                              <span>{sd.weightUtilizationPct}%</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full bg-emerald-600"
                                style={{ width: `${sd.weightUtilizationPct}%` }}
                              />
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {sd.availableWeightKg.toFixed(0)} / {sd.capacityWeightKg} kg free
                            </p>
                          </div>

                          <div>
                            <div className="flex justify-between text-slate-600">
                              <span>Volume Utilized</span>
                              <span>{sd.volumeUtilizationPct}%</span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div
                                className="h-full bg-sky-600"
                                style={{ width: `${sd.volumeUtilizationPct}%` }}
                              />
                            </div>
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              {sd.availableVolumeCbm.toFixed(2)} / {sd.capacityVolumeCbm} m³ free
                            </p>
                          </div>
                        </div>

                        <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-600">Projected Rate / Chargeable kg:</span>
                            <strong className="text-slate-900">
                              {formatPaise(sd.projectedRatePaisePerKg)} / kg
                            </strong>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between text-[11px] text-slate-500">
                            <span>Configured Price Ceiling:</span>
                            <span>{formatPaise(corridor.guaranteedCeilingPaisePerKg)} / kg</span>
                          </div>
                          {hasSampleWeight ? (
                            <div className="mt-1 flex items-center justify-between border-t border-slate-200 pt-1 text-[11px]">
                              <span className="text-slate-600">
                                Est. Freight ({parsedChargeableKg} kg):
                              </span>
                              <strong className="text-emerald-700">
                                {formatPaise(
                                  Math.round(parsedChargeableKg * sd.projectedRatePaisePerKg)
                                )}
                              </strong>
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="mt-4">
                        {!sd.bookable ? (
                          <Button variant="outline" size="sm" className="w-full" disabled>
                            <Lock className="h-3.5 w-3.5" />
                            {sd.status === 'LOCKED'
                              ? 'Service Locked — Booking Closed'
                              : sd.status === 'FULL'
                                ? 'Capacity Full — Choose Another Date'
                                : 'Booking Window Closed'}
                          </Button>
                        ) : (
                          <Link
                            to={`/shipper/book?corridorId=${corridor._id}&serviceDate=${sd.serviceDate}`}
                          >
                            <Button variant="primary" size="sm" className="w-full">
                              <PackagePlus className="h-4 w-4" />
                              Book Shipment
                            </Button>
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

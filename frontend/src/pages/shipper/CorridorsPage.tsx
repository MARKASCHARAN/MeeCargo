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
import { fetchCorridors, fetchPools } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { cn } from '@/lib/cn';
import { formatPaise } from '@/lib/format';
import type { CorridorServiceDateSummary, PoolLiveMetrics } from '@/types/api';

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
      {/* Obsidian Hero Header */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#8ea5e2]">
              Real-Time Corridor Pooling
            </p>
            <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[36px]">
              Scheduled corridors &amp;{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                style={{ fontStyle: 'italic' }}
              >
                live pools.
              </em>
            </h1>
            <p className="mt-1.5 max-w-2xl text-xs text-[#a8b5d6] sm:text-sm">
              Browse active corridors and upcoming service dates. MeeCargo matches your shipment
              automatically without exposing internal driver slot selection.
            </p>
          </div>

          <span
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border px-3.5 py-1.5 text-xs font-semibold sm:self-center',
              socketConnected
                ? 'border-emerald-400/35 bg-emerald-500/15 text-emerald-300'
                : 'border-white/15 bg-white/[0.06] text-[#c0cce8]'
            )}
          >
            <Radio className="h-3.5 w-3.5" />
            {socketConnected ? 'Live updates connected' : 'Live updates'}
          </span>
        </div>
      </section>

      {/* Filters & Chargeable Weight Estimator */}
      <div className="orbit-reveal-2 flex flex-col gap-3 rounded-[24px] border border-[#dce5fa] bg-white/95 p-4 shadow-xs sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-[#4d5a83]">Service Dates:</span>
          <button
            type="button"
            onClick={() => setDateFilter('UPCOMING_BOOKABLE')}
            className={cn(
              'cursor-pointer rounded-full border px-4 py-1.5 text-xs font-semibold transition',
              dateFilter === 'UPCOMING_BOOKABLE'
                ? 'border-[#080b14] bg-[#080b14] text-white'
                : 'border-[#d5ddf0] bg-white text-[#4d5a83] hover:border-[#080b14] hover:text-[#080b14]'
            )}
          >
            Upcoming Bookable Dates
          </button>
          <button
            type="button"
            onClick={() => setDateFilter('ALL')}
            className={cn(
              'cursor-pointer rounded-full border px-4 py-1.5 text-xs font-semibold transition',
              dateFilter === 'ALL'
                ? 'border-[#080b14] bg-[#080b14] text-white'
                : 'border-[#d5ddf0] bg-white text-[#4d5a83] hover:border-[#080b14] hover:text-[#080b14]'
            )}
          >
            All Dates
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Calculator className="h-3.5 w-3.5 text-[#4673eb]" />
          <label htmlFor="sample-kg" className="font-medium text-[#4d5a83]">
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
            className="orbit-input-dark w-28 py-1.5"
          />
          <span className="text-[11px] text-[#7a87aa]">max(actual, volumetric)</span>
        </div>
      </div>

      {/* Live Pools Section */}
      <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_55px_-28px_rgba(8,11,20,0.16)]">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#080b14] text-white">
              <Activity className="h-4 w-4 text-[#82a2ff]" />
            </div>
            <h2 className="text-base font-semibold text-[#080b14]">Active Freight Pools</h2>
          </div>
          <span className="text-xs text-[#5c6b94]">Cutoff locks automatically on schedule</span>
        </div>

        <div className="p-6">
          {pools.length === 0 ? (
            <p className="text-sm text-[#5c6b94]">
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
                    className="space-y-3.5 rounded-[22px] border border-[#dce5fa] bg-[#f8faff] p-5 transition hover:border-[#080b14]/35 hover:bg-white"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-[#080b14] px-2.5 py-0.5 font-mono text-xs font-bold text-white">
                            {pool.corridorId?.code ?? 'Corridor'}
                          </span>
                          <span className="inline-flex items-center gap-1 rounded-full border border-[#dce5fa] bg-white px-2.5 py-0.5 text-[11px] font-semibold text-[#080b14]">
                            <Calendar className="h-3 w-3 text-[#4673eb]" />
                            {serviceDate}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm font-semibold text-[#080b14]">
                          {pool.corridorId?.name ?? 'Scheduled Corridor'}
                        </p>
                        <p className="mt-0.5 text-xs text-[#5c6b94]">
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
                        <div className="flex justify-between font-medium text-[#4d5a83]">
                          <span>Weight Utilization</span>
                          <span>{metrics.weightUtilizationPct}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e3ebfc]">
                          <div
                            className="h-full rounded-full bg-[#080b14] transition-all duration-500"
                            style={{ width: `${metrics.weightUtilizationPct}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#7a87aa]">
                          {remainingKg.toFixed(0)} kg left ({metrics.reservedWeightKg} /{' '}
                          {metrics.capacityWeightKg} kg)
                        </p>
                      </div>

                      <div>
                        <div className="flex justify-between font-medium text-[#4d5a83]">
                          <span>Volume Utilization</span>
                          <span>{metrics.volumeUtilizationPct}%</span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#e3ebfc]">
                          <div
                            className="h-full rounded-full bg-[#4673eb] transition-all duration-500"
                            style={{ width: `${metrics.volumeUtilizationPct}%` }}
                          />
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#7a87aa]">
                          {remainingCbm.toFixed(2)} m³ left ({metrics.reservedVolumeCbm} /{' '}
                          {metrics.capacityVolumeCbm} m³)
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e3ebfc] pt-3">
                      <div>
                        <p className="text-[11px] text-[#5c6b94]">
                          {metrics.isEstimateFinal
                            ? 'Final Locked Rate / Chargeable kg'
                            : 'Projected Rate / Chargeable kg'}
                        </p>
                        <p className="text-base font-bold text-[#080b14]">
                          {formatPaise(metrics.projectedRatePaisePerKg)} / kg
                        </p>
                        {ceilingPaise ? (
                          <p className="text-[11px] text-[#7a87aa]">
                            Guaranteed Price Ceiling: {formatPaise(ceilingPaise)} / kg
                          </p>
                        ) : null}
                      </div>

                      {hasSampleWeight ? (
                        <div className="rounded-xl bg-[#080b14] px-3 py-1.5 text-right text-xs text-white">
                          <span className="block text-[10px] text-[#9eb0db]">
                            Est. ({parsedChargeableKg} kg)
                          </span>
                          <p className="font-bold text-[#82a2ff]">
                            {formatPaise(
                              Math.round(parsedChargeableKg * metrics.projectedRatePaisePerKg)
                            )}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    {pool.viabilityStatus === 'FAILED' && pool.viabilityReason ? (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                        {pool.viabilityReason}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* Corridors & Service Dates */}
      <div className="orbit-reveal-3 space-y-6">
        {corridors.map((corridor) => {
          const allDates = corridor.serviceDates ?? [];
          const visibleDates = allDates.filter((d) => (dateFilter === 'ALL' ? true : d.bookable));

          return (
            <section
              key={corridor._id}
              className="overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_55px_-28px_rgba(8,11,20,0.16)]"
            >
              <div className="flex flex-col gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-lg bg-[#080b14] px-2.5 py-0.5 font-mono text-xs font-semibold text-white">
                      {corridor.code}
                    </span>
                    <Badge variant="info">
                      Guaranteed Ceiling: {formatPaise(corridor.guaranteedCeilingPaisePerKg)} / kg
                    </Badge>
                  </div>
                  <h2 className="mt-1.5 text-lg font-semibold text-[#080b14]">{corridor.name}</h2>
                  {corridor.description ? (
                    <p className="text-xs text-[#5c6b94]">{corridor.description}</p>
                  ) : null}
                </div>

                <div className="text-xs text-[#5c6b94]">
                  Operating Days:{' '}
                  <strong className="text-[#080b14]">{corridor.operatingDays.join(', ')}</strong>
                </div>
              </div>

              <div className="space-y-5 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <MapPin className="h-4 w-4 text-[#4673eb]" />
                  {corridor.stops.map((stop, idx) => (
                    <div key={stop.stopCode} className="flex items-center gap-2">
                      <span className="rounded-full border border-[#dce5fa] bg-[#f8faff] px-3 py-1 text-xs font-medium text-[#080b14]">
                        {stop.stopCode}: {stop.name}
                      </span>
                      {idx < corridor.stops.length - 1 ? (
                        <span className="text-[#7a87aa]">→</span>
                      ) : null}
                    </div>
                  ))}
                </div>

                {visibleDates.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#cddbfa] bg-[#f8faff] px-4 py-7 text-center text-xs text-[#5c6b94]">
                    No upcoming bookable service dates on this corridor. Switch to{' '}
                    <button
                      type="button"
                      onClick={() => setDateFilter('ALL')}
                      className="cursor-pointer font-semibold text-[#080b14] underline"
                    >
                      All Dates
                    </button>{' '}
                    to inspect locked or closed dates.
                  </div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {visibleDates.map((sd) => (
                      <div
                        key={sd.serviceDate}
                        className="flex flex-col justify-between rounded-[22px] border border-[#dce5fa] bg-white p-5 transition hover:border-[#080b14]/35"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#080b14] px-3 py-1 text-xs font-semibold text-white">
                                <Calendar className="h-3.5 w-3.5 text-[#82a2ff]" />
                                {formatServiceDate(sd.departureDate ?? sd.serviceDate)}
                              </span>
                              <p className="mt-1.5 text-[11px] font-medium text-[#5c6b94]">
                                {sd.pooledShipmentCount} pooled shipment(s) on this date
                              </p>
                            </div>
                            <Badge variant={statusBadgeVariant(sd.status)}>{sd.status}</Badge>
                          </div>

                          <div className="flex items-center gap-1.5 text-xs text-[#5c6b94]">
                            <CalendarClock className="h-3.5 w-3.5 text-[#4673eb]" />
                            <span>
                              Automatic Cutoff:{' '}
                              <strong className="text-[#080b14]">
                                {new Date(sd.cutoffAt).toLocaleString('en-IN')}
                              </strong>
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-3 pt-1 text-xs">
                            <div>
                              <div className="flex justify-between text-[#4d5a83]">
                                <span>Weight Utilized</span>
                                <span>{sd.weightUtilizationPct}%</span>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef3ff]">
                                <div
                                  className="h-full bg-[#080b14]"
                                  style={{ width: `${sd.weightUtilizationPct}%` }}
                                />
                              </div>
                              <p className="mt-0.5 text-[11px] text-[#7a87aa]">
                                {sd.availableWeightKg.toFixed(0)} / {sd.capacityWeightKg} kg free
                              </p>
                            </div>

                            <div>
                              <div className="flex justify-between text-[#4d5a83]">
                                <span>Volume Utilized</span>
                                <span>{sd.volumeUtilizationPct}%</span>
                              </div>
                              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[#eef3ff]">
                                <div
                                  className="h-full bg-[#4673eb]"
                                  style={{ width: `${sd.volumeUtilizationPct}%` }}
                                />
                              </div>
                              <p className="mt-0.5 text-[11px] text-[#7a87aa]">
                                {sd.availableVolumeCbm.toFixed(2)} / {sd.capacityVolumeCbm} m³ free
                              </p>
                            </div>
                          </div>

                          <div className="rounded-xl border border-[#e3ebfc] bg-[#f8faff] px-3.5 py-2.5 text-xs">
                            <div className="flex items-center justify-between">
                              <span className="text-[#5c6b94]">Projected Rate / Chargeable kg:</span>
                              <strong className="text-[#080b14]">
                                {formatPaise(sd.projectedRatePaisePerKg)} / kg
                              </strong>
                            </div>
                            <div className="mt-0.5 flex items-center justify-between text-[11px] text-[#7a87aa]">
                              <span>Configured Price Ceiling:</span>
                              <span>{formatPaise(corridor.guaranteedCeilingPaisePerKg)} / kg</span>
                            </div>
                            {hasSampleWeight ? (
                              <div className="mt-1.5 flex items-center justify-between border-t border-[#e3ebfc] pt-1.5 text-[11px]">
                                <span className="text-[#4d5a83]">
                                  Est. Freight ({parsedChargeableKg} kg):
                                </span>
                                <strong className="text-[#4673eb]">
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
                            <button
                              type="button"
                              disabled
                              className="inline-flex w-full items-center justify-center gap-1.5 rounded-2xl border border-[#d5ddf0] bg-[#f8faff] px-4 py-2.5 text-xs font-medium text-[#7a87aa]"
                            >
                              <Lock className="h-3.5 w-3.5" />
                              {sd.status === 'LOCKED'
                                ? 'Service Locked — Booking Closed'
                                : sd.status === 'FULL'
                                  ? 'Capacity Full — Choose Another Date'
                                  : 'Booking Window Closed'}
                            </button>
                          ) : (
                            <Link
                              to={`/shipper/book?corridorId=${corridor._id}&serviceDate=${sd.serviceDate}`}
                              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-[#080b14] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#192038]"
                            >
                              <PackagePlus className="h-4 w-4 text-[#82a2ff]" />
                              Book Shipment
                            </Link>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

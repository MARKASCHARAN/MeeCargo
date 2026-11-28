import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AlertCircle,
  ArrowRight,
  Building2,
  Calendar,
  ExternalLink,
  Info,
  Package,
  PackagePlus,
  Route as RouteIcon,
} from 'lucide-react';
import {
  fetchBusinessProfile,
  fetchOperationalImpactMetrics,
  fetchShipments,
} from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { formatPaise } from '@/lib/format';
import { useAuthStore } from '@/stores/authStore';
import type { ShipmentStatus } from '@/types/api';

function getShipmentStatusVariant(
  status: ShipmentStatus
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (status) {
    case 'DELIVERED':
    case 'LOCKED':
      return 'success';
    case 'POOLED':
    case 'CONFIRMED':
    case 'PICKED_UP':
    case 'IN_TRANSIT':
    case 'AT_DESTINATION':
      return 'info';
    case 'PENDING_TOKEN':
    case 'ROLLED_OVER':
      return 'warning';
    case 'FAILED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function ShipperDashboardPage() {
  const { user } = useAuthStore();

  const businessQuery = useQuery({
    queryKey: ['shipper-business-profile'],
    queryFn: fetchBusinessProfile,
  });

  const business = businessQuery.data?.businessProfile ?? null;

  const metricsQuery = useQuery({
    queryKey: ['operational-impact-metrics'],
    queryFn: fetchOperationalImpactMetrics,
    enabled: Boolean(business),
  });

  const shipmentsQuery = useQuery({
    queryKey: ['shipments'],
    queryFn: () => fetchShipments(),
    enabled: Boolean(business),
  });

  const metrics = metricsQuery.data?.metrics;
  const scoped = metrics?.shipperScoped;
  const recentShipments = (shipmentsQuery.data?.shipments ?? []).slice(0, 5);

  const finalizedSpend = scoped?.finalizedSpendPaise ?? 0;
  const projectedSpend = scoped?.projectedSpendPaise ?? 0;
  const finalizedSavings = scoped?.finalizedSavingsPaise ?? 0;
  const projectedSavings = scoped?.projectedSavingsPaise ?? 0;
  const hasFinalizedOnly = finalizedSpend > 0 && projectedSpend === 0;
  const hasMixedPricing = finalizedSpend > 0 && projectedSpend > 0;
  const hasValidBaseline = scoped?.hasValidBaselineComparison ?? false;

  const spendLabel = hasFinalizedOnly ? 'Final Shipment Charges' : 'Estimated Pooled Spend';
  const savingsLabel = hasFinalizedOnly ? 'Savings Achieved' : 'Projected Savings vs Baseline';

  const displayedSavingsPaise = hasFinalizedOnly
    ? finalizedSavings
    : (scoped?.estimatedSavingsPaise ?? 0);

  const displayedSavingsPct = hasFinalizedOnly
    ? (scoped?.finalizedSavingsPct ?? null)
    : hasMixedPricing
      ? null
      : (scoped?.projectedSavingsPct ?? null);

  return (
    <div className="space-y-6">
      {/* Obsidian Dark Hero Banner */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-64 w-64 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />

        <div className="relative z-10 flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#8ea5e2]">
              Corridor Shipper Command
            </p>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h1 className="text-[28px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[36px]">
                {business?.businessName ?? user?.businessName ?? 'Shipper'}{' '}
                <em
                  className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                  style={{ fontStyle: 'italic' }}
                >
                  overview.
                </em>
              </h1>
            </div>
            <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-[#a8b5d6] sm:text-sm">
              Book shipments on scheduled corridors, track deliveries live, and monitor your pooled
              freight savings.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              to="/shipper/corridors"
              className="inline-flex items-center gap-1.5 rounded-[22px] border border-white/15 bg-white/[0.06] px-4 py-2.5 text-xs font-medium text-white transition hover:border-white/30 hover:bg-white/10"
            >
              <RouteIcon className="h-3.5 w-3.5 text-[#82a2ff]" />
              Live Pools
            </Link>
            <Link
              to="/shipper/book"
              aria-disabled={!business}
              className={`inline-flex items-center gap-2 rounded-[22px] bg-white px-5 py-2.5 text-xs font-semibold text-[#080b14] shadow-sm transition hover:-translate-y-0.5 hover:bg-[#eef3ff] ${
                !business ? 'pointer-events-none opacity-45' : ''
              }`}
            >
              <PackagePlus className="h-4 w-4 text-[#4673eb]" />
              New Shipment Booking
            </Link>
          </div>
        </div>
      </section>

      {/* Business profile notice */}
      {!businessQuery.isLoading && !business ? (
        <div className="orbit-reveal-2 flex flex-col gap-3 rounded-[24px] border border-amber-300 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="text-sm font-semibold text-amber-950">
                Complete your B2B Business Profile first
              </h2>
              <p className="text-xs text-amber-800">
                A verified business profile and pickup address are required before booking shipments.
              </p>
            </div>
          </div>
          <Link
            to="/shipper/profile"
            className="inline-flex items-center gap-2 rounded-2xl bg-[#080b14] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#192038]"
          >
            <Building2 className="h-4 w-4" />
            Set Up Profile
          </Link>
        </div>
      ) : null}

      {business && metricsQuery.isLoading ? (
        <LoadingState title="Loading your shipment summary..." />
      ) : business && metricsQuery.isError ? (
        <ErrorState
          title="Could not load shipment summary"
          description={metricsQuery.error.message}
          onRetry={() => void metricsQuery.refetch()}
        />
      ) : null}

      {/* Shipper Summary KPIs with Obsidian Black Savings Highlight */}
      {scoped ? (
        <div className="orbit-reveal-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_14px_40px_-24px_rgba(8,11,20,0.16)] transition hover:-translate-y-0.5 hover:border-[#080b14]/30">
            <p className="text-xs font-medium text-[#5c6b94]">Total Bookings</p>
            <p className="mt-1.5 text-3xl font-bold tracking-tight text-[#080b14]">
              {scoped.totalBookings}
            </p>
            <p className="mt-1.5 text-[11px] text-[#7a87aa]">
              All non-draft shipments for your business
            </p>
          </div>

          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_14px_40px_-24px_rgba(8,11,20,0.16)] transition hover:-translate-y-0.5 hover:border-[#080b14]/30">
            <p className="text-xs font-medium text-[#5c6b94]">Active &amp; Delivered</p>
            <div className="mt-1.5 flex items-baseline gap-3">
              <span className="text-3xl font-bold text-[#080b14]">{scoped.activeCount}</span>
              <span className="text-xs font-medium text-[#5c6b94]">active</span>
              <span className="text-[#c5d2ef]">•</span>
              <span className="text-2xl font-bold text-[#4673eb]">{scoped.deliveredCount}</span>
              <span className="text-xs font-medium text-[#5c6b94]">delivered</span>
            </div>
            <p className="mt-1.5 text-[11px] text-[#7a87aa]">
              {scoped.deliveredCount > 0
                ? `${scoped.deliveredCount} completed delivery record(s)`
                : 'In-transit and scheduled shipments'}
            </p>
          </div>

          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_14px_40px_-24px_rgba(8,11,20,0.16)] transition hover:-translate-y-0.5 hover:border-[#080b14]/30">
            <p className="text-xs font-medium text-[#5c6b94]">{spendLabel}</p>
            {scoped.hasPricedShipments ? (
              <>
                <p className="mt-1.5 text-3xl font-bold tracking-tight text-[#080b14]">
                  {formatPaise(
                    hasFinalizedOnly ? finalizedSpend : scoped.totalActualOrProjectedSpendPaise
                  )}
                </p>
                {hasMixedPricing ? (
                  <p className="mt-1.5 text-[11px] text-[#7a87aa]">
                    Final: {formatPaise(finalizedSpend)} • Pending cutoff:{' '}
                    {formatPaise(projectedSpend)}
                  </p>
                ) : hasFinalizedOnly ? (
                  <p className="mt-1.5 text-[11px] text-[#7a87aa]">Locked final pooled charges</p>
                ) : (
                  <p className="mt-1.5 text-[11px] text-[#7a87aa]">Updates until corridor cutoff</p>
                )}
              </>
            ) : (
              <p className="mt-2 text-xs text-[#7a87aa]">
                Charges will appear once shipments are priced.
              </p>
            )}
          </div>

          {/* Obsidian Black Savings Spotlight Card */}
          <div className="rounded-[24px] border border-[#1d2542] bg-[#080b14] p-5 text-white shadow-[0_20px_50px_-24px_rgba(8,11,20,0.65)] transition hover:-translate-y-0.5">
            <div className="flex items-center justify-between gap-1">
              <p className="text-xs font-medium text-[#a3b2d6]">{savingsLabel}</p>
              <span
                title="Savings compare your pooled charges against the single-shipment ceiling baseline for the same shipments. Projected savings remain estimates until cutoff locks the final rate."
                className="cursor-help text-[#7a8bb5] hover:text-white"
                aria-label="How savings are calculated"
              >
                <Info className="h-3.5 w-3.5" />
              </span>
            </div>

            {hasValidBaseline ? (
              <>
                <p className="mt-1.5 text-3xl font-bold tracking-tight text-[#82a2ff]">
                  {formatPaise(displayedSavingsPaise)}
                </p>
                <p className="mt-1.5 text-[11px] text-[#c7d3f0]">
                  {hasMixedPricing ? (
                    <>
                      Achieved: {formatPaise(finalizedSavings)} • Projected:{' '}
                      {formatPaise(projectedSavings)}
                    </>
                  ) : displayedSavingsPct !== null ? (
                    <>
                      {displayedSavingsPct}%{' '}
                      {hasFinalizedOnly ? 'saved vs baseline' : 'projected vs baseline'}
                    </>
                  ) : hasFinalizedOnly ? (
                    'Confirmed savings vs baseline'
                  ) : (
                    'Projected vs baseline (non-final)'
                  )}
                </p>
              </>
            ) : (
              <p className="mt-2 text-xs text-[#9aa7c7]">
                Savings will appear after pricing is calculated.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {/* Recent Shipment Activity */}
      {business ? (
        <section className="orbit-reveal-3 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-[0_20px_55px_-28px_rgba(8,11,20,0.16)]">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#080b14] text-white">
                <Package className="h-4 w-4 text-[#82a2ff]" />
              </div>
              <h2 className="text-base font-semibold text-[#080b14]">Recent Shipments</h2>
            </div>
            {recentShipments.length > 0 ? (
              <Link
                to="/shipper/shipments"
                className="inline-flex items-center gap-1.5 rounded-full border border-[#080b14]/15 bg-white px-3.5 py-1.5 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14] hover:bg-[#080b14] hover:text-white"
              >
                View all shipments
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>

          <div className="p-6">
            {shipmentsQuery.isLoading ? (
              <LoadingState title="Loading recent shipments..." />
            ) : recentShipments.length === 0 ? (
              <EmptyState
                icon={<RouteIcon className="h-6 w-6 text-[#080b14]" />}
                title="No shipments booked yet"
                description="Explore active corridors or create your first booking to benefit from pooled freight rates."
                action={
                  <div className="flex flex-wrap justify-center gap-2.5">
                    <Link
                      to="/shipper/book"
                      className="inline-flex items-center gap-1.5 rounded-2xl bg-[#080b14] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#192038]"
                    >
                      <PackagePlus className="h-4 w-4 text-[#82a2ff]" />
                      Book First Shipment
                    </Link>
                    <Link
                      to="/shipper/corridors"
                      className="inline-flex items-center gap-1.5 rounded-2xl border border-[#d5ddf0] bg-white px-4 py-2 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]"
                    >
                      Explore Corridors
                    </Link>
                  </div>
                }
              />
            ) : (
              <div className="divide-y divide-[#eaf0fd]">
                {recentShipments.map((s) => {
                  const corridorObj = typeof s.corridorId === 'object' ? s.corridorId : null;
                  const slotObj = typeof s.slotId === 'object' ? s.slotId : null;
                  const serviceDateRaw = slotObj?.departureDate ?? slotObj?.plannedDepartureAt;
                  const serviceDateText = serviceDateRaw
                    ? new Date(serviceDateRaw).toLocaleDateString('en-IN', {
                        weekday: 'short',
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })
                    : null;

                  const finalCharge = s.pricingSnapshot?.finalLockedPricePaise;
                  const projectedCharge = s.pricingSnapshot?.projectedPricePaise;

                  return (
                    <div
                      key={s._id}
                      className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-lg bg-[#080b14] px-2.5 py-0.5 font-mono text-xs font-semibold text-white">
                            {s.reference}
                          </span>
                          <Badge variant={getShipmentStatusVariant(s.status)}>{s.status}</Badge>
                        </div>
                        <p className="text-xs font-semibold text-[#080b14]">
                          {corridorObj ? `${corridorObj.code} — ${corridorObj.name}` : 'Corridor'}
                        </p>
                        {serviceDateText ? (
                          <p className="inline-flex items-center gap-1 text-[11px] text-[#5c6b94]">
                            <Calendar className="h-3 w-3 text-[#4673eb]" />
                            Service Date: {serviceDateText}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div className="text-left sm:text-right">
                          {typeof finalCharge === 'number' ? (
                            <>
                              <p className="text-sm font-bold text-[#080b14]">
                                {formatPaise(finalCharge)}
                              </p>
                              <p className="text-[11px] text-[#7a87aa]">Final charge</p>
                            </>
                          ) : typeof projectedCharge === 'number' ? (
                            <>
                              <p className="text-sm font-bold text-[#080b14]">
                                {formatPaise(projectedCharge)}
                              </p>
                              <p className="text-[11px] text-[#7a87aa]">Estimated charge</p>
                            </>
                          ) : (
                            <p className="text-[11px] text-[#7a87aa]">Pricing pending</p>
                          )}
                        </div>

                        {s.trackingToken ? (
                          <Link
                            to={`/track/${s.trackingToken}`}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-[#d5ddf0] bg-white px-3.5 py-2 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14] hover:bg-[#080b14] hover:text-white"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            Track
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

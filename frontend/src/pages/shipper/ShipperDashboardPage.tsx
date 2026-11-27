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
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import { useAuthStore } from '../../stores/authStore';
import type { ShipmentStatus } from '../../types/api';

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
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl font-bold text-slate-900">
              {business?.businessName ?? user?.businessName ?? 'Shipper Overview'}
            </h1>
            {user?.email ? (
              <span className="text-xs font-medium text-slate-500">{user.email}</span>
            ) : null}
          </div>
          <p className="mt-0.5 text-sm text-slate-500">
            Book shipments on scheduled corridors, track deliveries, and monitor your pooled savings.
          </p>
        </div>

        <Link to="/shipper/book">
          <Button variant="primary" disabled={!business}>
            <PackagePlus className="h-4 w-4" />
            New Shipment Booking
          </Button>
        </Link>
      </div>

      {/* Business profile notice */}
      {!businessQuery.isLoading && !business ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
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
          <Link to="/shipper/profile">
            <Button size="sm" variant="secondary">
              <Building2 className="h-4 w-4" />
              Set Up Profile
            </Button>
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

      {/* Shipper Summary KPIs */}
      {scoped ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-slate-500">Total Bookings</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{scoped.totalBookings}</p>
              <p className="mt-1 text-[11px] text-slate-500">
                All non-draft shipments for your business
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-slate-500">Active &amp; Delivered</p>
              <div className="mt-1 flex items-baseline gap-3">
                <span className="text-2xl font-bold text-slate-900">{scoped.activeCount}</span>
                <span className="text-xs font-medium text-slate-500">active</span>
                <span className="text-slate-300">•</span>
                <span className="text-xl font-bold text-emerald-700">{scoped.deliveredCount}</span>
                <span className="text-xs font-medium text-slate-500">delivered</span>
              </div>
              {scoped.deliveredCount > 0 ? (
                <p className="mt-1 text-[11px] text-slate-500">
                  {scoped.deliveredCount} completed delivery record(s)
                </p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">
                  In-transit and scheduled shipments
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium text-slate-500">{spendLabel}</p>
              {scoped.hasPricedShipments ? (
                <>
                  <p className="mt-1 text-2xl font-bold text-slate-900">
                    {formatPaise(
                      hasFinalizedOnly ? finalizedSpend : scoped.totalActualOrProjectedSpendPaise
                    )}
                  </p>
                  {hasMixedPricing ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Final: {formatPaise(finalizedSpend)} • Pending cutoff:{' '}
                      {formatPaise(projectedSpend)}
                    </p>
                  ) : hasFinalizedOnly ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Locked final pooled charges
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Updates until corridor cutoff
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-xs text-slate-500">
                  Charges will appear once shipments are priced.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-1">
                <p className="text-xs font-medium text-slate-500">{savingsLabel}</p>
                <span
                  title="Savings compare your pooled charges against the single-shipment ceiling baseline for the same shipments. Projected savings remain estimates until cutoff locks the final rate."
                  className="cursor-help text-slate-400 hover:text-slate-600"
                  aria-label="How savings are calculated"
                >
                  <Info className="h-3.5 w-3.5" />
                </span>
              </div>

              {hasValidBaseline ? (
                <>
                  <p className="mt-1 text-2xl font-bold text-emerald-700">
                    {formatPaise(displayedSavingsPaise)}
                  </p>
                  <p className="mt-1 text-[11px] text-emerald-700">
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
                <p className="mt-2 text-xs text-slate-500">
                  Savings will appear after pricing is calculated.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Recent Shipment Activity */}
      {business ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Package className="h-4 w-4 text-emerald-700" />
              <h2 className="text-base font-semibold text-slate-900">Recent Shipments</h2>
            </div>
            {recentShipments.length > 0 ? (
              <Link
                to="/shipper/shipments"
                className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:text-emerald-800"
              >
                View all shipments
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </CardHeader>
          <CardContent>
            {shipmentsQuery.isLoading ? (
              <LoadingState title="Loading recent shipments..." />
            ) : recentShipments.length === 0 ? (
              <EmptyState
                icon={<RouteIcon className="h-6 w-6" />}
                title="No shipments booked yet"
                description="Explore active corridors or create your first booking to benefit from pooled freight rates."
                action={
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link to="/shipper/book">
                      <Button variant="primary" size="sm">
                        <PackagePlus className="h-4 w-4" />
                        Book First Shipment
                      </Button>
                    </Link>
                    <Link to="/shipper/corridors">
                      <Button variant="outline" size="sm">
                        Explore Corridors
                      </Button>
                    </Link>
                  </div>
                }
              />
            ) : (
              <div className="divide-y divide-slate-100">
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
                      className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs font-bold text-emerald-700">
                            {s.reference}
                          </span>
                          <Badge variant={getShipmentStatusVariant(s.status)}>{s.status}</Badge>
                        </div>
                        <p className="text-xs font-medium text-slate-800">
                          {corridorObj ? `${corridorObj.code} — ${corridorObj.name}` : 'Corridor'}
                        </p>
                        {serviceDateText ? (
                          <p className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                            <Calendar className="h-3 w-3" />
                            Service Date: {serviceDateText}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-center gap-4">
                        <div className="text-left sm:text-right">
                          {typeof finalCharge === 'number' ? (
                            <>
                              <p className="text-xs font-bold text-slate-900">
                                {formatPaise(finalCharge)}
                              </p>
                              <p className="text-[11px] text-slate-500">Final charge</p>
                            </>
                          ) : typeof projectedCharge === 'number' ? (
                            <>
                              <p className="text-xs font-bold text-slate-900">
                                {formatPaise(projectedCharge)}
                              </p>
                              <p className="text-[11px] text-slate-500">Estimated charge</p>
                            </>
                          ) : (
                            <p className="text-[11px] text-slate-500">Pricing pending</p>
                          )}
                        </div>

                        {s.trackingToken ? (
                          <Link to={`/track/${s.trackingToken}`}>
                            <Button variant="outline" size="sm">
                              <ExternalLink className="h-3.5 w-3.5" />
                              Track
                            </Button>
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

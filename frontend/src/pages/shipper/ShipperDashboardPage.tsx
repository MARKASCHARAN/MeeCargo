import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertCircle,
  BarChart3,
  Building2,
  Info,
  PackagePlus,
  Route as RouteIcon,
} from 'lucide-react';
import {
  fetchBusinessProfile,
  fetchHealth,
  fetchOperationalImpactMetrics,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';

export function ShipperDashboardPage() {
  const healthQuery = useQuery({
    queryKey: ['api-health'],
    queryFn: fetchHealth,
    retry: 1,
  });

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

  const metrics = metricsQuery.data?.metrics;

  const utilizationChartData = metrics
    ? [
        {
          name: 'Weight Fill %',
          pct: metrics.platformUtilization.avgVehicleWeightUtilizationPct,
        },
        {
          name: 'Volume Fill %',
          pct: metrics.platformUtilization.avgVehicleVolumeUtilizationPct,
        },
        {
          name: 'Pool Fill Avg %',
          pct: metrics.platformUtilization.avgPoolFillLevelPct,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {business ? business.businessName : 'Shipper Overview'}
          </h1>
          <p className="text-sm text-slate-500">
            Book scheduled corridor slots, track pooled savings, and review utilization metrics.
          </p>
        </div>
        <Link to="/shipper/book">
          <Button variant="primary" disabled={!business}>
            <PackagePlus className="h-4 w-4" />
            New Shipment Booking
          </Button>
        </Link>
      </div>

      {!businessQuery.isLoading && !business ? (
        <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
            <div>
              <h2 className="text-sm font-semibold text-amber-950">
                Complete your B2B Business Profile first
              </h2>
              <p className="text-xs text-amber-800">
                A verified business profile and pickup address are required before creating a shipment booking.
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

      {metrics ? (
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-slate-500">Total Bookings</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {metrics.shipperScoped.totalBookings}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {metrics.shipperScoped.activeCount} active •{' '}
                  {metrics.shipperScoped.deliveredCount} delivered
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-slate-500">Your Pooled Spend (Est.)</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {formatPaise(metrics.shipperScoped.totalActualOrProjectedSpendPaise)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Baseline Ceiling:{' '}
                  {formatPaise(metrics.shipperScoped.totalCeilingBaselinePaise)}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-slate-500">
                  Estimated Savings vs Baseline
                </p>
                <p className="mt-1 text-2xl font-bold text-emerald-700">
                  {formatPaise(metrics.shipperScoped.estimatedSavingsPaise)}
                </p>
                <p className="mt-1 text-[11px] text-emerald-700">
                  {metrics.shipperScoped.estimatedSavingsPct}% (Estimated)
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-slate-500">Road vs Empty Return (Illustrative)</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  {metrics.platformUtilization.totalRoadDistanceKm} km
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  Empty return: {metrics.platformUtilization.emptyReturnDistanceKm} km
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-emerald-700" />
                <h2 className="text-base font-semibold text-slate-900">
                  Operational Impact &amp; Capacity Utilization
                </h2>
              </div>
              <Badge variant="warning">Illustrative / Estimated Figures</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={utilizationChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                    <Tooltip />
                    <Bar dataKey="pct" fill="#059669" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="grid gap-3 text-xs sm:grid-cols-4">
                <div className="rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-500">On-Time Rate (Est.)</span>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {metrics.platformUtilization.onTimeDeliveryRatePct !== null
                      ? `${metrics.platformUtilization.onTimeDeliveryRatePct}%`
                      : 'Pending completed trips'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-500">Failed Delivery Rate</span>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {metrics.platformUtilization.failedDeliveryRatePct}%
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-500">Cost / Delivered Shipment</span>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {metrics.platformUtilization.costPerSuccessfulShipmentPaise !== null
                      ? formatPaise(
                          metrics.platformUtilization.costPerSuccessfulShipmentPaise
                        )
                      : 'Pending deliveries'}
                  </p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <span className="text-slate-500">CO₂ Impact (Est.)</span>
                  <p className="mt-0.5 font-semibold text-slate-900">
                    {metrics.platformUtilization.estimatedCo2ImpactKg !== null
                      ? `${metrics.platformUtilization.estimatedCo2ImpactKg} kg CO₂`
                      : 'Not configured'}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-700" />
                <div className="space-y-1">
                  <p>
                    <strong>Baseline Methodology:</strong>{' '}
                    {metrics.shipperScoped.baselineMethodology}
                  </p>
                  <p>
                    <strong>CO₂ Policy:</strong>{' '}
                    {metrics.platformUtilization.co2Methodology}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Platform Connectivity</h2>
          <Badge variant="info">MeeCargo Automated Backend</Badge>
        </CardHeader>
        <CardContent>
          {healthQuery.isLoading ? (
            <LoadingState
              title="Connecting to MeeCargo API"
              description="Checking backend and database status..."
            />
          ) : healthQuery.isError ? (
            <ErrorState
              title="Backend API unreachable"
              description={healthQuery.error.message}
              onRetry={() => void healthQuery.refetch()}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Database</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {healthQuery.data?.db.connected ? 'Connected' : 'Disconnected'} (
                  {healthQuery.data?.db.readyState})
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Payment Adapter</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {healthQuery.data?.modes.payment}
                </p>
              </div>
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Routing Provider</p>
                <p className="mt-1 text-sm font-semibold text-slate-900">
                  {healthQuery.data?.modes.routing}
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {!metrics?.shipperScoped.totalBookings ? (
        <EmptyState
          icon={<RouteIcon className="h-6 w-6" />}
          title="No shipments booked yet"
          description="Browse scheduled corridors to book your first pooled shipment."
          action={
            <Link to="/shipper/corridors">
              <Button variant="outline" size="sm">
                Explore Corridors
              </Button>
            </Link>
          }
        />
      ) : null}
    </div>
  );
}

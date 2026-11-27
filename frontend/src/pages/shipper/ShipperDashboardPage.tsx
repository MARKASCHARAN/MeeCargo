import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, Building2, PackagePlus, Route as RouteIcon } from 'lucide-react';
import { fetchBusinessProfile, fetchHealth } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {business ? business.businessName : 'Shipper Overview'}
          </h1>
          <p className="text-sm text-slate-500">
            Book scheduled corridor slots and monitor live freight pool utilization.
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

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Platform Connectivity</h2>
          <Badge variant="info">Stage 2 Identity Active</Badge>
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

      <EmptyState
        icon={<RouteIcon className="h-6 w-6" />}
        title="No shipments booked yet"
        description="Corridor browsing, chargeable weight calculation, and live pooling arrive in Stages 3 and 4."
        action={
          <Link to="/shipper/corridors">
            <Button variant="outline" size="sm">
              Explore Corridors
            </Button>
          </Link>
        }
      />
    </div>
  );
}

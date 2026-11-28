import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  ArrowRight,
  Building2,
  MapPin,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { fetchHealth } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardContent } from '../components/ui/Card';

const SAMPLE_TRACK_TOKEN = 'mc_trk_9f4b2a8e1d7c6034a91e5b2f8d04c71a';

export function LandingPage() {
  const { user } = useAuthStore();
  const healthQuery = useQuery({
    queryKey: ['api-health'],
    queryFn: fetchHealth,
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-base font-bold text-slate-900">MeeCargo</span>
              <span className="ml-2 hidden rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline">
                Prototype • UM-02
              </span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to="/become-a-driver"
              className="hidden text-xs font-semibold text-emerald-700 hover:text-emerald-800 sm:inline"
            >
              Become a Driver
            </Link>
            <Link
              to="/driver/application-status"
              className="hidden text-xs font-medium text-slate-600 hover:text-slate-900 md:inline"
            >
              Application Status
            </Link>
            {healthQuery.isLoading ? (
              <Badge variant="neutral">Checking API...</Badge>
            ) : healthQuery.isError ? (
              <Badge variant="danger">API Offline</Badge>
            ) : (
              <Badge variant={healthQuery.data?.db.connected ? 'success' : 'warning'}>
                <Activity className="h-3 w-3" />
                {healthQuery.data?.db.connected ? 'API + DB Online' : 'API Up (DB Disconnected)'}
              </Badge>
            )}

            <Link
              to={
                user
                  ? user.role === 'SHIPPER'
                    ? '/shipper'
                    : user.role === 'PLATFORM_OWNER'
                      ? '/owner'
                      : '/driver'
                  : '/login'
              }
            >
              <Button size="sm" variant="secondary">
                {user ? 'Open Portal' : 'Sign in'}
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="max-w-3xl">
          <Badge variant="info" className="mb-4">
            Automated Crowd-Pooled Freight • No Dispatcher UI
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Affordable shared B2B logistics for semi-urban & rural corridors.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-slate-600 sm:text-lg">
            Combine compatible shipments along scheduled corridors, lock transparent
            pooled pricing at cutoff, and coordinate execution directly between
            shippers, drivers, and recipients.
          </p>
        </div>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          <Card>
            <CardContent className="flex h-full flex-col justify-between">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Building2 className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-900">
                  Shipper Portal
                </h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  Book corridor slots, calculate chargeable weight, monitor live pool
                  utilization, and track deliveries.
                </p>
              </div>
              <Link to="/shipper" className="mt-5 inline-block">
                <Button variant="primary" size="sm" className="w-full justify-between">
                  Enter Shipper Portal
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-full flex-col justify-between">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
                  <Truck className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-900">
                  Driver PWA
                </h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  Mobile-first manifest, LIFO loading plan, QR pickup checks, OTP proof
                  of delivery, and offline event sync.
                </p>
              </div>
              <div className="mt-5 flex flex-col gap-2">
                <Link to="/driver/login" className="inline-block">
                  <Button variant="secondary" size="sm" className="w-full justify-between">
                    Driver Login / Portal
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <div className="flex items-center justify-between text-xs font-medium">
                  <Link to="/become-a-driver" className="text-emerald-700 hover:underline">
                    Become a Driver
                  </Link>
                  <Link to="/driver/application-status" className="text-slate-600 hover:underline">
                    Track Application
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex h-full flex-col justify-between">
              <div>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
                  <MapPin className="h-5 w-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold text-slate-900">
                  Recipient Tracking
                </h2>
                <p className="mt-1.5 text-sm text-slate-600">
                  Tokenized, account-free delivery status page showing safe milestone and
                  arrival window details.
                </p>
              </div>
              <Link to={`/track/${SAMPLE_TRACK_TOKEN}`} className="mt-5 inline-block">
                <Button variant="outline" size="sm" className="w-full justify-between">
                  Preview Tracking Shell
                  <ShieldCheck className="h-4 w-4 text-emerald-600" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

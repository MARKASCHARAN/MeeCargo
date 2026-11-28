import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, MapPin, Package, ShieldCheck } from 'lucide-react';
import { fetchPublicTracking } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/StateViews';

const TRACKING_TOKEN_REGEX = /^[a-zA-Z0-9_-]{24,128}$/;

export function PublicTrackingPage() {
  const { trackingToken } = useParams<{ trackingToken: string }>();
  const isValidFormat = Boolean(trackingToken && TRACKING_TOKEN_REGEX.test(trackingToken));

  const trackQuery = useQuery({
    queryKey: ['public-tracking', trackingToken],
    queryFn: () => fetchPublicTracking(trackingToken!),
    enabled: isValidFormat,
    retry: false,
  });

  if (!isValidFormat) {
    return (
      <ErrorState
        title="Invalid or expired tracking link"
        description="Tracking links require a secure, unguessable token. Please verify the link sent in your shipment notification."
      />
    );
  }

  if (trackQuery.isLoading) {
    return <LoadingState title="Loading shipment status..." />;
  }

  if (trackQuery.isError) {
    return (
      <ErrorState
        title="Tracking link unavailable"
        description={trackQuery.error.message}
        onRetry={() => void trackQuery.refetch()}
      />
    );
  }

  const t = trackQuery.data!.tracking;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-mono text-xs font-bold text-emerald-700">
              {t.reference}
            </p>
            <h1 className="text-lg font-bold text-slate-900">{t.corridorName}</h1>
          </div>
          <Badge variant={t.status === 'DELIVERED' ? 'success' : 'info'}>
            {t.status}
          </Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <MapPin className="mt-0.5 h-4 w-4 text-emerald-600" />
              <div>
                <p className="text-xs text-slate-500">Destination Drop</p>
                <p className="text-sm font-medium text-slate-900">
                  {t.deliveryStopCode} — {t.destinationTown}, {t.destinationDistrict}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <Clock className="mt-0.5 h-4 w-4 text-sky-600" />
              <div>
                <p className="text-xs text-slate-500">Estimated Arrival Window</p>
                <p className="text-sm font-medium text-slate-900">
                  {t.estimatedArrivalWindow
                    ? `${new Date(t.estimatedArrivalWindow.startAt).toLocaleString([], {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })} – ${new Date(t.estimatedArrivalWindow.endAt).toLocaleTimeString([], {
                        timeStyle: 'short',
                      })}`
                    : 'Scheduled'}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
            <Package className="mt-0.5 h-4 w-4 text-slate-500" />
            <div>
              <p className="font-semibold text-slate-900">
                Cargo: {t.cargoSummary.quantity}× {t.cargoSummary.category}
              </p>
              <p className="text-slate-600">{t.cargoSummary.declaredContents}</p>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Milestone Timeline
            </h2>
            <div className="space-y-2">
              {t.milestones.map((m, idx) => (
                <div
                  key={`${m.status}-${idx}`}
                  className="flex items-start justify-between gap-2 rounded-lg border border-slate-100 bg-white px-3 py-2 text-xs"
                >
                  <div>
                    <span className="font-semibold text-slate-900">{m.status}</span>
                    {m.note ? <p className="text-slate-500">{m.note}</p> : null}
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-400">
                    {new Date(m.at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {t.deliveryProof ? (
            <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-950">
              <div className="flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-4 w-4" />
                Delivery Confirmed ({t.deliveryProof.confirmationMode}) at{' '}
                {new Date(t.deliveryProof.verifiedAt).toLocaleString()}
              </div>
              {t.deliveryProof.photoUrl ? (
                <img
                  src={t.deliveryProof.photoUrl}
                  alt="Protected proof of delivery"
                  className="mt-2 max-h-48 rounded-lg border border-emerald-200 object-cover"
                />
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-[11px] text-slate-600">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
            Privacy safeguard: Other shippers&apos; cargo, driver personal phone, and raw GPS coordinates are not exposed here.
          </div>

          <Link to="/" className="inline-block">
            <Button variant="outline" size="sm">
              Return to MeeCargo Home
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

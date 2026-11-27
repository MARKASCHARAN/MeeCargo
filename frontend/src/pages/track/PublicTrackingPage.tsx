import { Link, useParams } from 'react-router-dom';
import { CheckCircle2, Clock, MapPin } from 'lucide-react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { ErrorState } from '../../components/ui/StateViews';

const TRACKING_TOKEN_REGEX = /^[a-zA-Z0-9_-]{24,128}$/;

export function PublicTrackingPage() {
  const { trackingToken } = useParams<{ trackingToken: string }>();
  const isValidFormat = Boolean(trackingToken && TRACKING_TOKEN_REGEX.test(trackingToken));

  if (!isValidFormat) {
    return (
      <ErrorState
        title="Invalid or expired tracking link"
        description="Tracking links require a secure, unguessable token. Please verify the link sent in your shipment notification."
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Recipient Tracking Shell
            </p>
            <h1 className="text-lg font-bold text-slate-900">
              Shipment Status Preview
            </h1>
          </div>
          <Badge variant="info">Token Verified Format</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            Token: <code className="font-mono text-slate-900">{trackingToken}</code>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <MapPin className="mt-0.5 h-4 w-4 text-emerald-600" />
              <div>
                <p className="text-xs text-slate-500">Corridor Route</p>
                <p className="text-sm font-medium text-slate-900">
                  Vadodara → Anand → Nadiad → Ahmedabad
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-lg border border-slate-200 p-3">
              <Clock className="mt-0.5 h-4 w-4 text-sky-600" />
              <div>
                <p className="text-xs text-slate-500">Privacy Notice</p>
                <p className="text-sm font-medium text-slate-900">
                  Only recipient-safe milestones & ETA windows are shown.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            Live shipment event lookup via backend API will be connected in Stage 7 (MC-029).
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

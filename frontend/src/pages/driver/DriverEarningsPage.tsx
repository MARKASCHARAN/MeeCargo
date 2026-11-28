import { useQuery } from '@tanstack/react-query';
import { Wallet, CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import { fetchDriverTier2Earnings } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';

export function DriverEarningsPage() {
  const earningsQuery = useQuery({
    queryKey: ['driver-tier2-earnings'],
    queryFn: fetchDriverTier2Earnings,
  });

  if (earningsQuery.isLoading) {
    return <LoadingState title="Loading Tier 2 marketplace earnings..." />;
  }

  if (earningsQuery.isError) {
    return (
      <ErrorState
        title="Unable to load earnings"
        description={
          earningsQuery.error instanceof Error
            ? earningsQuery.error.message
            : 'Unable to load Tier 2 earnings ledger'
        }
        onRetry={() => void earningsQuery.refetch()}
      />
    );
  }

  const summary = earningsQuery.data?.summary;
  const earnings = earningsQuery.data?.earnings ?? [];

  return (
    <div className="space-y-4 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900">Marketplace Earnings</h1>
          <p className="text-xs text-slate-500">
            Fixed platform-determined spot payouts locked on job acceptance (no Tier 1 guarantees).
          </p>
        </div>
        <Badge variant="info">SIMULATED LEDGER</Badge>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Total Completed Earned</span>
                <Wallet className="h-4 w-4 text-emerald-700" />
              </div>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatPaise(summary.totalEarnedPaise)}
              </p>
              <p className="text-[11px] text-slate-500">
                {summary.completedTripsCount} completed marketplace trip(s)
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Pending Settlement</span>
                <Clock className="h-4 w-4 text-amber-600" />
              </div>
              <p className="mt-1 text-xl font-bold text-amber-800">
                {formatPaise(summary.pendingSettlementPaise)}
              </p>
              <p className="text-[11px] text-slate-500">
                Active accepted: {formatPaise(summary.activeAcceptedPaise)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>Paid Out (Simulated)</span>
                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
              </div>
              <p className="mt-1 text-xl font-bold text-emerald-700">
                {formatPaise(summary.paidPaise)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between text-xs text-slate-500">
                <span>On Hold / Disputed</span>
                <AlertTriangle className="h-4 w-4 text-rose-600" />
              </div>
              <p className="mt-1 text-xl font-bold text-slate-900">
                {formatPaise(summary.onHoldOrDisputedPaise)}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="flex items-center gap-2 rounded-lg bg-slate-200/70 px-3 py-2 text-[11px] text-slate-700">
        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
        Simulation notice: Settlement transactions are simulated platform payout ledger entries.
      </div>

      {earnings.length === 0 ? (
        <EmptyState
          title="No marketplace earnings yet"
          description="Accept and complete eligible OVERFLOW, RIGHT_SIZING, EXPRESS, or NEW_ROUTE jobs from the Marketplace tab."
        />
      ) : (
        <div className="space-y-3">
          {earnings.map((item) => (
            <Card key={item._id}>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-800">
                      {item.earningCode}
                    </span>
                    <Badge variant="neutral">{item.opportunityType}</Badge>
                  </div>
                  <p className="mt-0.5 text-xs font-semibold text-slate-900">
                    {item.opportunityId
                      ? `${item.opportunityId.originLabel} -> ${item.opportunityId.destinationLabel}`
                      : item.tripId?.tripCode ?? 'Marketplace Trip'}
                  </p>
                </div>
                <Badge
                  variant={
                    item.status === 'PAID'
                      ? 'success'
                      : item.status === 'TRIP_COMPLETED' || item.status === 'PENDING_SETTLEMENT'
                        ? 'info'
                        : item.status === 'ON_HOLD' || item.status === 'DISPUTED' || item.status === 'REVERSED'
                          ? 'danger'
                          : 'warning'
                  }
                >
                  {item.status}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs text-slate-600">
                <div className="flex justify-between">
                  <span>Locked Spot Payout (Policy {item.policyVersion}):</span>
                  <strong className="text-slate-900">{formatPaise(item.grossPayoutPaise)}</strong>
                </div>
                {item.adjustmentsPaise !== 0 ? (
                  <div className="flex justify-between">
                    <span>Adjustments:</span>
                    <strong>{formatPaise(item.adjustmentsPaise)}</strong>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-slate-100 pt-1">
                  <span>Net Payable:</span>
                  <strong className="text-emerald-700">{formatPaise(item.netPayablePaise)}</strong>
                </div>
                {item.settlementRef ? (
                  <p className="font-mono text-[11px] text-emerald-800">
                    Settlement Ref: {item.settlementRef} (
                    {item.settledAt ? new Date(item.settledAt).toLocaleString('en-IN') : ''})
                  </p>
                ) : null}
                {item.holdOrDisputeReason || item.reversalReason ? (
                  <p className="text-[11px] text-rose-700">
                    Note: {item.holdOrDisputeReason ?? item.reversalReason}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

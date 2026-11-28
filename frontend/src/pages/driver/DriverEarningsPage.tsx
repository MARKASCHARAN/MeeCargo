import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Clock, ShieldCheck, Wallet } from 'lucide-react';
import { fetchDriverTier2Earnings } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/StateViews';
import { formatPaise } from '@/lib/format';

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
    <div className="space-y-6 pb-8">
      {/* Editorial Orbit Header */}
      <section className="orbit-reveal-1 flex flex-wrap items-center justify-between gap-3 rounded-[28px] border border-[#dce5fa] bg-white/95 p-5 shadow-[0_18px_55px_-28px_rgba(24,60,115,0.22)] sm:p-7">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#7a94df]">
            Tier 2 Spot Payouts
          </p>
          <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-[#080e2b] sm:text-[36px]">
            Marketplace{' '}
            <em
              className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
              style={{ fontStyle: 'italic' }}
            >
              earnings.
            </em>
          </h1>
          <p className="mt-1 text-xs text-[#5c6b94] sm:text-sm">
            Fixed platform-determined spot payouts locked on job acceptance (no Tier 1 guarantees).
          </p>
        </div>
        <span className="rounded-full border border-[#cddbfa] bg-[#eef3ff] px-3.5 py-1 text-xs font-semibold text-[#3563e4]">
          SIMULATED LEDGER
        </span>
      </section>

      {summary ? (
        <div className="orbit-reveal-2 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs text-[#5c6b94]">
              <span>Total Earned</span>
              <Wallet className="h-4 w-4 text-[#4673eb]" />
            </div>
            <p className="mt-2 text-2xl font-bold text-[#080e2b]">
              {formatPaise(summary.totalEarnedPaise)}
            </p>
            <p className="mt-1 text-[11px] text-[#7a87aa]">
              {summary.completedTripsCount} completed marketplace trip(s)
            </p>
          </div>

          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs text-[#5c6b94]">
              <span>Pending Settlement</span>
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <p className="mt-2 text-2xl font-bold text-amber-800">
              {formatPaise(summary.pendingSettlementPaise)}
            </p>
            <p className="mt-1 text-[11px] text-[#7a87aa]">
              Active accepted: {formatPaise(summary.activeAcceptedPaise)}
            </p>
          </div>

          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs text-[#5c6b94]">
              <span>Paid Out</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <p className="mt-2 text-2xl font-bold text-emerald-700">
              {formatPaise(summary.paidPaise)}
            </p>
            <p className="mt-1 text-[11px] text-[#7a87aa]">Simulated settlement</p>
          </div>

          <div className="rounded-[24px] border border-[#dce5fa] bg-white/95 p-5 shadow-xs">
            <div className="flex items-center justify-between text-xs text-[#5c6b94]">
              <span>On Hold / Disputed</span>
              <AlertTriangle className="h-4 w-4 text-rose-600" />
            </div>
            <p className="mt-2 text-2xl font-bold text-[#080e2b]">
              {formatPaise(summary.onHoldOrDisputedPaise)}
            </p>
            <p className="mt-1 text-[11px] text-[#7a87aa]">Under audit review</p>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2.5 rounded-2xl border border-[#cddbfa] bg-[#eef3ff]/70 px-4 py-3 text-xs text-[#3b476b]">
        <ShieldCheck className="h-4 w-4 shrink-0 text-[#4673eb]" />
        <span>
          Simulation notice: Settlement transactions are simulated platform payout ledger entries.
        </span>
      </div>

      {earnings.length === 0 ? (
        <EmptyState
          title="No marketplace earnings yet"
          description="Accept and complete eligible OVERFLOW, RIGHT_SIZING, EXPRESS, or NEW_ROUTE jobs from the Marketplace tab."
        />
      ) : (
        <div className="orbit-reveal-3 grid gap-4 lg:grid-cols-2">
          {earnings.map((item) => (
            <div
              key={item._id}
              className="overflow-hidden rounded-[24px] border border-[#dce5fa] bg-white/95 shadow-xs transition hover:border-[#b7caf7]"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-5 py-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-[#3563e4]">
                      {item.earningCode}
                    </span>
                    <Badge variant="neutral">{item.opportunityType}</Badge>
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#080e2b]">
                    {item.opportunityId
                      ? `${item.opportunityId.originLabel} → ${item.opportunityId.destinationLabel}`
                      : item.tripId?.tripCode ?? 'Marketplace Trip'}
                  </p>
                </div>
                <Badge
                  variant={
                    item.status === 'PAID'
                      ? 'success'
                      : item.status === 'TRIP_COMPLETED' || item.status === 'PENDING_SETTLEMENT'
                        ? 'info'
                        : item.status === 'ON_HOLD' ||
                            item.status === 'DISPUTED' ||
                            item.status === 'REVERSED'
                          ? 'danger'
                          : 'warning'
                  }
                >
                  {item.status}
                </Badge>
              </div>

              <div className="space-y-2 p-5 text-xs text-[#4d5a83]">
                <div className="flex justify-between">
                  <span>Locked Spot Payout (Policy {item.policyVersion}):</span>
                  <strong className="text-[#080e2b]">
                    {formatPaise(item.grossPayoutPaise)}
                  </strong>
                </div>
                {item.adjustmentsPaise !== 0 ? (
                  <div className="flex justify-between">
                    <span>Adjustments:</span>
                    <strong className="text-[#080e2b]">{formatPaise(item.adjustmentsPaise)}</strong>
                  </div>
                ) : null}
                <div className="flex justify-between border-t border-[#eaf0fd] pt-2">
                  <span className="font-medium text-[#080e2b]">Net Payable:</span>
                  <strong className="text-sm text-emerald-700">
                    {formatPaise(item.netPayablePaise)}
                  </strong>
                </div>
                {item.settlementRef ? (
                  <p className="font-mono text-[11px] text-[#3563e4]">
                    Settlement Ref: {item.settlementRef} (
                    {item.settledAt ? new Date(item.settledAt).toLocaleString('en-IN') : ''})
                  </p>
                ) : null}
                {item.holdOrDisputeReason || item.reversalReason ? (
                  <p className="text-[11px] text-rose-700">
                    Note: {item.holdOrDisputeReason ?? item.reversalReason}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

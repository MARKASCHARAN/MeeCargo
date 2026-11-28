import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, Sliders, Wallet, Zap } from 'lucide-react';
import {
  fetchOwnerMarketplaceOpportunities,
  fetchOwnerMarketplacePolicy,
  fetchOwnerTier2Earnings,
  reassignOwnerOpportunity,
  settleOwnerTier2Earning,
  updateOwnerMarketplacePolicy,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import type { MarketplaceOpportunityType } from '../../types/api';

const ALL_TYPES: MarketplaceOpportunityType[] = [
  'OVERFLOW',
  'RIGHT_SIZING',
  'EXPRESS',
  'NEW_ROUTE',
];

export function OwnerMarketplacePage() {
  const queryClient = useQueryClient();
  const [banner, setBanner] = useState<string | null>(null);

  const policyQuery = useQuery({
    queryKey: ['owner-marketplace-policy'],
    queryFn: fetchOwnerMarketplacePolicy,
  });
  const oppsQuery = useQuery({
    queryKey: ['owner-marketplace-opps'],
    queryFn: () => fetchOwnerMarketplaceOpportunities(),
  });
  const earningsQuery = useQuery({
    queryKey: ['owner-tier2-earnings'],
    queryFn: () => fetchOwnerTier2Earnings(),
  });

  const [earlyRefusalMin, setEarlyRefusalMin] = useState<number | null>(null);
  const [offerExpiryMin, setOfferExpiryMin] = useState<number | null>(null);
  const [rightSizingMinPaise, setRightSizingMinPaise] = useState<number | null>(null);
  const [newRouteFillPct, setNewRouteFillPct] = useState<number | null>(null);

  const policyMutation = useMutation({
    mutationFn: updateOwnerMarketplacePolicy,
    onSuccess: (res) => {
      setBanner(`Saved policy version ${res.policy.policyVersion}`);
      void queryClient.invalidateQueries({ queryKey: ['owner-marketplace-policy'] });
    },
  });

  const reassignMutation = useMutation({
    mutationFn: (id: string) =>
      reassignOwnerOpportunity(id, 'Platform Owner triggered Tier 2 reassignment'),
    onSuccess: () => {
      setBanner('Triggered automated Tier 2 reassignment.');
      void queryClient.invalidateQueries({ queryKey: ['owner-marketplace-opps'] });
      void queryClient.invalidateQueries({ queryKey: ['owner-tier2-earnings'] });
    },
  });

  const settleMutation = useMutation({
    mutationFn: (id: string) => settleOwnerTier2Earning(id),
    onSuccess: (res) => {
      setBanner(`Simulated settlement paid: ${res.earning.settlementRef}`);
      void queryClient.invalidateQueries({ queryKey: ['owner-tier2-earnings'] });
    },
    onError: (err: Error) => setBanner(err.message),
  });

  if (policyQuery.isLoading || oppsQuery.isLoading || earningsQuery.isLoading) {
    return <LoadingState title="Loading Tier 2 Marketplace Governance & Settlements..." />;
  }

  const policy = policyQuery.data?.policy;
  const opps = oppsQuery.data?.opportunities ?? [];
  const earningsData = earningsQuery.data;

  const toggleType = (type: MarketplaceOpportunityType) => {
    if (!policy) return;
    const exists = policy.enabledOpportunityTypes.includes(type);
    const nextTypes = exists
      ? policy.enabledOpportunityTypes.filter((t) => t !== type)
      : [...policy.enabledOpportunityTypes, type];
    if (nextTypes.length === 0) return;
    policyMutation.mutate({ enabledOpportunityTypes: nextTypes });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Tier 2 Marketplace Governance &amp; Settlements
        </h1>
        <p className="text-sm text-slate-500">
          Automated Tier 1 priority rules, Tier 2 fixed spot-payout policy, exception reassignment, and simulated settlement approvals.
        </p>
      </div>

      {banner ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs text-emerald-900">
          <CheckCircle2 className="h-4 w-4" />
          <span>{banner}</span>
        </div>
      ) : null}

      {policy ? (
        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sliders className="h-4 w-4 text-emerald-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Hybrid Dispatch &amp; Payout Policy
              </h2>
            </div>
            <Badge variant="neutral">{policy.policyVersion}</Badge>
          </CardHeader>
          <CardContent className="space-y-4 text-xs">
            <div>
              <p className="mb-2 font-semibold text-slate-700">Enabled Marketplace Opportunity Types:</p>
              <div className="flex flex-wrap gap-2">
                {ALL_TYPES.map((type) => {
                  const active = policy.enabledOpportunityTypes.includes(type);
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleType(type)}
                      className={`rounded-full px-3 py-1 font-semibold border ${
                        active
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                          : 'border-slate-200 bg-slate-50 text-slate-500'
                      }`}
                    >
                      {type} {active ? '✓' : '✕'}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-4">
              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Early-Fill Tier 1 Refusal (min)
                </label>
                <input
                  type="number"
                  value={earlyRefusalMin ?? policy.earlyFillFirstRefusalMin}
                  onChange={(e) => setEarlyRefusalMin(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Offer Expiry Window (min)
                </label>
                <input
                  type="number"
                  value={offerExpiryMin ?? policy.offerExpiryMin}
                  onChange={(e) => setOfferExpiryMin(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  Min Right-Sizing Savings (₹)
                </label>
                <input
                  type="number"
                  value={(rightSizingMinPaise ?? policy.rightSizingMinNetSavingsPaise) / 100}
                  onChange={(e) => setRightSizingMinPaise(Math.round(Number(e.target.value) * 100))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
              <div>
                <label className="mb-1 block font-medium text-slate-700">
                  New-Route Viability Fill (%)
                </label>
                <input
                  type="number"
                  value={newRouteFillPct ?? policy.newRouteViabilityThresholdPct}
                  onChange={(e) => setNewRouteFillPct(Number(e.target.value))}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5"
                />
              </div>
            </div>

            <Button
              size="sm"
              variant="primary"
              disabled={policyMutation.isPending}
              onClick={() =>
                policyMutation.mutate({
                  earlyFillFirstRefusalMin: earlyRefusalMin ?? policy.earlyFillFirstRefusalMin,
                  offerExpiryMin: offerExpiryMin ?? policy.offerExpiryMin,
                  rightSizingMinNetSavingsPaise:
                    rightSizingMinPaise ?? policy.rightSizingMinNetSavingsPaise,
                  newRouteViabilityThresholdPct:
                    newRouteFillPct ?? policy.newRouteViabilityThresholdPct,
                })
              }
            >
              Save Policy Thresholds
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-amber-600" />
              <h2 className="text-base font-semibold text-slate-900">
                Marketplace Opportunities ({opps.length})
              </h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {opps.length === 0 ? (
              <p className="text-slate-500">No marketplace opportunities generated yet.</p>
            ) : (
              opps.slice(0, 20).map((opp) => (
                <div
                  key={String(opp._id)}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-emerald-800">
                        {opp.opportunityCode}
                      </span>
                      <Badge variant="neutral">{opp.opportunityType}</Badge>
                      <Badge variant={opp.status === 'ASSIGNED' || opp.status === 'COMPLETED' ? 'success' : 'info'}>
                        {opp.status}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-slate-700">
                      {opp.originLabel} -&gt; {opp.destinationLabel} •{' '}
                      <strong>{formatPaise(opp.payoutQuote.spotPayoutPaise)}</strong>
                    </p>
                  </div>
                  {(opp.status === 'ASSIGNED' || opp.status === 'OFFERED') ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={reassignMutation.isPending}
                      onClick={() => reassignMutation.mutate(String(opp._id))}
                    >
                      <RefreshCw className="h-3 w-3" />
                      Reassign
                    </Button>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wallet className="h-4 w-4 text-emerald-700" />
              <h2 className="text-base font-semibold text-slate-900">
                Tier 2 Driver Earnings &amp; Simulated Settlements
              </h2>
            </div>
            <Badge variant="info">
              Pending: {formatPaise(earningsData?.totals.pendingSettlementPaise ?? 0)}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-xs">
            {(earningsData?.earnings ?? []).length === 0 ? (
              <p className="text-slate-500">No Tier 2 earnings records yet.</p>
            ) : (
              (earningsData?.earnings ?? []).slice(0, 20).map((earning) => (
                <div
                  key={earning._id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-2.5"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold">{earning.earningCode}</span>
                      <Badge variant={earning.status === 'PAID' ? 'success' : 'warning'}>
                        {earning.status}
                      </Badge>
                    </div>
                    <p className="text-slate-700">
                      {earning.driverUserId?.name ?? 'Tier 2 Driver'} •{' '}
                      <strong>{formatPaise(earning.netPayablePaise)}</strong>
                    </p>
                  </div>
                  {(earning.status === 'TRIP_COMPLETED' ||
                    earning.status === 'PENDING_SETTLEMENT') ? (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={settleMutation.isPending}
                      onClick={() => settleMutation.mutate(earning._id)}
                    >
                      Settle (Simulated)
                    </Button>
                  ) : earning.settlementRef ? (
                    <span className="font-mono text-[10px] text-emerald-700">
                      {earning.settlementRef}
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

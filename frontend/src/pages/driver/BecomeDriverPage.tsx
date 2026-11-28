import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeIndianRupee,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { fetchPublicTier2Policy } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';

export function BecomeDriverPage() {
  const policyQuery = useQuery({
    queryKey: ['public-tier2-policy'],
    queryFn: fetchPublicTier2Policy,
  });

  const policy = policyQuery.data?.policy;
  const maxMb = policy ? Math.round(policy.maxFileSizeBytes / (1024 * 1024)) : 5;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
              <Truck className="h-5 w-5" />
            </div>
            <div>
              <span className="text-base font-bold text-slate-900">MeeCargo</span>
              <span className="ml-2 hidden rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 sm:inline">
                Tier 2 Driver Partner Program
              </span>
            </div>
          </Link>

          <div className="flex items-center gap-2">
            <Link to="/driver/application-status">
              <Button size="sm" variant="ghost">
                Check Status
              </Button>
            </Link>
            <Link to="/driver/login">
              <Button size="sm" variant="secondary">
                Driver Login
              </Button>
            </Link>
            <Link to="/driver/apply">
              <Button size="sm" variant="primary">
                Apply Now
              </Button>
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6 space-y-8">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
          <Badge variant="info" className="mb-3">
            Independent Marketplace Fleet (Tier 2)
          </Badge>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Drive with your own commercial vehicle on MeeCargo
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-slate-600 sm:text-base">
            Join MeeCargo&apos;s Tier 2 independent driver network to pick up marketplace and overflow
            B2B corridor loads using your own vehicle, on transparent per-km payouts.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/driver/apply">
              <Button variant="primary" size="md">
                Start Tier 2 Application
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link to="/driver/application-status">
              <Button variant="outline" size="md">
                Track Existing Application
              </Button>
            </Link>
            <Link to="/driver/login">
              <Button variant="secondary" size="md">
                Already Approved? Driver Login
              </Button>
            </Link>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardContent className="space-y-2 pt-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
                <Truck className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Bring Your Own Vehicle</h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Closed body LCVs, pickups, flatbeds, and containers with valid commercial RC and
                goods insurance qualify for Tier 2 onboarding.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-100 text-sky-700">
                <BadgeIndianRupee className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Per-km Marketplace Payouts</h2>
              <p className="text-xs leading-relaxed text-slate-600">
                {policy?.payoutPolicySummary ??
                  'Tier 2 drivers participate independently on per-km marketplace payouts without Tier 1 contracts or minimum guarantees.'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 pt-5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <h2 className="text-sm font-bold text-slate-900">Verified Marketplace Access</h2>
              <p className="text-xs leading-relaxed text-slate-600">
                Every application is reviewed by the Platform Owner. Once approved, marketplace trip
                opportunities unlock inside your existing Driver Portal.
              </p>
            </CardContent>
          </Card>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader className="border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileCheck2 className="h-4 w-4 text-emerald-700" />
                <h2 className="text-sm font-bold text-slate-900">Required Documents</h2>
              </div>
              <p className="text-xs text-slate-500">
                Upload clear JPEG, PNG, WebP, or PDF scans (max {maxMb} MB per file).
              </p>
            </CardHeader>
            <CardContent className="space-y-2.5 pt-4 text-xs text-slate-700">
              {(policy?.requiredDocuments ?? [
                { docType: 'DRIVING_LICENSE', label: 'Commercial Driving License', required: true },
                {
                  docType: 'IDENTITY_PROOF',
                  label: 'Government Identity Proof (Aadhaar / PAN / Passport / Voter ID)',
                  required: true,
                },
                { docType: 'VEHICLE_RC', label: 'Vehicle Registration Certificate (RC)', required: true },
                {
                  docType: 'INSURANCE_POLICY',
                  label: 'Commercial Goods Insurance Policy',
                  required: true,
                },
              ]).map((doc) => (
                <div
                  key={doc.docType}
                  className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                    <span className="font-medium text-slate-800">{doc.label}</span>
                  </div>
                  <Badge variant="neutral">{doc.required ? 'Required' : 'Optional'}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4 text-emerald-700" />
                <h2 className="text-sm font-bold text-slate-900">Approval Workflow</h2>
              </div>
              <p className="text-xs text-slate-500">
                Simple 3-step verification before driving on MeeCargo.
              </p>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs text-slate-700">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">1. Submit Application &amp; Documents</p>
                <p className="mt-1 text-slate-600">
                  Provide personal contact info, vehicle payload/bed dimensions, and upload required
                  identity &amp; vehicle documents. You immediately receive a tracking reference ID.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">2. Platform Owner Review</p>
                <p className="mt-1 text-slate-600">
                  Our single Platform Owner verifies your documents and vehicle specifications. Your
                  status remains <strong>PENDING</strong> until review completes.
                </p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="font-semibold text-slate-900">3. Sign In &amp; Accept Marketplace Loads</p>
                <p className="mt-1 text-slate-600">
                  Once status becomes <strong>APPROVED</strong>, sign in at Driver Login to view
                  eligible trips matched to your vehicle&apos;s weight and volume capacity.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}

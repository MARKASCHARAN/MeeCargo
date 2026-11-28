import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Mail,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react';
import {
  ApiError,
  fetchDriverTier2Application,
  lookupPublicTier2Status,
  openAuthenticatedDriverDocument,
} from '@/api/client';
import { OrbitDriverLayout } from '@/components/driver/OrbitDriverLayout';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';
import type { PublicTier2StatusSummary, Tier2ApplicationStatus } from '@/types/api';

function getStatusPillClasses(status: Tier2ApplicationStatus) {
  if (status === 'APPROVED') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }
  if (status === 'REJECTED') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }
  return 'border-amber-200 bg-amber-50 text-amber-800';
}

function VerificationTimeline({ status }: { status: Tier2ApplicationStatus }) {
  const isApproved = status === 'APPROVED';
  const isRejected = status === 'REJECTED';

  const stages = [
    {
      label: 'Application Submitted',
      sub: 'Docs & vehicle specs logged',
      state: 'done' as const,
    },
    {
      label: 'Platform Owner Review',
      sub: isRejected ? 'Action needed on submission' : isApproved ? 'Verification passed' : 'In verification queue',
      state: isApproved || isRejected ? ('done' as const) : ('active' as const),
    },
    {
      label: isRejected ? 'Needs Resubmission' : 'Marketplace Unlocked',
      sub: isApproved
        ? 'Eligible for Tier 2 loads'
        : isRejected
          ? 'Review feedback below'
          : 'Awaiting owner sign-off',
      state: isApproved ? ('done' as const) : isRejected ? ('error' as const) : ('pending' as const),
    },
  ];

  return (
    <div className="grid gap-3 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4 sm:grid-cols-3">
      {stages.map((stage, idx) => (
        <div key={stage.label} className="flex items-start gap-3">
          <div className="relative mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
            {stage.state === 'active' && (
              <span className="orbit-pulse-ring absolute inset-0 rounded-full bg-[#4673eb]/35" />
            )}
            <span
              className={cn(
                'relative flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold',
                stage.state === 'done' && 'bg-[#4673eb] text-white',
                stage.state === 'active' && 'border-2 border-[#4673eb] bg-white text-[#4673eb]',
                stage.state === 'error' && 'bg-rose-600 text-white',
                stage.state === 'pending' && 'border border-[#cddbfa] bg-white text-[#8a98bd]'
              )}
            >
              {idx + 1}
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold text-[#080e2b]">{stage.label}</p>
            <p className="mt-0.5 text-[11px] text-[#5c6b94]">{stage.sub}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function Tier2ApplicationStatusPage() {
  const { user, accessToken } = useAuthStore();
  const isSignedInDriver = Boolean(user && accessToken && user.role === 'DRIVER');

  const signedInAppQuery = useQuery({
    queryKey: ['driver-tier2-status-signed-in'],
    queryFn: fetchDriverTier2Application,
    enabled: isSignedInDriver,
  });

  const [applicationRef, setApplicationRef] = useState('');
  const [email, setEmail] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<PublicTier2StatusSummary | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const handleLookup = async (e: FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setLookupLoading(true);
    try {
      const res = await lookupPublicTier2Status({
        applicationRef: applicationRef.trim(),
        email: email.trim(),
      });
      setLookupResult(res);
    } catch (err) {
      setLookupResult(null);
      setLookupError(
        err instanceof ApiError ? err.message : 'Unable to find matching application.'
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const fillDemo = (ref: string, mail: string) => {
    setApplicationRef(ref);
    setEmail(mail);
    setLookupError(null);
  };

  const signedInApp = signedInAppQuery.data?.application ?? null;

  return (
    <OrbitDriverLayout
      brandSub="tier 2 status"
      headerCtaLabel="New Application"
      headerCtaTo="/driver/apply"
    >
      <div className="mx-auto max-w-5xl space-y-8 px-5 pb-14 pt-6 sm:px-8 lg:pt-10">
        {/* Editorial Hero Header */}
        <section className="orbit-reveal-1 flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#7a94df]">
              Tier 2 Verification Tracker
            </p>
            <h1 className="text-[38px] font-[550] leading-[1.05] tracking-[-0.05em] text-[#080e2b] sm:text-[50px]">
              Track your{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#4a72e7]"
                style={{ fontStyle: 'italic' }}
              >
                application status.
              </em>
            </h1>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5c6b94]">
              Check real-time review milestones with your tracking reference ID and registered email,
              or view your active driver verification card when signed in.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium">
            <Link
              to="/become-a-driver"
              className="rounded-full border border-[#dce5fa] bg-white px-4 py-2 text-[#4d5a83] transition hover:border-[#4673eb] hover:text-[#080e2b]"
            >
              Program Overview
            </Link>
            <Link
              to="/driver/login"
              className="inline-flex items-center gap-1.5 rounded-full border border-[#cddbfa] bg-[#eef3ff] px-4 py-2 text-[#3563e4] transition hover:bg-[#dfe9ff]"
            >
              Driver Login
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </section>

        {/* Signed-in Driver Card (exact authenticated backend integration preserved) */}
        {isSignedInDriver && signedInApp ? (
          <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#b7caf7] bg-white/95 shadow-[0_24px_65px_-28px_rgba(24,60,115,0.26)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6edfc] bg-[#f7faff] px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#4673eb] text-white shadow-xs">
                  <Truck className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7a94df]">
                    Signed-in Driver Application
                  </p>
                  <h2 className="text-base font-semibold text-[#080e2b]">
                    {signedInApp.fullName}{' '}
                    {signedInApp.applicationRef ? (
                      <span className="ml-1.5 rounded-lg border border-[#dce5fa] bg-white px-2 py-0.5 font-mono text-xs font-medium text-[#4d5a83]">
                        {signedInApp.applicationRef}
                      </span>
                    ) : null}
                  </h2>
                </div>
              </div>

              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
                  getStatusPillClasses(signedInApp.status)
                )}
              >
                {signedInApp.status === 'PENDING' && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                )}
                {signedInApp.status}
              </span>
            </div>

            <div className="space-y-5 p-6 text-xs text-[#4d5a83]">
              <VerificationTimeline status={signedInApp.status} />

              <div className="grid gap-3 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4 sm:grid-cols-2">
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Submitted At</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {new Date(signedInApp.appliedAt).toLocaleString('en-IN')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Registered Vehicle</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {signedInApp.vehicle.registrationNumber} ({signedInApp.vehicle.vehicleCategory})
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Documents Verification</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {signedInApp.documents.verificationStatus}
                  </p>
                </div>
                {signedInApp.approvedAt ? (
                  <div>
                    <p className="text-[11px] text-[#7a87aa]">Approved At</p>
                    <p className="mt-0.5 font-semibold text-emerald-700">
                      {new Date(signedInApp.approvedAt).toLocaleString('en-IN')}
                    </p>
                  </div>
                ) : null}
              </div>

              {signedInApp.status === 'REJECTED' && signedInApp.rejectionReason ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
                  <p className="font-semibold">Rejection Reason</p>
                  <p className="mt-1 leading-relaxed">{signedInApp.rejectionReason}</p>
                </div>
              ) : null}

              {signedInApp.uploadedDocuments && signedInApp.uploadedDocuments.length > 0 ? (
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-[#080e2b]">
                    Uploaded Verification Documents
                  </p>
                  {docError ? <p className="text-rose-700">{docError}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    {signedInApp.uploadedDocuments.map((doc) => (
                      <button
                        key={doc.storageKey}
                        type="button"
                        onClick={async () => {
                          setDocError(null);
                          try {
                            await openAuthenticatedDriverDocument(
                              `/api/v1/driver/tier2-application/documents/${doc.storageKey}`
                            );
                          } catch (err) {
                            setDocError(
                              err instanceof Error ? err.message : 'Unable to open document'
                            );
                          }
                        }}
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[#d6e0f8] bg-white px-3.5 py-2 text-xs font-medium text-[#080e2b] transition hover:border-[#4673eb] hover:bg-[#eef3ff]"
                      >
                        <FileText className="h-3.5 w-3.5 text-[#4673eb]" />
                        <span>{doc.docType}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="pt-1">
                <Link
                  to="/driver"
                  className="inline-flex items-center gap-2 rounded-[22px] bg-[#4673eb] px-5 py-2.5 text-xs font-medium text-white shadow-xs transition hover:bg-[#345fda]"
                >
                  {signedInApp.status === 'APPROVED'
                    ? 'Open Driver Marketplace'
                    : signedInApp.status === 'REJECTED'
                      ? 'Update & Resubmit in Driver Portal'
                      : 'Open Driver Portal'}
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          </section>
        ) : null}

        {/* Public Reference Lookup Card */}
        <section className="orbit-reveal-3 rounded-[28px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_24px_70px_-28px_rgba(24,60,115,0.22)] backdrop-blur-sm sm:p-8">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0fd] pb-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#4673eb]">
                <Search className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-[#080e2b]">Public Reference Lookup</h2>
                <p className="text-xs text-[#5c6b94]">
                  Check your live review status without signing in using your reference ID and email.
                </p>
              </div>
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce5fa] bg-[#f8faff] px-3 py-1 text-[11px] font-medium text-[#5c6b94]">
              <ShieldCheck className="h-3.5 w-3.5 text-[#4673eb]" />
              Zero-login Verification
            </span>
          </div>

          <form onSubmit={handleLookup} className="mt-6 grid gap-4 sm:grid-cols-12">
            <label className="block space-y-1.5 text-xs sm:col-span-4">
              <span className="font-medium text-[#3b476b]">Application Reference</span>
              <input
                required
                value={applicationRef}
                onChange={(e) => setApplicationRef(e.target.value)}
                placeholder="MC-T2-..."
                className="orbit-input font-mono uppercase"
              />
            </label>

            <label className="block space-y-1.5 text-xs sm:col-span-5">
              <span className="font-medium text-[#3b476b]">Registered Email</span>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8a98bd]" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="driver@example.com"
                  className="orbit-input pl-9"
                />
              </div>
            </label>

            <div className="flex items-end sm:col-span-3">
              <button
                type="submit"
                disabled={lookupLoading}
                className="inline-flex h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[#4673eb] px-5 text-xs font-semibold text-white shadow-[0_12px_28px_-10px_rgba(70,115,235,0.65)] transition hover:-translate-y-0.5 hover:bg-[#345fda] disabled:pointer-events-none disabled:opacity-55"
              >
                <Search className="h-3.5 w-3.5" />
                <span>{lookupLoading ? 'Checking...' : 'Check Status'}</span>
              </button>
            </div>
          </form>

          {/* Quick Demo Reference Chips */}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-[#5c6b94]">
            <span className="inline-flex items-center gap-1 font-medium text-[#4d5a83]">
              <Sparkles className="h-3 w-3 text-[#4673eb]" />
              Try demo references:
            </span>
            <button
              type="button"
              onClick={() => fillDemo('MC-T2-DEMO-0001', 'driver2@meecargo.demo')}
              className="cursor-pointer rounded-full border border-[#d6e0f8] bg-[#f8faff] px-3 py-1 font-mono text-[11px] text-[#080e2b] transition hover:border-[#4673eb] hover:bg-[#eef3ff]"
            >
              MC-T2-DEMO-0001 (Approved)
            </button>
            <button
              type="button"
              onClick={() => fillDemo('MC-T2-DEMO-0002', 'driver3@meecargo.demo')}
              className="cursor-pointer rounded-full border border-[#d6e0f8] bg-[#f8faff] px-3 py-1 font-mono text-[11px] text-[#080e2b] transition hover:border-[#4673eb] hover:bg-[#eef3ff]"
            >
              MC-T2-DEMO-0002 (Pending)
            </button>
          </div>

          {lookupError ? (
            <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
              {lookupError}
            </div>
          ) : null}

          {lookupResult ? (
            <div className="orbit-reveal-1 mt-6 space-y-4 rounded-[24px] border border-[#cddbfa] bg-[#fbfdff] p-5 text-xs shadow-xs sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {lookupResult.status === 'APPROVED' ? (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                  ) : lookupResult.status === 'REJECTED' ? (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-100 text-rose-700">
                      <ShieldAlert className="h-5 w-5" />
                    </div>
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-100 text-amber-700">
                      <Clock className="h-5 w-5" />
                    </div>
                  )}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#7a87aa]">
                      Application Reference
                    </p>
                    <span className="font-mono text-sm font-bold text-[#080e2b]">
                      {lookupResult.applicationRef}
                    </span>
                  </div>
                </div>

                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 text-xs font-semibold',
                    getStatusPillClasses(lookupResult.status)
                  )}
                >
                  {lookupResult.status === 'PENDING' && (
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                  )}
                  {lookupResult.status}
                </span>
              </div>

              <VerificationTimeline status={lookupResult.status} />

              <div className="grid gap-3 rounded-2xl border border-[#e3ebfc] bg-white p-4 text-[#4d5a83] sm:grid-cols-2">
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Submitted</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {new Date(lookupResult.appliedAt).toLocaleString('en-IN')}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Vehicle Details</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {lookupResult.vehicleRegistrationNumber} — {lookupResult.vehicleCategory}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] text-[#7a87aa]">Document Check</p>
                  <p className="mt-0.5 font-semibold text-[#080e2b]">
                    {lookupResult.documentsVerificationStatus} ({lookupResult.uploadedDocumentsCount}{' '}
                    files)
                  </p>
                </div>
                {lookupResult.reviewedAt ? (
                  <div>
                    <p className="text-[11px] text-[#7a87aa]">Reviewed</p>
                    <p className="mt-0.5 font-semibold text-[#080e2b]">
                      {new Date(lookupResult.reviewedAt).toLocaleString('en-IN')}
                    </p>
                  </div>
                ) : null}
              </div>

              {lookupResult.rejectionReason ? (
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-900">
                  <p className="font-semibold">Rejection Reason</p>
                  <p className="mt-1 leading-relaxed">{lookupResult.rejectionReason}</p>
                </div>
              ) : null}

              <div className="rounded-2xl border border-[#dce5fa] bg-[#eef3ff]/65 p-4 text-[#3b476b]">
                <p className="font-semibold text-[#080e2b]">Next Steps</p>
                <p className="mt-1 leading-relaxed">{lookupResult.nextSteps}</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  to="/driver/login"
                  className="inline-flex items-center gap-2 rounded-[22px] bg-[#4673eb] px-5 py-2.5 text-xs font-medium text-white shadow-xs transition hover:bg-[#345fda]"
                >
                  Driver Portal Login
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  to="/driver/apply"
                  className="inline-flex items-center gap-1.5 rounded-[22px] border border-[#d6e0f8] bg-white px-4 py-2.5 text-xs font-medium text-[#080e2b] transition hover:border-[#4673eb]"
                >
                  Submit Another Vehicle
                </Link>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </OrbitDriverLayout>
  );
}

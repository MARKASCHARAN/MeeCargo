import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeIndianRupee,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  MapPin,
  Route,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react';
import { fetchPublicTier2Policy } from '@/api/client';
import { OrbitDriverLayout } from '@/components/driver/OrbitDriverLayout';

const CORRIDOR_STOPS = [
  { code: 'VAD', label: 'Vadodara', km: '0 km', x: 52, y: 170 },
  { code: 'AND', label: 'Anand', km: '42 km', x: 158, y: 112 },
  { code: 'NDD', label: 'Nadiad', km: '64 km', x: 266, y: 126 },
  { code: 'AMD', label: 'Ahmedabad', km: '112 km', x: 374, y: 64 },
] as const;

export function BecomeDriverPage() {
  const policyQuery = useQuery({
    queryKey: ['public-tier2-policy'],
    queryFn: fetchPublicTier2Policy,
  });

  const policy = policyQuery.data?.policy;
  const maxMb = policy ? Math.round(policy.maxFileSizeBytes / (1024 * 1024)) : 5;
  const requiredDocs = policy?.requiredDocuments ?? [
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
  ];

  return (
    <OrbitDriverLayout
      brandSub="tier 2 fleet"
      headerCtaLabel="Start Application"
      headerCtaTo="/driver/apply"
    >
      <div className="mx-auto max-w-7xl space-y-12 px-5 pb-14 pt-6 sm:px-8 lg:pt-10">
        {/* Hero Split Section */}
        <section className="grid items-center gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="orbit-reveal-1 lg:col-span-6">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[#dce5fa] bg-white/90 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#4673eb] shadow-2xs">
              <span className="relative flex h-2 w-2">
                <span className="orbit-pulse-ring absolute inline-flex h-full w-full rounded-full bg-[#4673eb]" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#4673eb]" />
              </span>
              Independent Marketplace Fleet • Tier 2
            </div>

            <h1 className="text-[42px] font-[550] leading-[1.03] tracking-[-0.055em] text-[#080e2b] sm:text-[54px] lg:text-[62px]">
              Drive your own
              <br />
              commercial vehicle
              <br />
              <em
                className="font-orbit-serif text-[1.12em] font-normal leading-[0.9] tracking-[-0.035em] text-[#4a72e7]"
                style={{ fontStyle: 'italic' }}
              >
                with clear payouts.
              </em>
            </h1>

            <p className="mt-5 max-w-xl text-[15px] leading-[1.6] tracking-[-0.1px] text-[#5c6b94] sm:text-[17px]">
              Join MeeCargo&apos;s Tier 2 independent driver network to pick up overflow and
              scheduled B2B corridor loads along <strong className="font-semibold text-[#080e2b]">GJ-VAD-AMD-01</strong>{' '}
              using your own vehicle—on transparent per-km payouts.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                to="/driver/apply"
                className="group inline-flex items-center gap-2.5 rounded-[26px] bg-[#4673eb] px-6 py-3.5 text-sm font-medium text-white shadow-[0_14px_34px_-12px_rgba(70,115,235,0.65),inset_0_1px_0_#ffffff33] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#345fda]"
              >
                <span>Start Tier 2 Application</span>
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>

              <Link
                to="/driver/application-status"
                className="inline-flex items-center gap-2 rounded-[26px] border border-[#cddbfa] bg-white/90 px-5 py-3.5 text-sm font-medium text-[#080e2b] shadow-2xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#4673eb] hover:bg-[#eef3ff]"
              >
                Track Existing Application
              </Link>

              <Link
                to="/driver/login"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-[#4d5a83] transition-colors hover:text-[#4673eb]"
              >
                Already approved? Driver Login
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>

          {/* Animated Orbit Corridor Card */}
          <div className="orbit-reveal-2 lg:col-span-6">
            <div className="orbit-animate-float relative overflow-hidden rounded-[32px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_28px_80px_-28px_rgba(24,60,115,0.28)] backdrop-blur-md sm:p-7">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-[radial-gradient(circle,rgba(71,115,236,0.16),transparent_70%)]"
              />

              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#7a94df]">
                    Live Corridor Network
                  </p>
                  <h2 className="mt-1 text-lg font-semibold tracking-tight text-[#080e2b]">
                    Vadodara → Ahmedabad Overflow Dispatch
                  </h2>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d0f0df] bg-[#ecfdf5] px-3 py-1 text-[11px] font-medium text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  OR-Tools Matched
                </span>
              </div>

              {/* Animated SVG Route Curve */}
              <div className="relative mt-5 overflow-hidden rounded-2xl border border-[#e3ebfc] bg-[linear-gradient(180deg,#f7faff_0%,#edf3ff_100%)] p-3">
                <svg
                  viewBox="0 0 430 215"
                  className="h-auto w-full"
                  role="img"
                  aria-label="Animated corridor route connecting Vadodara, Anand, Nadiad, and Ahmedabad"
                >
                  <defs>
                    <linearGradient id="corridorLineGrad" x1="0%" y1="100%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#6389f0" />
                      <stop offset="100%" stopColor="#3563e4" />
                    </linearGradient>
                    <filter id="nodeGlow" x="-40%" y="-40%" width="180%" height="180%">
                      <feGaussianBlur stdDeviation="4" result="blur" />
                      <feMerge>
                        <feMergeNode in="blur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>

                  {/* Soft horizon grid lines */}
                  <line x1="16" y1="64" x2="414" y2="64" stroke="#dce5fa" strokeDasharray="3 5" />
                  <line x1="16" y1="118" x2="414" y2="118" stroke="#dce5fa" strokeDasharray="3 5" />
                  <line x1="16" y1="170" x2="414" y2="170" stroke="#dce5fa" strokeDasharray="3 5" />

                  {/* Static base path */}
                  <path
                    id="tier2-corridor-arc"
                    d="M 52 170 C 102 150, 118 118, 158 112 C 198 106, 224 134, 266 126 C 314 117, 336 80, 374 64"
                    fill="none"
                    stroke="#cfe0ff"
                    strokeWidth="6"
                    strokeLinecap="round"
                  />

                  {/* Animated flowing dash overlay */}
                  <path
                    d="M 52 170 C 102 150, 118 118, 158 112 C 198 106, 224 134, 266 126 C 314 117, 336 80, 374 64"
                    fill="none"
                    stroke="url(#corridorLineGrad)"
                    strokeWidth="3"
                    strokeLinecap="round"
                    className="orbit-route-dash"
                  />

                  {/* Traveling Cargo Beacon */}
                  <g filter="url(#nodeGlow)">
                    <circle r="7" fill="#ffffff" stroke="#3563e4" strokeWidth="3">
                      <animateMotion
                        dur="6.5s"
                        repeatCount="indefinite"
                        path="M 52 170 C 102 150, 118 118, 158 112 C 198 106, 224 134, 266 126 C 314 117, 336 80, 374 64"
                      />
                    </circle>
                  </g>

                  {/* Corridor Stop Nodes */}
                  {CORRIDOR_STOPS.map((stop, idx) => (
                    <g key={stop.code}>
                      <circle
                        cx={stop.x}
                        cy={stop.y}
                        r="11"
                        fill="#4673eb"
                        opacity="0.14"
                      />
                      <circle
                        cx={stop.x}
                        cy={stop.y}
                        r="5.5"
                        fill={idx === 0 || idx === CORRIDOR_STOPS.length - 1 ? '#3563e4' : '#ffffff'}
                        stroke="#3563e4"
                        strokeWidth="2.5"
                      />
                      <text
                        x={stop.x}
                        y={stop.y - 16}
                        textAnchor="middle"
                        className="fill-[#080e2b] text-[10.5px] font-semibold"
                      >
                        {stop.label}
                      </text>
                      <text
                        x={stop.x}
                        y={stop.y + 22}
                        textAnchor="middle"
                        className="fill-[#6c7da6] text-[9px] font-medium"
                      >
                        {stop.km}
                      </text>
                    </g>
                  ))}
                </svg>
              </div>

              {/* Dynamic Quick Stats */}
              <div className="mt-4 grid grid-cols-3 gap-2.5">
                <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#7a87aa]">
                    Eligible Fleet
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#080e2b]">LCV • Pickup • Box</p>
                </div>
                <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#7a87aa]">
                    Load Planning
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#080e2b]">Auto LIFO + QR</p>
                </div>
                <div className="rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-[#7a87aa]">
                    Max Doc Upload
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#4673eb]">{maxMb} MB / file</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Three Orbit Value Cards */}
        <section className="orbit-reveal-3 grid gap-5 md:grid-cols-3">
          <div className="group rounded-[26px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.2)] transition-all duration-300 hover:-translate-y-1 hover:border-[#b7caf7] hover:shadow-[0_24px_60px_-26px_rgba(70,115,235,0.28)]">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#4673eb] transition-transform duration-300 group-hover:scale-105">
              <Truck className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-[#080e2b]">
              Bring Your Own Vehicle
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5c6b94]">
              Closed body LCVs, pickups, flatbeds, and containers with valid commercial RC and goods
              insurance qualify directly for Tier 2 onboarding.
            </p>
          </div>

          <div className="group rounded-[26px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.2)] transition-all duration-300 hover:-translate-y-1 hover:border-[#b7caf7] hover:shadow-[0_24px_60px_-26px_rgba(70,115,235,0.28)]">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#4673eb] transition-transform duration-300 group-hover:scale-105">
              <BadgeIndianRupee className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-[#080e2b]">
              Per-km Marketplace Payouts
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5c6b94]">
              {policy?.payoutPolicySummary ??
                'Tier 2 drivers participate independently on per-km marketplace payouts without Tier 1 contracts or minimum guarantees.'}
            </p>
          </div>

          <div className="group rounded-[26px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.2)] transition-all duration-300 hover:-translate-y-1 hover:border-[#b7caf7] hover:shadow-[0_24px_60px_-26px_rgba(70,115,235,0.28)]">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#080e2b] text-white transition-transform duration-300 group-hover:scale-105">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-lg font-semibold tracking-tight text-[#080e2b]">
              Verified Marketplace Access
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-[#5c6b94]">
              Every application is reviewed by the Platform Owner. Once approved, matched corridor
              loads unlock automatically inside your Driver PWA.
            </p>
          </div>
        </section>

        {/* Required Documents & 3-Step Approval Timeline */}
        <section className="orbit-reveal-4 grid gap-6 lg:grid-cols-2">
          {/* Required Documents Card */}
          <div className="rounded-[28px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.2)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eaf0fd] pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#4673eb]">
                  <FileCheck2 className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#080e2b]">Required Documents</h2>
                  <p className="text-xs text-[#5c6b94]">
                    Upload clear JPEG, PNG, WebP, or PDF scans (max {maxMb} MB per file).
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-[#dce5fa] bg-[#f8faff] px-3 py-1 text-[11px] font-semibold text-[#4673eb]">
                {requiredDocs.length} Files Total
              </span>
            </div>

            <div className="mt-5 space-y-3">
              {requiredDocs.map((doc, idx) => (
                <div
                  key={doc.docType}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] px-4 py-3 transition-colors hover:border-[#b7caf7] hover:bg-white"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eef3ff] text-xs font-semibold text-[#4673eb]">
                      {idx + 1}
                    </div>
                    <span className="text-xs font-medium text-[#080e2b] sm:text-sm">
                      {doc.label}
                    </span>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#d6e0f8] bg-white px-2.5 py-0.5 text-[11px] font-medium text-[#4d5a83]">
                    <CheckCircle2 className="h-3 w-3 text-[#4673eb]" />
                    {doc.required ? 'Required' : 'Optional'}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#dce5fa] bg-[#eef3ff]/65 px-4 py-3 text-xs text-[#4d5a83]">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <Sparkles className="h-4 w-4 text-[#4673eb]" />
                Have your scans ready? Complete onboarding in under 4 minutes.
              </span>
              <Link
                to="/driver/apply"
                className="font-semibold text-[#3563e4] hover:underline"
              >
                Open Application Form →
              </Link>
            </div>
          </div>

          {/* Approval Workflow Timeline Card */}
          <div className="rounded-[28px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_20px_55px_-28px_rgba(24,60,115,0.2)] sm:p-7">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#eaf0fd] pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#4673eb]">
                  <ClipboardCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-[#080e2b]">Approval Workflow</h2>
                  <p className="text-xs text-[#5c6b94]">
                    Simple 3-step verification before accepting corridor loads.
                  </p>
                </div>
              </div>
              <Link
                to="/driver/application-status"
                className="inline-flex items-center gap-1 rounded-full border border-[#dce5fa] bg-[#f8faff] px-3 py-1 text-[11px] font-semibold text-[#4673eb] transition hover:border-[#4673eb]"
              >
                <Route className="h-3 w-3" />
                Live Status Lookup
              </Link>
            </div>

            <div className="relative mt-5 space-y-4 pl-4 before:absolute before:bottom-6 before:left-[27px] before:top-6 before:w-px before:bg-[#dce5fa]">
              <div className="relative flex items-start gap-4 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4 transition hover:border-[#b7caf7] hover:bg-white">
                <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#4673eb] text-xs font-semibold text-white shadow-xs">
                  1
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-[#080e2b]">
                    Submit Application &amp; Documents
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-[#5c6b94]">
                    Provide contact details, vehicle payload and bed dimensions, and upload required
                    identity and vehicle documents. You immediately receive a tracking reference ID.
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-4 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4 transition hover:border-[#b7caf7] hover:bg-white">
                <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#4673eb] bg-[#eef3ff] text-xs font-semibold text-[#3563e4]">
                  2
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[#080e2b]">Platform Owner Review</h3>
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                      PENDING
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#5c6b94]">
                    Our single Platform Owner verifies your commercial RC, insurance, and vehicle
                    specs. Track review progress live anytime without signing in.
                  </p>
                </div>
              </div>

              <div className="relative flex items-start gap-4 rounded-2xl border border-[#e3ebfc] bg-[#f8faff] p-4 transition hover:border-[#b7caf7] hover:bg-white">
                <div className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#080e2b] text-xs font-semibold text-white">
                  3
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold text-[#080e2b]">
                      Sign In &amp; Accept Marketplace Loads
                    </h3>
                    <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                      APPROVED
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-[#5c6b94]">
                    Once approved, sign in at Driver Login to view eligible trips matched to your
                    vehicle&apos;s exact weight and cubic capacity with automated LIFO loading maps.
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-[#5c6b94]">
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-[#4673eb]" />
                Active Corridor: GJ-VAD-AMD-01
              </span>
              <Link to="/driver/login" className="font-semibold text-[#080e2b] hover:text-[#4673eb]">
                Open Driver Portal →
              </Link>
            </div>
          </div>
        </section>
      </div>
    </OrbitDriverLayout>
  );
}

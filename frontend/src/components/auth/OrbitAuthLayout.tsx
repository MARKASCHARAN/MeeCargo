import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PackageCheck, Route, ShieldCheck, type LucideIcon } from 'lucide-react';

export interface AuthHighlight {
  icon: LucideIcon;
  title: string;
  description: string;
}

interface OrbitAuthLayoutProps {
  brandSub?: string;
  headerCtaLabel: string;
  headerCtaTo: string;
  eyebrow: string;
  headlineLines: [string, string, string];
  description: string;
  highlights?: AuthHighlight[];
  children: ReactNode;
}

const DEFAULT_HIGHLIGHTS: AuthHighlight[] = [
  {
    icon: Route,
    title: 'OR-Tools LIFO Corridor Routing',
    description:
      'Scheduled departures pool compatible B2B loads along GJ-VAD-AMD-01 automatically.',
  },
  {
    icon: PackageCheck,
    title: '15% Refundable Booking Token',
    description:
      'Lock your slot early and pay less per kg as shared utilization rises before cutoff.',
  },
  {
    icon: ShieldCheck,
    title: 'Live Tokenized Tracking & OTP POD',
    description:
      'Share account-free recipient tracking links with verified QR pickup and OTP handoff.',
  },
];

export function MeeCargoOrbitLogo({
  subLabel = 'corridor freight',
}: {
  subLabel?: string;
}) {
  return (
    <Link
      to="/"
      className="group inline-flex items-center gap-[13px] text-[28px] font-semibold tracking-[-1.5px] text-[#080e2b] sm:text-[32px]"
      aria-label="MeeCargo home"
    >
      <svg
        viewBox="0 0 38 38"
        aria-hidden="true"
        className="h-[31px] w-[31px] shrink-0 transition-transform duration-200 group-hover:scale-105 sm:h-[35px] sm:w-[35px]"
      >
        <defs>
          <radialGradient id="auth-logo-light" cx="30%" cy="20%">
            <stop stopColor="#7d9efa" />
            <stop offset="1" stopColor="#4674e9" />
          </radialGradient>
        </defs>
        <circle cx="23" cy="15" r="14" fill="url(#auth-logo-light)" />
        <circle cx="10" cy="27" r="8" fill="#6389f0" />
        <circle cx="15" cy="8" r="3.5" fill="#b2c7ff" opacity="0.45" />
      </svg>
      <span className="flex flex-col gap-[4px] leading-none sm:gap-[5px]">
        <span>meecargo</span>
        <small className="ml-[2px] text-[7px] font-medium uppercase tracking-[0.24em] text-[#7c96cc] sm:text-[8px]">
          {subLabel}
        </small>
      </span>
    </Link>
  );
}

export function OrbitArrow() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="h-[20px] w-[20px] shrink-0"
    >
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OrbitAuthLayout({
  brandSub = 'corridor freight',
  headerCtaLabel,
  headerCtaTo,
  eyebrow,
  headlineLines,
  description,
  highlights = DEFAULT_HIGHLIGHTS,
  children,
}: OrbitAuthLayoutProps) {
  return (
    <div className="font-orbit-sans orbit-page-bg relative flex min-h-screen flex-col overflow-hidden text-[#080e2b]">
      {/* Ambient soft clouds echoing the home hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 -bottom-24 z-0 h-64 opacity-90 blur-[18px]"
      >
        <div className="mx-auto relative h-full max-w-7xl">
          <div className="absolute -left-16 bottom-0 h-52 w-96 -rotate-12 rounded-full bg-[radial-gradient(ellipse_at_42%_34%,#fffdfb_27%,#f3f7ff_59%,#e5edfc88_75%,transparent_80%)]" />
          <div className="absolute left-1/4 bottom-4 h-48 w-72 rounded-full bg-[radial-gradient(ellipse_at_42%_34%,#fffdfb_27%,#f3f7ff_59%,#e5edfc88_75%,transparent_80%)]" />
          <div className="absolute right-1/4 -bottom-2 h-44 w-72 rounded-full bg-[radial-gradient(ellipse_at_42%_34%,#fffdfb_27%,#f3f7ff_59%,#e5edfc88_75%,transparent_80%)]" />
          <div className="absolute -right-12 bottom-0 h-52 w-96 rounded-full bg-[radial-gradient(ellipse_at_42%_34%,#fffdfb_27%,#f3f7ff_59%,#e5edfc88_75%,transparent_80%)]" />
        </div>
      </div>

      {/* Consistent Orbit Header */}
      <header className="relative z-10 flex h-[90px] flex-none items-center justify-between px-[25px] sm:px-[5%] lg:h-[104px] lg:px-[6.5%]">
        <MeeCargoOrbitLogo subLabel={brandSub} />

        <nav
          aria-label="Auth navigation"
          className="hidden items-center gap-8 md:flex"
        >
          <Link
            to="/"
            className="py-2 text-[14px] text-[#4d5a83] transition-colors hover:text-[#4574ec] lg:text-[15px]"
          >
            Home
          </Link>
          <Link
            to="/become-a-driver"
            className="py-2 text-[14px] text-[#4d5a83] transition-colors hover:text-[#4574ec] lg:text-[15px]"
          >
            Become a Driver
          </Link>
          <Link
            to="/driver/login"
            className="py-2 text-[14px] text-[#4d5a83] transition-colors hover:text-[#4574ec] lg:text-[15px]"
          >
            Driver Portal
          </Link>
          <Link
            to="/driver/application-status"
            className="py-2 text-[14px] text-[#4d5a83] transition-colors hover:text-[#4574ec] lg:text-[15px]"
          >
            Track Application
          </Link>
        </nav>

        <Link
          to={headerCtaTo}
          className="inline-flex items-center justify-center rounded-[23px] bg-[#4673eb] px-[18px] py-[12px] text-[12px] font-medium text-white shadow-[inset_0_1px_0_#ffffff26] transition hover:bg-[#345fda] sm:px-[22px] sm:py-[14px] sm:text-[13px]"
        >
          {headerCtaLabel}
        </Link>
      </header>

      {/* Main Split Content */}
      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center px-[25px] py-6 sm:px-[5%] lg:px-6 lg:py-10">
        <div className="grid w-full items-center gap-10 lg:grid-cols-12 lg:gap-14">
          {/* Editorial Left Column */}
          <div className="lg:col-span-6">
            <p className="mb-4 text-[11px] font-medium uppercase tracking-[0.32em] text-[#7a94df] sm:text-xs">
              {eyebrow}
            </p>
            <h1 className="text-[44px] font-[550] leading-[1.03] tracking-[-0.06em] text-[#080e2b] sm:text-[58px] lg:text-[66px]">
              {headlineLines[0]}
              <br />
              {headlineLines[1]}
              <br />
              <em className="font-orbit-serif text-[1.12em] font-normal not-italic leading-[0.9] tracking-[-0.035em] text-[#4a72e7]" style={{ fontStyle: 'italic' }}>
                {headlineLines[2]}
              </em>
            </h1>
            <p className="mt-5 max-w-lg text-[16px] leading-[1.5] tracking-[-0.2px] text-[#7a87aa] sm:text-[18px]">
              {description}
            </p>

            <div className="mt-8 hidden space-y-3.5 sm:block">
              {highlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.title}
                    className="flex items-start gap-3.5 rounded-2xl border border-[#dce5fa]/80 bg-white/70 p-3.5 backdrop-blur-xs"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold tracking-[-0.01em] text-[#080e2b]">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-[#5c6b94]">
                        {item.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Auth Card Right Column */}
          <div className="lg:col-span-6">
            <div className="mx-auto w-full max-w-[480px] rounded-[28px] border border-[#dce5fa] bg-white/95 p-6 shadow-[0_25px_90px_-24px_rgba(24,60,115,0.18)] backdrop-blur-sm sm:p-8">
              {children}
            </div>
          </div>
        </div>
      </main>

      {/* Editorial Orbit Footer */}
      <footer className="relative z-10 flex items-end justify-between px-[25px] pb-7 pt-4 text-[9px] uppercase tracking-[0.22em] leading-[1.8] text-[#94a7d1] sm:px-[5%] lg:px-[6.5%] lg:text-[10px]">
        <p>
          <span className="mb-2.5 block h-px w-6 bg-[#aebfdf]" />
          Semi-urban &amp; rural
          <br />
          corridor pooling
        </p>
        <p className="text-right">
          No dispatcher
          <br />
          Automated
          <br />
          LIFO routing
        </p>
      </footer>
    </div>
  );
}


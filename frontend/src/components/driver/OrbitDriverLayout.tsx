import { type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { MeeCargoOrbitLogo, OrbitArrow } from '@/components/auth/OrbitAuthLayout';
import DoodleCrewFooter from '@/components/ui/doodle-crew-footer';
import { cn } from '@/lib/cn';

interface OrbitDriverLayoutProps {
  brandSub?: string;
  headerCtaLabel?: string;
  headerCtaTo?: string;
  children: ReactNode;
}

const NAV_ITEMS = [
  { label: 'Home', to: '/' },
  { label: 'Become a Driver', to: '/become-a-driver' },
  { label: 'Tier 2 Apply', to: '/driver/apply' },
  { label: 'Application Status', to: '/driver/application-status' },
  { label: 'Driver Login', to: '/driver/login' },
] as const;

export function OrbitDriverLayout({
  brandSub = 'tier 2 fleet',
  headerCtaLabel = 'Apply Now',
  headerCtaTo = '/driver/apply',
  children,
}: OrbitDriverLayoutProps) {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <div className="font-orbit-sans orbit-page-bg relative flex min-h-screen flex-col overflow-x-hidden text-[#080e2b]">
      {/* Ambient soft sky clouds matching the home Orbit hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-x-0 top-0 z-0 h-[420px] overflow-hidden opacity-85"
      >
        <div className="orbit-animate-float-slow absolute -left-24 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(circle,#fffef7_18%,#eef4ff_58%,transparent_76%)] blur-2xl" />
        <div className="orbit-animate-float absolute -right-16 top-6 h-96 w-96 rounded-full bg-[radial-gradient(circle,#e4eeff_12%,#f3f7ff_55%,transparent_75%)] blur-3xl" />
      </div>

      {/* Consistent Orbit Header */}
      <header className="relative z-20 mx-auto flex h-[86px] w-full max-w-7xl items-center justify-between px-5 sm:px-8 lg:h-[98px]">
        <MeeCargoOrbitLogo subLabel={brandSub} />

        <nav
          aria-label="Driver onboarding navigation"
          className="hidden items-center gap-1 rounded-full border border-[#dce5fa]/90 bg-white/80 p-1.5 shadow-[0_8px_28px_-14px_rgba(24,60,115,0.22)] backdrop-blur-md lg:flex"
        >
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'rounded-full px-4 py-1.5 text-[13px] font-medium transition-all duration-200',
                  active
                    ? 'bg-[#eef3ff] text-[#3563e4] shadow-[inset_0_0_0_1px_#cddbfa]'
                    : 'text-[#5c6b94] hover:bg-[#f6f9ff] hover:text-[#080e2b]'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5">
          <Link
            to="/driver/login"
            className="hidden rounded-[23px] border border-[#d6e0f8] bg-white/85 px-4 py-2.5 text-[12px] font-medium text-[#080e2b] transition hover:border-[#b7caf7] hover:bg-[#eef3ff] sm:inline-flex lg:hidden"
          >
            Driver Login
          </Link>
          <Link
            to={headerCtaTo}
            className="group inline-flex items-center gap-2 rounded-[23px] bg-[#4673eb] px-[18px] py-[11px] text-[12px] font-medium text-white shadow-[0_12px_28px_-10px_rgba(70,115,235,0.65),inset_0_1px_0_#ffffff33] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#345fda] sm:px-[22px] sm:py-[13px] sm:text-[13px]"
          >
            <span>{headerCtaLabel}</span>
            <span className="transition-transform duration-200 group-hover:translate-x-0.5">
              <OrbitArrow />
            </span>
          </Link>
        </div>
      </header>

      {/* Compact mobile / tablet pill strip */}
      <div className="relative z-10 mx-auto flex w-full max-w-7xl gap-2 overflow-x-auto px-5 pb-2 sm:px-8 lg:hidden">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.to;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                active
                  ? 'border-[#b7caf7] bg-[#eef3ff] text-[#3563e4]'
                  : 'border-[#dce5fa] bg-white/80 text-[#5c6b94]'
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      {/* Main Content */}
      <main className="relative z-10 flex-1">{children}</main>

      {/* Same Sketchbook Orbit Footer as Home Page */}
      <DoodleCrewFooter
        wordmark="MEECARGO"
        brand="meecargo"
        brandSub="corridor freight"
        preset="orbit"
        blurb="Crowd-pooled B2B freight for semi-urban & rural corridors. Automated slot locking, OR-Tools LIFO routing, and live tracking."
        tagline="Shared cargo along GJ-VAD-AMD-01, delivered with care."
        actions={[
          {
            label: headerCtaLabel,
            href: headerCtaTo,
            icon: 'plane',
            variant: 'solid',
          },
        ]}
        onNavigate={(href) => {
          if (href.startsWith('/#')) {
            navigate('/');
          } else {
            navigate(href);
          }
        }}
      />
    </div>
  );
}


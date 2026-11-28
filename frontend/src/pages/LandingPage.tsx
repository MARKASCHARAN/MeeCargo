import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Building2,
  MapPin,
  PackageCheck,
  Route,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import DoodleCrewFooter from '@/components/ui/doodle-crew-footer';
import FaqSection, {
  type FaqSectionData,
} from '@/components/ui/habit-faq-scroller';
import OrbitDeliveryHero, {
  type OrbitStoryItem,
} from '@/components/ui/orbit-delivery-hero';
import { useAuthStore } from '@/stores/authStore';

const SAMPLE_TRACK_TOKEN = 'mc_trk_9f4b2a8e1d7c6034a91e5b2f8d04c71a';

const MEECARGO_FAQ_DATA: FaqSectionData = {
  eyebrow: 'Corridor Questions & Answers',
  mainTitle: 'Frequently asked',
  accentTitle: 'questions.',
  mainSubtitle:
    'Everything shippers, fleet drivers, and recipients need to know about automated crowd-pooled freight on MeeCargo.',
  rows: [
    {
      id: 'shipper-pooling',
      speed: '58s',
      direction: 'left',
      faqItems: [
        {
          id: 'faq-pool-pricing',
          tag: 'Pricing & Pooling',
          question: 'How does crowd-pooled corridor pricing work?',
          answer:
            'Compatible B2B shipments share scheduled vehicles along GJ-VAD-AMD-01 (Vadodara → Anand → Nadiad → Ahmedabad). As pool utilization increases before cutoff, projected per-kg rates drop transparently.',
        },
        {
          id: 'faq-token',
          tag: 'Booking Token',
          question: 'What is the 15% refundable booking token?',
          answer:
            'Shippers lock slot capacity upfront by paying 15% of the ceiling estimate. The final shared balance adjusts automatically when the corridor slot hits cutoff.',
        },
        {
          id: 'faq-volumetric',
          tag: 'Cargo Weight',
          question: 'How is chargeable weight calculated?',
          answer:
            'MeeCargo compares actual scale weight with volumetric weight using (L × W × H) / 5000 so bulky low-density cartons and dense B2B pallets share truck space fairly.',
        },
        {
          id: 'faq-csv-express',
          tag: 'Shipper Portal',
          question: 'Can I book in bulk or request express dispatch?',
          answer:
            'Yes. Alongside standard AM and PM pooled slots, the Shipper Portal supports CSV manifest imports for batch orders and dedicated Express bookings.',
        },
      ],
    },
    {
      id: 'routing-dispatch',
      speed: '48s',
      direction: 'right',
      faqItems: [
        {
          id: 'faq-no-dispatcher',
          tag: 'Automation',
          question: 'Why is there no dispatcher UI or role?',
          answer:
            'Routine pooling, cutoff locking, hybrid-fleet vehicle allocation, OR-Tools route optimization, and LIFO loading plans are automated end-to-end by the MeeCargo backend.',
        },
        {
          id: 'faq-lifo',
          tag: 'OR-Tools LIFO',
          question: 'How does the LIFO truck-bed loading plan help?',
          answer:
            'The Python OR-Tools solver sequences stops and generates a Last-In, First-Out cargo layout so earlier corridor drops sit near the tailgate for fast unloading.',
        },
        {
          id: 'faq-hybrid-fleet',
          tag: 'Hybrid Fleet',
          question: 'How are Tier 1 and Tier 2 vehicles allocated?',
          answer:
            'Contracted Tier 1 attached vehicles are assigned first on scheduled corridor runs, while approved Tier 2 marketplace drivers step in when pooled volume overflows.',
        },
        {
          id: 'faq-backhaul',
          tag: 'Return Trips',
          question: 'Can return backhauls be matched on the corridor?',
          answer:
            'Yes. Confirmed return backhaul requests along reverse corridor legs (such as AMD → VAD) reduce empty return miles and boost vehicle utilization.',
        },
      ],
    },
    {
      id: 'driver-tracking',
      speed: '64s',
      direction: 'left',
      faqItems: [
        {
          id: 'faq-recipient-track',
          tag: 'Recipient Tracking',
          question: 'Do recipients need an account to track parcels?',
          answer:
            'No. Every shipment generates a non-sequential /track/<token> URL showing live milestones and arrival window details without any login.',
        },
        {
          id: 'faq-offline-pwa',
          tag: 'Driver PWA',
          question: 'Does the Driver PWA work in low-connectivity zones?',
          answer:
            'Drivers can view cached trips and manifests and queue status transitions offline via Dexie IndexedDB; final OTP verification and photo POD upload sync once online.',
        },
        {
          id: 'faq-pod',
          tag: 'Verification',
          question: 'How are pickups and deliveries verified?',
          answer:
            'Drivers scan shipment QR labels at pickup and confirm final handoff using recipient OTP validation, B2B sign-off, or photo proof of delivery.',
        },
        {
          id: 'faq-become-driver',
          tag: 'Onboarding',
          question: 'How do independent vehicle owners join MeeCargo?',
          answer:
            'Submit your vehicle specs and documents through Become a Driver or Tier 2 Apply, then monitor verification status anytime on the Application Status page.',
        },
      ],
    },
  ],
};

export function LandingPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [trackingInput, setTrackingInput] = useState(SAMPLE_TRACK_TOKEN);

  const portalPath = user
    ? user.role === 'SHIPPER'
      ? '/shipper'
      : user.role === 'PLATFORM_OWNER'
        ? '/owner'
        : '/driver'
    : '/login';

  const scrollToPortals = () => {
    document.getElementById('portals')?.scrollIntoView({ behavior: 'smooth' });
  };

  const stories: OrbitStoryItem[] = [
    {
      id: 'how-it-works',
      label: 'How it works',
      eyebrow: 'Automated Corridor Pooling',
      title: 'Booked, pooled, and dispatched automatically.',
      paragraphs: [
        'Shippers reserve space on scheduled semi-urban and rural corridor slots (such as Vadodara → Anand → Nadiad → Ahmedabad) with just a 15% refundable token.',
        'At cutoff, MeeCargo locks shared pricing, allocates attached or marketplace vehicles, runs Google OR-Tools LIFO routing, and tracks every handoff without any dispatcher UI.',
      ],
      ctaLabel: user ? 'Open your portal' : 'Book a corridor slot',
      onCtaClick: () => navigate(user ? portalPath : '/shipper'),
    },
    {
      id: 'for-business',
      label: 'For shippers',
      eyebrow: 'B2B Corridor Freight',
      title: 'Lower freight rates as pools fill up.',
      paragraphs: [
        'Combine compatible B2B consignments on fixed AM and PM departures. As pool utilization grows, per-kg rates drop transparently before cutoff.',
        'Book single parcels, upload CSV manifests in bulk, or request express dispatches with live recipient tracking tokens.',
      ],
      ctaLabel: 'Enter Shipper Portal',
      onCtaClick: () => navigate('/shipper'),
    },
    {
      id: 'for-drivers',
      label: 'For drivers',
      eyebrow: 'Hybrid Fleet & Offline PWA',
      title: 'Built for corridor drivers on the move.',
      paragraphs: [
        'Attached Tier 1 and marketplace Tier 2 drivers receive clear LIFO truck-bed loading plans, QR pickup verification, and OTP proof-of-delivery flows.',
        'The driver PWA caches manifests locally with IndexedDB so stop transitions keep working even across low-connectivity stretches.',
      ],
      ctaLabel: 'Driver Login / Apply',
      onCtaClick: () => navigate('/become-a-driver'),
    },
  ];

  const handleTrackSubmit = (event: FormEvent) => {
    event.preventDefault();
    const cleaned = trackingInput.trim();
    if (!cleaned) return;
    navigate(`/track/${encodeURIComponent(cleaned)}`);
  };

  return (
    <div className="min-h-screen bg-[#f0f6ff] text-[#080e2b]">
      <OrbitDeliveryHero
        theme="light"
        brandName="meecargo"
        brandSub="corridor freight"
        onBrandClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        eyebrow="Crowd-Pooled B2B Freight • UM-02"
        headlineLines={['Shared cargo.', 'Delivered', 'with care.']}
        descriptionLines={[
          'Affordable pooled logistics for semi-urban & rural corridors.',
          'Automated cutoff pricing, OR-Tools routing, and live tracking.',
        ]}
        navActionLabel="Explore Globe"
        stories={stories}
        extraNavItems={[
          { id: 'portals', label: 'Portals', onClick: scrollToPortals },
        ]}
        headerCtaLabel={user ? 'Open Portal' : 'Sign in'}
        onHeaderCtaClick={() => navigate(portalPath)}
        primaryCtaLabel={user ? 'Open Portal' : 'Enter Shipper Portal'}
        onPrimaryCtaClick={() => navigate(user ? portalPath : '/shipper')}
        secondaryCta={
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/driver/login"
              className="inline-flex min-h-[51px] items-center gap-2 rounded-full border border-[#c9d7f5] bg-white/85 px-5 py-3 text-sm font-medium text-[#2c3b68] shadow-xs backdrop-blur-xs transition hover:border-[#4773ec] hover:bg-white hover:text-[#4773ec]"
            >
              <Truck className="h-4 w-4" />
              Driver PWA
            </Link>
            <button
              type="button"
              onClick={scrollToPortals}
              className="inline-flex min-h-[51px] items-center gap-1.5 rounded-full px-4 py-3 text-sm font-medium text-[#4d5a83] transition hover:text-[#4773ec]"
            >
              Track Parcel
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        }
        captionIdle={['Drag to turn', 'the corridor']}
        captionDragging={['Pooled cargo.', 'On its way.']}
        captionPaused={['Press Start', 'to keep moving']}
        footerLeftLines={['Semi-urban & rural', 'corridor pooling']}
        footerRightLines={['No dispatcher', 'Automated', 'LIFO routing']}
      />

      {/* Below-the-fold MeeCargo Portals & Corridor Access */}
      <section
        id="portals"
        aria-labelledby="portals-heading"
        className="relative z-10 border-t border-[#dce5fa] bg-gradient-to-b from-[#f0f6ff] via-[#f8faff] to-white px-4 py-16 sm:px-6 lg:py-20"
      >
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#4a72e7]">
                Automated Freight Execution
              </p>
              <h2
                id="portals-heading"
                className="mt-3 text-3xl font-semibold tracking-tight text-[#080e2b] sm:text-4xl"
              >
                One corridor platform for shippers, drivers, and recipients.
              </h2>
              <p className="mt-3 text-base leading-relaxed text-[#5c6b94]">
                Every booking along <span className="font-medium text-[#080e2b]">GJ-VAD-AMD-01</span>{' '}
                (Vadodara → Anand → Nadiad → Ahmedabad) pools capacity automatically—no manual
                dispatcher required.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 text-xs font-medium text-[#4d5a83]">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 shadow-2xs">
                <Route className="h-3.5 w-3.5 text-[#4773ec]" />
                OR-Tools LIFO Routing
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 shadow-2xs">
                <PackageCheck className="h-3.5 w-3.5 text-[#4773ec]" />
                15% Refundable Token
              </span>
            </div>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {/* Shipper Portal */}
            <div className="flex h-full flex-col justify-between rounded-3xl border border-[#dce5fa] bg-white p-7 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.22)] transition hover:-translate-y-0.5 hover:border-[#b7caf7]">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#eef3ff] text-[#4673eb]">
                  <Building2 className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-[#080e2b]">
                  Shipper Portal
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b94]">
                  Book corridor slots, calculate chargeable weight, monitor live pool utilization,
                  import CSV manifests, and track deliveries.
                </p>
              </div>
              <div className="mt-6 flex flex-col gap-2.5">
                <Link to={user?.role === 'SHIPPER' ? '/shipper' : '/shipper'}>
                  <Button
                    variant="primary"
                    size="sm"
                    className="w-full justify-between rounded-2xl bg-[#4773ec] py-2.5 hover:bg-[#345fda]"
                  >
                    Enter Shipper Portal
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                {!user && (
                  <div className="flex items-center justify-between text-xs font-medium text-[#5c6b94]">
                    <Link to="/register" className="text-[#4673eb] hover:underline">
                      Create shipper account
                    </Link>
                    <Link to="/login" className="hover:text-[#080e2b] hover:underline">
                      Sign in
                    </Link>
                  </div>
                )}
              </div>
            </div>

            {/* Driver PWA */}
            <div className="flex h-full flex-col justify-between rounded-3xl border border-[#dce5fa] bg-white p-7 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.22)] transition hover:-translate-y-0.5 hover:border-[#b7caf7]">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#080e2b] text-white">
                  <Truck className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-[#080e2b]">
                  Driver PWA
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b94]">
                  Mobile-first manifest, LIFO loading plan, QR pickup checks, OTP proof of
                  delivery, and offline event sync.
                </p>
              </div>
              <div className="mt-6 flex flex-col gap-2.5">
                <Link to={user?.role === 'DRIVER' ? '/driver' : '/driver/login'}>
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-full justify-between rounded-2xl py-2.5"
                  >
                    Driver Login / Portal
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
                <div className="flex items-center justify-between text-xs font-medium text-[#5c6b94]">
                  <Link to="/become-a-driver" className="text-[#4673eb] hover:underline">
                    Become a Driver
                  </Link>
                  <Link
                    to="/driver/application-status"
                    className="hover:text-[#080e2b] hover:underline"
                  >
                    Track Application
                  </Link>
                </div>
              </div>
            </div>

            {/* Recipient Tracking */}
            <div className="flex h-full flex-col justify-between rounded-3xl border border-[#dce5fa] bg-white p-7 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.22)] transition hover:-translate-y-0.5 hover:border-[#b7caf7]">
              <div>
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-600">
                  <MapPin className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-xl font-semibold tracking-tight text-[#080e2b]">
                  Recipient Tracking
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#5c6b94]">
                  Tokenized, account-free delivery status page showing safe milestone and arrival
                  window details.
                </p>
              </div>

              <form onSubmit={handleTrackSubmit} className="mt-6 flex flex-col gap-2.5">
                <label htmlFor="tracking-token-input" className="sr-only">
                  Tracking token
                </label>
                <input
                  id="tracking-token-input"
                  type="text"
                  value={trackingInput}
                  onChange={(e) => setTrackingInput(e.target.value)}
                  placeholder="Enter tracking token (mc_trk_...)"
                  className="w-full rounded-xl border border-[#dce5fa] bg-[#f8faff] px-3 py-2 text-xs text-[#080e2b] outline-none transition focus:border-[#4773ec] focus:bg-white"
                />
                <div className="flex gap-2">
                  <Button
                    type="submit"
                    variant="outline"
                    size="sm"
                    className="w-full justify-between rounded-2xl border-[#c9d7f5] py-2.5 text-[#080e2b] hover:border-[#4773ec] hover:bg-[#eef3ff]"
                  >
                    Track Shipment
                    <ShieldCheck className="h-4 w-4 text-[#4673eb]" />
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </section>

      <FaqSection data={MEECARGO_FAQ_DATA} />

      <DoodleCrewFooter
        wordmark="MEECARGO"
        brand="meecargo"
        brandSub="corridor freight"
        preset="orbit"
        blurb="Crowd-pooled B2B freight for semi-urban & rural corridors. Automated slot locking, OR-Tools LIFO routing, and live tracking."
        tagline="Shared cargo along GJ-VAD-AMD-01, delivered with care."
        actions={[
          {
            label: user ? 'Open Portal' : 'Book Corridor Slot',
            href: user ? portalPath : '/shipper',
            icon: 'plane',
            variant: 'solid',
          },
        ]}
        onNavigate={(href) => {
          if (href.startsWith('/#')) {
            document
              .getElementById(href.slice(2))
              ?.scrollIntoView({ behavior: 'smooth' });
          } else {
            navigate(href);
          }
        }}
      />
    </div>
  );
}

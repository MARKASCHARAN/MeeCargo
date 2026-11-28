import type { CSSProperties, ReactNode } from 'react';
import { HelpCircle } from 'lucide-react';

export interface FaqItem {
  id: string;
  tag?: string;
  question: string;
  answer: string;
}

export interface FaqRow {
  id: string;
  speed?: string;
  direction?: 'left' | 'right';
  faqItems: FaqItem[];
}

export interface FaqSectionData {
  eyebrow?: string;
  mainTitle: string;
  accentTitle?: string;
  mainSubtitle: string;
  rows: FaqRow[];
}

export interface FaqCardProps {
  tag?: string;
  question: string;
  answer: string;
}

/**
 * FaqCard
 * Reusable card for a single FAQ item styled in the Orbit blue-and-white theme.
 */
export function FaqCard({ tag, question, answer }: FaqCardProps) {
  return (
    <article className="faq-card flex w-80 shrink-0 flex-col justify-between gap-3 rounded-3xl border border-[#dce5fa] bg-white/95 p-6 shadow-[0_18px_50px_-28px_rgba(24,60,115,0.22)] transition duration-200 hover:-translate-y-0.5 hover:border-[#4773ec]/60 sm:w-96">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#eef3ff] text-[#4673eb]">
            <HelpCircle className="h-4 w-4" />
          </span>
          {tag ? (
            <span className="rounded-full border border-[#dce5fa] bg-[#f8faff] px-3 py-1 text-[11px] font-medium text-[#4d5a83]">
              {tag}
            </span>
          ) : null}
        </div>
        <h3 className="faq-title text-lg font-semibold leading-snug tracking-[-0.02em] text-[#080e2b]">
          {question}
        </h3>
        <p className="faq-answer text-sm leading-relaxed text-[#5c6b94]">
          {answer}
        </p>
      </div>
    </article>
  );
}

export interface HorizontalScrollerProps {
  children: ReactNode;
  speed?: string;
  direction?: 'left' | 'right';
}

/**
 * HorizontalScroller
 * Wraps children and creates a seamless horizontal looping animation that pauses on hover.
 */
export function HorizontalScroller({
  children,
  speed = '40s',
  direction = 'left',
}: HorizontalScrollerProps) {
  const animationClass =
    direction === 'right'
      ? 'animate-scroll-horizontal-reverse'
      : 'animate-scroll-horizontal';

  const style = { '--scroll-duration': speed } as CSSProperties;

  return (
    <div className="scroller-mask group relative w-full overflow-hidden py-2">
      <div className={`flex ${animationClass}`} style={style}>
        <div className="flex shrink-0 items-stretch justify-center gap-6 px-3">
          {children}
        </div>
        <div
          className="flex shrink-0 items-stretch justify-center gap-6 px-3"
          aria-hidden="true"
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export interface FaqSectionProps {
  data: FaqSectionData;
}

/**
 * FaqSection
 * Assembles the editorial Orbit header and multiple horizontal scrolling FAQ rows.
 */
export default function FaqSection({ data }: FaqSectionProps) {
  return (
    <section
      aria-labelledby="faq-section-heading"
      className="font-orbit-sans relative flex w-full flex-col items-center gap-10 overflow-hidden bg-gradient-to-b from-white via-[#f8faff] to-[#f6f9ff] px-4 py-16 sm:px-6 lg:py-20"
    >
      <div className="relative z-10 flex max-w-2xl flex-col items-center gap-4 text-center">
        {data.eyebrow ? (
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#4a72e7]">
            {data.eyebrow}
          </p>
        ) : null}
        <h2
          id="faq-section-heading"
          className="text-3xl font-semibold leading-tight tracking-[-0.03em] text-[#080e2b] sm:text-5xl"
          style={{
            opacity: 0,
            animation: 'fadeInUp 0.7s ease-out 0.15s forwards',
          }}
        >
          {data.mainTitle}{' '}
          {data.accentTitle ? (
            <em
              className="font-orbit-serif font-normal text-[#4a72e7]"
              style={{ fontStyle: 'italic' }}
            >
              {data.accentTitle}
            </em>
          ) : null}
        </h2>
        <p
          className="text-base leading-relaxed text-[#5c6b94] sm:text-lg"
          style={{
            opacity: 0,
            animation: 'fadeInUp 0.7s ease-out 0.3s forwards',
          }}
        >
          {data.mainSubtitle}
        </p>
      </div>

      <div className="relative z-10 flex w-full max-w-7xl flex-col gap-5">
        {data.rows.map((row) => (
          <HorizontalScroller
            key={row.id}
            speed={row.speed}
            direction={row.direction}
          >
            {row.faqItems.map((item) => (
              <FaqCard
                key={item.id}
                tag={item.tag}
                question={item.question}
                answer={item.answer}
              />
            ))}
          </HorizontalScroller>
        ))}
      </div>
    </section>
  );
}


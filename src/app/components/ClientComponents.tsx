"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/* ─── EMAIL CTA CONSTANTS (local to avoid coupling with EmailCTA.tsx) ─── */
const PENDING_SIGN_IN_EMAIL_KEY = "pending_sign_in_email";
const PENDING_ONBOARDING_EMAIL_KEY = "pending_onboarding_email";

/* ─── LOGO LINK ─── */

export function LogoLink() {
  return (
    <Link href="/" className="flex items-center gap-2 text-forest">
      <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
      <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
    </Link>
  );
}

/* ─── GLASS HEADER (real transparent backdrop-blur, like outings) ─── */

export function GlassHeader() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 transition-all duration-500"
      style={scrolled ? {
        background: 'rgba(11, 26, 18, 0.3)',
        backdropFilter: 'blur(20px) saturate(1.8)',
        WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.15)',
      } : {
        background: 'transparent',
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
        borderBottom: '1px solid transparent',
      }}
    >
      <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2 text-bone transition-colors duration-400">
          <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
          <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
        </Link>
        <a
          href="/login"
          className="text-xs sm:text-sm tracking-wider uppercase font-medium text-bone/90 hover:text-bone transition-colors duration-400 shrink-0 mr-4 md:mr-0"
        >
          Sign In
        </a>
      </div>
    </header>
  );
}

/* ─── SCROLL REVEAL ─── */

interface ScrollRevealProps {
  children: ReactNode;
  className?: string;
  direction?: "up" | "left" | "right";
  delay?: number;
  threshold?: number;
  once?: boolean;
}

export function ScrollReveal({
  children,
  className = "",
  direction = "up",
  delay = 0,
  threshold = 0.12,
  once = true,
}: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          if (once) observer.unobserve(entry.target);
        }
      },
      { threshold }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold, once]);

  const offsets: Record<string, string> = {
    up: "translate3d(0, 48px, 0)",
    left: "translate3d(-48px, 0, 0)",
    right: "translate3d(48px, 0, 0)",
  };

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translate3d(0,0,0)" : offsets[direction],
        transition: `opacity 0.9s cubic-bezier(0.16,1,0.3,1) ${delay}s, transform 0.9s cubic-bezier(0.16,1,0.3,1) ${delay}s`,
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}

/* ─── FADE-IN SECTION (for next-section peek) ─── */

interface FadeInSectionProps {
  children: ReactNode;
  className?: string;
  initialOpacity?: number;
}

export function FadeInSection({
  children,
  className = "",
  initialOpacity = 0.2,
}: FadeInSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [opacity, setOpacity] = useState(initialOpacity);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const thresholds = Array.from({ length: 25 }, (_, i) => i / 24);

    const observer = new IntersectionObserver(
      ([entry]) => {
        const ratio = entry.intersectionRatio;
        setOpacity(initialOpacity + ratio * (1 - initialOpacity));
      },
      { threshold: thresholds }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [initialOpacity]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity,
        transition: "opacity 0.15s ease-out",
      }}
    >
      {children}
    </div>
  );
}

/* ─── STAT COUNTER ─── */

interface StatCounterProps {
  end: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  label: string;
  dark?: boolean;
}

export function StatCounter({
  end,
  suffix = "",
  prefix = "",
  duration = 2200,
  label,
  dark,
}: StatCounterProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started) {
          setStarted(true);
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.4 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [started]);

  useEffect(() => {
    if (!started) return;

    const startTime = performance.now();
    let raf: number;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(eased * end));
      if (progress < 1) raf = requestAnimationFrame(animate);
    };

    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [started, end, duration]);

  return (
    <div ref={ref} className="text-center">
      <span className={`font-serif text-4xl md:text-5xl lg:text-[3.5rem] block mb-2 ${dark ? "text-bone" : "text-forest"}`}>
        {prefix}
        {count.toLocaleString()}
        {suffix}
      </span>
      <span className={`text-xs tracking-[0.25em] uppercase font-medium ${dark ? "text-bone/50" : "text-charcoal/50"}`}>
        {label}
      </span>
    </div>
  );
}

/* ─── FLOATING CTA BAR ─── */

export function FloatingCTA() {
  const [visible, setVisible] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const hero = document.getElementById("hero");
    const bottomCta = document.getElementById("bottom-cta");
    if (!hero) return;

    const heroObs = new IntersectionObserver(
      ([entry]) => setVisible(() => {
        const bottomEl = document.getElementById("bottom-cta");
        if (bottomEl) {
          const rect = bottomEl.getBoundingClientRect();
          if (rect.top < window.innerHeight) return false;
        }
        return !entry.isIntersecting;
      }),
      { threshold: 0 }
    );
    heroObs.observe(hero);

    let bottomObs: IntersectionObserver | undefined;
    if (bottomCta) {
      bottomObs = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) setVisible(false);
          else {
            const heroRect = hero.getBoundingClientRect();
            if (heroRect.bottom < 0) setVisible(true);
          }
        },
        { threshold: 0 }
      );
      bottomObs.observe(bottomCta);
    }

    return () => {
      heroObs.disconnect();
      bottomObs?.disconnect();
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/check-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.exists === true) {
        sessionStorage.setItem(PENDING_SIGN_IN_EMAIL_KEY, email.trim());
        router.push("/login");
      } else {
        sessionStorage.setItem(PENDING_ONBOARDING_EMAIL_KEY, email.trim());
        router.push("/onboarding");
      }
    } catch {
      sessionStorage.setItem(PENDING_ONBOARDING_EMAIL_KEY, email.trim());
      router.push("/onboarding");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 z-40 pointer-events-none transition-all duration-400 ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-full"}`}
      aria-hidden={!visible}
    >
      <div
        className="pointer-events-auto px-4 py-3 md:px-6 safe-area-bottom"
        style={{
          background: 'rgba(11, 26, 18, 0.3)',
          backdropFilter: 'blur(20px) saturate(1.8)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.8)',
          borderTop: '1px solid rgba(255, 255, 255, 0.15)',
        }}
      >
        <div className="max-w-7xl mx-auto w-full flex items-center justify-between gap-4">
          <p className="text-sm md:text-base text-bone/70 font-medium hidden sm:block leading-tight shrink-0">
            Join 2,400+ members with Reserve access.
          </p>
          <form onSubmit={handleSubmit} className="flex items-center gap-2 w-full sm:w-auto sm:shrink-0">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your email"
              required
              className="h-10 px-3 rounded-lg bg-white/10 border border-white/15 text-bone text-sm placeholder:text-bone/40 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-colors w-full sm:w-56"
            />
            <button
              type="submit"
              disabled={loading}
              className="h-10 px-5 rounded-lg bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 btn-press whitespace-nowrap disabled:opacity-60"
            >
              {loading ? "..." : "Unlock Access"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ─── SCROLL-ANIMATED CHEVRON ─── */

export function ScrollChevron({ light }: { light?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 animate-bounce-slow">
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className={light ? "text-bone/40" : "text-taupe/60"}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19 9l-7 7-7-7"
        />
      </svg>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";

/* ─── LOGO LINK ─── */

export function LogoLink() {
  return (
    <Link href="/" className="flex items-center gap-2 text-forest">
      <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
      <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
    </Link>
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
}

export function StatCounter({
  end,
  suffix = "",
  prefix = "",
  duration = 2200,
  label,
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
      <span className="font-serif text-4xl md:text-5xl lg:text-6xl text-forest block mb-2">
        {prefix}
        {count.toLocaleString()}
        {suffix}
      </span>
      <span className="text-xs tracking-[0.25em] uppercase text-charcoal/50 font-medium">
        {label}
      </span>
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

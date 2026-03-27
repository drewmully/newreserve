"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMembership } from "../context/MembershipContext";
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal } from "../components/UpgradeModal";
import { ScrollReveal } from "../components/ClientComponents";
import {
  getCollectionProducts,
  mergeCollectionProductsBySlug,
  PRO_SHOP_COLLECTION_HANDLE,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  type ShopifyProduct,
} from "@/lib/shopify";
import { posts as communityPosts, type ForumPost } from "../community/posts";

/* ═══════════════════════════════════════════
   HOME — The Clubhouse
   Personal golf command center for logged-in members
   ═══════════════════════════════════════════ */

/* ── Weather Types ── */
interface WeatherData {
  temp: number;
  feelsLike: number;
  condition: string;
  icon: string;
  windSpeed: number;
  humidity: number;
  uvIndex: number;
  sunrise: string;
  sunset: string;
  golfScore: number;
}

/* ── Golf Round Types ── */
interface GolfRound {
  date: string;
  course: string;
  score: number;
}

/* ── Seasonal Editorial ── */
interface EditorialCard {
  title: string;
  subtitle: string;
  cta: string;
  href: string;
  gradient: string;
}

function getSeasonalEditorial(): EditorialCard {
  const month = new Date().getMonth();
  if (month >= 2 && month <= 4) {
    return {
      title: "Course Opening Guide",
      subtitle: "5 things to dial in before your first round of the season",
      cta: "Read More",
      href: "/blog",
      gradient: "from-forest via-forest-light to-sage/80",
    };
  } else if (month >= 5 && month <= 7) {
    return {
      title: "Peak Season Essentials",
      subtitle: "The gear and apparel our team is reaching for every round this summer",
      cta: "Shop the Edit",
      href: "/dashboard?tab=shop",
      gradient: "from-ember/90 via-ember to-forest",
    };
  } else if (month >= 8 && month <= 10) {
    return {
      title: "Fall Golf Playbook",
      subtitle: "Layer up, play more — our guide to extending your season",
      cta: "Explore",
      href: "/blog",
      gradient: "from-forest-dark via-forest to-sage",
    };
  }
  return {
    title: "Off-Season Edge",
    subtitle: "Indoor training, gear maintenance, and getting fitted for next season",
    cta: "Get Ready",
    href: "/blog",
    gradient: "from-obsidian via-charcoal to-forest-dark",
  };
}

/* ── Weather Helpers ── */
function computeGolfScore(temp: number, wind: number, humidity: number, uvIndex: number): number {
  let score = 10;
  // Temperature (ideal 65-80°F)
  if (temp < 50) score -= 3;
  else if (temp < 60) score -= 1.5;
  else if (temp > 90) score -= 2.5;
  else if (temp > 85) score -= 1;
  // Wind (ideal < 10mph)
  if (wind > 25) score -= 3;
  else if (wind > 15) score -= 1.5;
  else if (wind > 10) score -= 0.5;
  // Humidity
  if (humidity > 85) score -= 1;
  // UV
  if (uvIndex > 8) score -= 0.5;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function getWeatherEmoji(condition: string): string {
  const c = condition.toLowerCase();
  if (c.includes("clear") || c.includes("sunny")) return "☀️";
  if (c.includes("cloud") && c.includes("part")) return "⛅";
  if (c.includes("cloud")) return "☁️";
  if (c.includes("rain") || c.includes("drizzle")) return "🌧️";
  if (c.includes("thunder") || c.includes("storm")) return "⛈️";
  if (c.includes("snow")) return "❄️";
  if (c.includes("fog") || c.includes("mist")) return "🌫️";
  return "🌤️";
}

function getGolfScoreLabel(score: number): string {
  if (score >= 9) return "Perfect";
  if (score >= 7) return "Great";
  if (score >= 5) return "Good";
  if (score >= 3) return "Fair";
  return "Tough";
}

function getGolfScoreColor(score: number): string {
  if (score >= 8) return "text-green-600";
  if (score >= 6) return "text-sage";
  if (score >= 4) return "text-ember";
  return "text-red-500";
}

/* ── Time greeting ── */
function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

function getMemberDuration(creationTime: string | undefined): string {
  if (!creationTime) return "";
  const created = new Date(creationTime);
  const now = new Date();
  const months = (now.getFullYear() - created.getFullYear()) * 12 + (now.getMonth() - created.getMonth());
  if (months < 1) return "New member";
  if (months < 12) return `Member for ${months} month${months === 1 ? "" : "s"}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `Member for ${years} year${years === 1 ? "" : "s"}`;
  return `Member for ${years}y ${rem}m`;
}

/* ═══════════════════════════════════════════
   MAIN HOME COMPONENT
   ═══════════════════════════════════════════ */

export default function HomePage() {
  const router = useRouter();
  const {
    isSignedIn,
    authLoading,
    user,
    username,
    tier,
    tierLabel,
    storeCredit,
    onboardingProfile,
    fitProfile,
    cartCount,
    setCartOpen,
    addToCart,
    refreshStoreCredit,
    refreshSubscriptionStatus,
  } = useMembership();

  const isPaid = tier === "access" || tier === "member" || tier === "black";

  // ── Auth guard ──
  useEffect(() => {
    if (!authLoading && !isSignedIn) {
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, router]);

  // ── Refresh data on mount ──
  useEffect(() => {
    if (isSignedIn) {
      void refreshStoreCredit();
      void refreshSubscriptionStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // ── Weather state ──
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather() {
      try {
        // Try geolocation first
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) reject(new Error("No geolocation"));
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });

        const { latitude, longitude } = pos.coords;
        const res = await fetch(`/api/weather?lat=${latitude}&lon=${longitude}`);
        if (!res.ok) throw new Error("Weather API failed");
        const data = await res.json();
        if (!cancelled) {
          setWeather(data);
          setWeatherLoading(false);
        }
      } catch {
        // Fallback: use a default location or show graceful error
        if (!cancelled) {
          setWeatherError(true);
          setWeatherLoading(false);
        }
      }
    }

    if (isSignedIn) fetchWeather();
    return () => { cancelled = true; };
  }, [isSignedIn]);

  // ── Products state ──
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadProducts() {
      try {
        const [proShop, privateReleases] = await Promise.all([
          getCollectionProducts(PRO_SHOP_COLLECTION_HANDLE),
          getCollectionProducts(PRIVATE_RELEASES_COLLECTION_HANDLE),
        ]);
        if (!cancelled) {
          setProducts(mergeCollectionProductsBySlug([
            { handle: PRO_SHOP_COLLECTION_HANDLE, products: proShop },
            { handle: PRIVATE_RELEASES_COLLECTION_HANDLE, products: privateReleases },
          ]));
          setProductsLoading(false);
        }
      } catch {
        if (!cancelled) setProductsLoading(false);
      }
    }
    loadProducts();
    return () => { cancelled = true; };
  }, []);

  // ── Golf stats state (mock for now — will be Firestore later) ──
  const [golfRounds] = useState<GolfRound[]>([]);

  // ── Upgrade modal ──
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // ── Cart badge ──
  const [badgePop, setBadgePop] = useState(false);
  const prevCartCount = useRef(cartCount);
  useEffect(() => {
    if (cartCount > prevCartCount.current) {
      setBadgePop(true);
      const t = setTimeout(() => setBadgePop(false), 400);
      return () => clearTimeout(t);
    }
    prevCartCount.current = cartCount;
  }, [cartCount]);

  // ── Countdown state ──
  const [countdown, setCountdown] = useState("");
  const DROP_DATE = new Date("2025-08-01T12:00:00Z"); // Placeholder
  const dropActive = DROP_DATE.getTime() > Date.now();

  useEffect(() => {
    if (!dropActive) return;
    const tick = () => {
      const diff = DROP_DATE.getTime() - Date.now();
      if (diff <= 0) { setCountdown("LIVE NOW"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(`${d}d ${String(h).padStart(2, "0")}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropActive]);

  // ── Curated products (personalized selection) ──
  const curatedProducts = getCuratedProducts(products, fitProfile?.shirtSize, onboardingProfile?.vibeCheck);
  const staffPick = products.length > 0 ? products[Math.floor(products.length * 0.3)] : null;

  // ── Community posts (top 3) ──
  const topPosts = [...communityPosts].sort((a, b) => b.likes - a.likes).slice(0, 3);

  // ── Seasonal editorial ──
  const editorial = getSeasonalEditorial();

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── TOP BAR ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20 header-grass">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/home" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </Link>
          <div className="flex items-center gap-5">
            <button
              onClick={() => setCartOpen(true)}
              className="relative text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer"
              aria-label="Cart"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              {cartCount > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ember text-white text-[10px] font-medium flex items-center justify-center ${badgePop ? "animate-badge-pop" : ""}`}>
                  {cartCount}
                </span>
              )}
            </button>
            <Link href="/account" className="text-forest hover:text-forest-dark transition-colors duration-300" aria-label="Account">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <main className="pt-24 pb-32 md:pb-24">
        {/* ═══════════════════════════════════════════
           1. THE FIRST TEE — Greeting
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-8">
          <div className="animate-fade-up">
            <p className="text-xs tracking-[0.3em] uppercase text-sage font-medium mb-2">
              {getFormattedDate()}
            </p>
            <h1 className="font-serif text-4xl md:text-5xl lg:text-[3.5rem] text-obsidian leading-tight mb-4">
              {getGreeting()},{" "}
              <span className="text-forest">{username || "Member"}</span>.
            </h1>
            <div className="flex flex-wrap items-center gap-3">
              {/* Tier Badge */}
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium tracking-wide glass-card glass-card-dark text-bone/90">
                <span className={`w-1.5 h-1.5 rounded-full ${tier === "black" ? "bg-bone" : tier === "member" ? "bg-ember" : tier === "access" ? "bg-sage" : "bg-taupe"}`} />
                {tierLabel}
              </span>
              {/* Member Duration */}
              {user?.metadata?.creationTime && (
                <span className="text-xs text-charcoal/50 tracking-wide">
                  {getMemberDuration(user.metadata.creationTime)}
                </span>
              )}
              {/* Store Credit */}
              {storeCredit && storeCredit.balance_cents > 0 && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-ember/10 text-ember border border-ember/20">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  ${(storeCredit.balance_cents / 100).toFixed(0)} credit
                </span>
              )}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
           2. TODAY'S ROUND — Weather & Golf-ability
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <ScrollReveal>
            <div className="relative overflow-hidden rounded-2xl">
              {weather && !weatherError ? (
                <div className="bg-gradient-to-br from-forest via-forest-light to-sage/70 p-6 md:p-8 text-bone">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    {/* Left: Weather info */}
                    <div className="flex-1">
                      <p className="text-xs tracking-[0.3em] uppercase text-bone/50 font-medium mb-3">
                        {onboardingProfile?.clubName ? onboardingProfile.clubName : "Your Area"} — Today
                      </p>
                      <div className="flex items-center gap-4 mb-4">
                        <span className="text-5xl">{getWeatherEmoji(weather.condition)}</span>
                        <div>
                          <p className="font-serif text-4xl md:text-5xl font-bold">{weather.temp}°F</p>
                          <p className="text-sm text-bone/60">{weather.condition} · Feels like {weather.feelsLike}°F</p>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div className="bg-white/10 rounded-xl px-3 py-2">
                          <p className="text-[10px] tracking-wider uppercase text-bone/50">Wind</p>
                          <p className="text-sm font-medium">{weather.windSpeed} mph</p>
                        </div>
                        <div className="bg-white/10 rounded-xl px-3 py-2">
                          <p className="text-[10px] tracking-wider uppercase text-bone/50">Humidity</p>
                          <p className="text-sm font-medium">{weather.humidity}%</p>
                        </div>
                        <div className="bg-white/10 rounded-xl px-3 py-2">
                          <p className="text-[10px] tracking-wider uppercase text-bone/50">Sunrise</p>
                          <p className="text-sm font-medium">{weather.sunrise}</p>
                        </div>
                        <div className="bg-white/10 rounded-xl px-3 py-2">
                          <p className="text-[10px] tracking-wider uppercase text-bone/50">Sunset</p>
                          <p className="text-sm font-medium">{weather.sunset}</p>
                        </div>
                      </div>
                      {weather.uvIndex > 5 && (
                        <p className="mt-3 text-xs text-bone/60 flex items-center gap-1.5">
                          <svg className="w-3.5 h-3.5 text-ember" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                          </svg>
                          UV Index {weather.uvIndex} — SPF 50 recommended
                        </p>
                      )}
                    </div>

                    {/* Right: Golf-ability Score */}
                    <div className="flex flex-col items-center">
                      <p className="text-[10px] tracking-[0.3em] uppercase text-bone/50 font-medium mb-3">Golf-ability</p>
                      <div className="relative w-28 h-28">
                        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90">
                          <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="8" />
                          <circle
                            cx="60" cy="60" r="52" fill="none"
                            stroke="currentColor"
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${(weather.golfScore / 10) * 327} 327`}
                            className={getGolfScoreColor(weather.golfScore)}
                            style={{ filter: "drop-shadow(0 0 6px currentColor)" }}
                          />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                          <span className="font-serif text-3xl font-bold text-bone">{weather.golfScore}</span>
                          <span className="text-[10px] text-bone/60">/10</span>
                        </div>
                      </div>
                      <p className={`text-sm font-medium mt-2 ${getGolfScoreColor(weather.golfScore)}`}>
                        {getGolfScoreLabel(weather.golfScore)}
                      </p>
                    </div>
                  </div>
                </div>
              ) : weatherLoading ? (
                <div className="bg-gradient-to-br from-forest via-forest-light to-sage/70 p-8 text-bone flex items-center justify-center h-48">
                  <div className="flex items-center gap-3">
                    <div className="w-4 h-4 border-2 border-bone/30 border-t-bone rounded-full animate-spin" />
                    <span className="text-sm text-bone/60">Loading conditions...</span>
                  </div>
                </div>
              ) : (
                <div className="bg-gradient-to-br from-forest via-forest-light to-sage/70 p-8 text-bone">
                  <p className="text-xs tracking-[0.3em] uppercase text-bone/50 font-medium mb-2">Course Conditions</p>
                  <p className="text-sm text-bone/70">
                    Enable location access to see today&apos;s golf conditions and your personalized Golf-ability Score.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-3 text-xs text-bone/90 border border-bone/30 rounded-full px-4 py-1.5 hover:bg-bone/10 transition-colors btn-press cursor-pointer"
                  >
                    Enable Location
                  </button>
                </div>
              )}
            </div>
          </ScrollReveal>
        </section>

        {/* ═══════════════════════════════════════════
           3. QUICK ACTIONS — The Bag (desktop inline)
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10 hidden md:block">
          <ScrollReveal delay={0.05}>
            <div className="flex items-center gap-3">
              {[
                { label: "Shop", href: "/dashboard?tab=shop", icon: "M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
                { label: "Drops", href: "/dashboard?tab=drops", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
                { label: "Community", href: "/dashboard?tab=community", icon: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" },
                { label: "Benefits", href: "/dashboard?tab=benefits", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
                { label: "Account", href: "/account", icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" },
              ].map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-taupe/25 text-charcoal/70 hover:text-forest hover:border-forest/30 hover:bg-forest/5 transition-all duration-300 btn-press"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="text-xs font-medium tracking-wide">{item.label}</span>
                </Link>
              ))}
            </div>
          </ScrollReveal>
        </section>

        {/* ═══════════════════════════════════════════
           4. THE DROP ZONE — Countdown
           ═══════════════════════════════════════════ */}
        {dropActive && (
          <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
            <ScrollReveal delay={0.1}>
              <div className="relative overflow-hidden rounded-2xl topo-pattern-dark p-6 md:p-8">
                {/* Grain overlay */}
                <div className="absolute inset-0 hero-grain opacity-30 pointer-events-none" />
                <div className="relative z-10">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div>
                      <p className="text-[10px] tracking-[0.35em] uppercase text-bone/40 font-medium mb-2">Next Exclusive Drop</p>
                      <h2 className="font-serif text-2xl md:text-3xl text-bone mb-1">Summer Reserve Collection</h2>
                      <p className="text-sm text-bone/50">Members-only access to limited pieces from top brands.</p>
                    </div>
                    <div className="text-center md:text-right">
                      <p className="text-[10px] tracking-[0.3em] uppercase text-bone/40 mb-2">Dropping In</p>
                      {countdown === "LIVE NOW" ? (
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-ember animate-pulse" />
                          <span className="font-serif text-2xl text-ember font-bold">LIVE NOW</span>
                        </div>
                      ) : (
                        <p className="font-mono text-2xl md:text-3xl text-bone font-bold tracking-wider">{countdown}</p>
                      )}
                    </div>
                  </div>
                  <div className="mt-5 flex items-center gap-3">
                    <Link
                      href="/dashboard?tab=drops"
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-bone text-forest text-xs font-medium tracking-wide hover:bg-cream transition-colors btn-press"
                    >
                      {countdown === "LIVE NOW" ? "Shop Now" : "View Drops"}
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </Link>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </section>
        )}

        {/* ═══════════════════════════════════════════
           5. THE CADDIE'S PICK — Curated Products
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <ScrollReveal delay={0.1}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] tracking-[0.35em] uppercase text-sage font-medium mb-1">Curated For You</p>
                <h2 className="font-serif text-2xl md:text-3xl text-obsidian">The Caddie&apos;s Pick</h2>
              </div>
              <Link
                href="/dashboard?tab=shop"
                className="text-xs text-forest font-medium tracking-wide hover:text-forest-dark transition-colors link-hover-underline"
              >
                View All
              </Link>
            </div>

            {productsLoading ? (
              <div className="flex items-center justify-center h-48">
                <div className="w-4 h-4 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
              </div>
            ) : (
              <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide -mx-6 px-6 md:mx-0 md:px-0 snap-x snap-mandatory">
                {/* Staff Pick card */}
                {staffPick && (
                  <div className="flex-shrink-0 w-64 md:w-72 snap-start">
                    <div className="relative rounded-2xl overflow-hidden border-2 border-ember/30 bg-cream group product-tile-hover">
                      <div className="absolute top-3 left-3 z-10 bg-ember text-bone text-[10px] font-bold tracking-wider uppercase px-2.5 py-1 rounded-full">
                        Staff Pick
                      </div>
                      <div className="aspect-square bg-bone-dark overflow-hidden product-img-wrap">
                        {staffPick.images[0] && (
                          <img
                            src={staffPick.images[0]}
                            alt={staffPick.name}
                            className="w-full h-full object-cover product-img-primary"
                          />
                        )}
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-sage font-medium">{staffPick.brand}</p>
                        <p className="text-sm font-medium text-obsidian mt-0.5 line-clamp-1">{staffPick.name}</p>
                        <p className="text-xs text-charcoal/50 mt-1 italic line-clamp-2">
                          &ldquo;Our team is living in this right now.&rdquo;
                        </p>
                        <div className="flex items-center justify-between mt-3">
                          <div className="flex items-center gap-2">
                            {isPaid && staffPick.price > staffPick.reservePrice && (
                              <span className="text-xs text-charcoal/40 line-through">${staffPick.price}</span>
                            )}
                            <span className="text-sm font-semibold text-forest">
                              ${isPaid ? staffPick.reservePrice : staffPick.price}
                            </span>
                          </div>
                          <button
                            onClick={() => addToCart({
                              slug: staffPick.slug,
                              name: staffPick.name,
                              brand: staffPick.brand,
                              price: isPaid ? staffPick.reservePrice : staffPick.price,
                              variantId: staffPick.variantId,
                              image: staffPick.images[0],
                            })}
                            className="w-8 h-8 rounded-full bg-forest text-bone flex items-center justify-center hover:bg-forest-dark transition-colors btn-press cursor-pointer"
                            aria-label="Add to cart"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Curated products */}
                {curatedProducts.map((product) => (
                  <div key={product.slug} className="flex-shrink-0 w-56 md:w-64 snap-start">
                    <Link href={`/shop/${product.slug}`} className="block rounded-2xl overflow-hidden bg-cream group product-tile-hover border border-taupe/15">
                      <div className="aspect-square bg-bone-dark overflow-hidden product-img-wrap">
                        {product.images[0] && (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            className="w-full h-full object-cover product-img-primary"
                          />
                        )}
                        {product.images[1] && (
                          <img
                            src={product.images[1]}
                            alt=""
                            className="w-full h-full object-cover product-img-secondary"
                          />
                        )}
                      </div>
                      <div className="p-4">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-sage font-medium">{product.brand}</p>
                        <p className="text-sm font-medium text-obsidian mt-0.5 line-clamp-1">{product.name}</p>
                        <div className="flex items-center gap-2 mt-2">
                          {isPaid && product.price > product.reservePrice && (
                            <span className="text-xs text-charcoal/40 line-through">${product.price}</span>
                          )}
                          <span className="text-sm font-semibold text-forest">
                            ${isPaid ? product.reservePrice : product.price}
                          </span>
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </ScrollReveal>
        </section>

        {/* ═══════════════════════════════════════════
           6. THE SCORECARD — Golf Stats
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <ScrollReveal delay={0.15}>
            <div className="relative overflow-hidden rounded-2xl topo-pattern p-6 md:p-8 text-bone">
              <div className="absolute inset-0 hero-grain opacity-20 pointer-events-none" />
              <div className="relative z-10">
                <p className="text-[10px] tracking-[0.35em] uppercase text-bone/40 font-medium mb-1">Your Season</p>
                <h2 className="font-serif text-2xl md:text-3xl text-bone mb-6">The Scorecard</h2>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-6">
                  {/* Handicap */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {onboardingProfile?.handicap || "—"}
                    </p>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 mt-1">Handicap</p>
                  </div>

                  {/* Rounds This Month */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {golfRounds.filter(r => {
                        const d = new Date(r.date);
                        const now = new Date();
                        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
                      }).length || "0"}
                    </p>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 mt-1">Rounds This Month</p>
                  </div>

                  {/* Best Score */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {golfRounds.length > 0 ? Math.min(...golfRounds.map(r => r.score)) : "—"}
                    </p>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 mt-1">Best Score</p>
                  </div>

                  {/* Total Rounds */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {golfRounds.length || "0"}
                    </p>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 mt-1">Total Rounds</p>
                  </div>
                </div>

                {/* Achievements */}
                <div className="mt-6 flex items-center gap-3 overflow-x-auto scrollbar-hide pb-1">
                  <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 whitespace-nowrap mr-1">Badges</p>
                  {[
                    { label: "Early Adopter", emoji: "🏅", earned: true },
                    { label: "First Purchase", emoji: "🛍️", earned: isPaid },
                    { label: "Community Voice", emoji: "💬", earned: false },
                    { label: "Drop Collector", emoji: "⚡", earned: false },
                    { label: "10 Rounds", emoji: "🏌️", earned: golfRounds.length >= 10 },
                  ].map((badge) => (
                    <div
                      key={badge.label}
                      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs transition-all ${
                        badge.earned
                          ? "bg-ember/20 text-bone border border-ember/30"
                          : "bg-white/5 text-bone/30 border border-white/10"
                      }`}
                    >
                      <span className={badge.earned ? "" : "grayscale opacity-40"}>{badge.emoji}</span>
                      <span className="whitespace-nowrap">{badge.label}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5">
                  <button
                    className="text-xs text-bone/70 border border-bone/20 rounded-full px-5 py-2 hover:bg-bone/10 transition-colors btn-press cursor-pointer"
                    onClick={() => {/* TODO: Open log round modal */}}
                  >
                    + Log a Round
                  </button>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>

        {/* ═══════════════════════════════════════════
           7. THE 19TH HOLE — Community Feed
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <ScrollReveal delay={0.15}>
            <div className="flex items-center justify-between mb-5">
              <div>
                <p className="text-[10px] tracking-[0.35em] uppercase text-sage font-medium mb-1">Live From The Community</p>
                <h2 className="font-serif text-2xl md:text-3xl text-obsidian">The 19th Hole</h2>
              </div>
              <Link
                href="/dashboard?tab=community"
                className="text-xs text-forest font-medium tracking-wide hover:text-forest-dark transition-colors link-hover-underline"
              >
                View All
              </Link>
            </div>

            <div className="space-y-3">
              {topPosts.map((post) => (
                <Link
                  key={post.id}
                  href={`/community/post/${post.id}`}
                  className="block rounded-xl bg-cream border border-taupe/15 p-4 md:p-5 tile-hover group"
                >
                  <div className="flex items-start gap-4">
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-forest/10 flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-bold text-forest">{post.avatar}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold text-obsidian">{post.author}</span>
                        <span className="text-xs text-charcoal/40">{post.timestamp}</span>
                        {post.likes > 20 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-ember/10 text-ember font-medium">Hot</span>
                        )}
                      </div>
                      <p className="text-sm font-medium text-charcoal/80 line-clamp-1">{post.title}</p>
                      <p className="text-xs text-charcoal/50 mt-1 line-clamp-1">{post.body}</p>
                      <div className="flex items-center gap-4 mt-2">
                        <span className="flex items-center gap-1 text-xs text-charcoal/40">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                          </svg>
                          {post.likes}
                        </span>
                        <span className="flex items-center gap-1 text-xs text-charcoal/40">
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                          </svg>
                          {post.comments.length}
                        </span>
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-forest/8 text-forest/70 font-medium">{post.tag}</span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>

            <div className="mt-4 text-center">
              <Link
                href="/dashboard?tab=community"
                className="inline-flex items-center gap-2 text-xs text-forest font-medium hover:text-forest-dark transition-colors btn-press"
              >
                Start a conversation
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
            </div>
          </ScrollReveal>
        </section>

        {/* ═══════════════════════════════════════════
           8. THE CLUBHOUSE BULLETIN — Seasonal Editorial
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <ScrollReveal delay={0.2}>
            <Link href={editorial.href} className="block">
              <div className={`relative overflow-hidden rounded-2xl bg-gradient-to-br ${editorial.gradient} p-8 md:p-10 min-h-[200px] flex flex-col justify-end group tile-hover`}>
                <div className="absolute inset-0 hero-grain opacity-20 pointer-events-none" />
                <div className="relative z-10">
                  <p className="text-[10px] tracking-[0.35em] uppercase text-bone/40 font-medium mb-2">The Clubhouse Bulletin</p>
                  <h2 className="font-serif text-2xl md:text-3xl text-bone mb-2">{editorial.title}</h2>
                  <p className="text-sm text-bone/60 max-w-lg mb-4">{editorial.subtitle}</p>
                  <span className="inline-flex items-center gap-2 text-xs text-bone font-medium tracking-wide group-hover:gap-3 transition-all duration-300">
                    {editorial.cta}
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                  </span>
                </div>
              </div>
            </Link>
          </ScrollReveal>
        </section>

        {/* ═══════════════════════════════════════════
           UPGRADE CTA (for free members)
           ═══════════════════════════════════════════ */}
        {tier === "free" && (
          <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
            <ScrollReveal delay={0.2}>
              <div className="rounded-2xl glass-card glass-card-dark p-6 md:p-8 text-center">
                <p className="text-xs tracking-[0.3em] uppercase text-bone/40 font-medium mb-2">Unlock Everything</p>
                <h2 className="font-serif text-xl md:text-2xl text-bone mb-3">
                  Get Reserve pricing, exclusive drops, and more.
                </h2>
                <p className="text-sm text-bone/50 mb-5 max-w-md mx-auto">
                  Members save an average of 30% on premium golf brands with Reserve pricing and free 2-day shipping.
                </p>
                <button
                  onClick={() => setUpgradeOpen(true)}
                  className="px-6 py-2.5 rounded-full bg-bone text-forest text-sm font-medium hover:bg-cream transition-colors btn-press cursor-pointer"
                >
                  Explore Plans
                </button>
              </div>
            </ScrollReveal>
          </section>
        )}
      </main>

      {/* ─── MOBILE QUICK ACTIONS — Sticky Bottom Bar ─── */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-bone/95 backdrop-blur-md border-t border-taupe/20 md:hidden safe-area-bottom">
        <div className="flex items-center justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          {[
            { label: "Home", href: "/home", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25", active: true },
            { label: "Shop", href: "/dashboard?tab=shop", icon: "M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z", active: false },
            { label: "Drops", href: "/dashboard?tab=drops", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z", active: false },
            { label: "Community", href: "/dashboard?tab=community", icon: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155", active: false },
            { label: "Account", href: "/account", icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z", active: false },
          ].map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 ${item.active ? "text-forest" : "text-charcoal/40"}`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </nav>

      {/* ─── SLIDE CART ─── */}
      <SlideCart />

      {/* ─── UPGRADE MODAL ─── */}
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentTier={tier}
        onSelectPlan={(t) => {}}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

function getCuratedProducts(
  products: ShopifyProduct[],
  shirtSize?: string,
  vibeCheck?: string,
): ShopifyProduct[] {
  if (products.length === 0) return [];

  // Simple recommendation: shuffle and take 4
  // In a real implementation, filter by fit profile, exclude past purchases, seasonal logic
  const shuffled = [...products].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, 4);
}

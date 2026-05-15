"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useMembership } from "../context/MembershipContext";
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal } from "../components/UpgradeModal";
import { SetPasswordOrMagicLinkGate } from "../components/SetPasswordOrMagicLinkGate";
import {
  FirstBoxWelcomeDrawer,
  AccessWelcomeBanner,
  ProfileNudge,
} from "../components/WelcomeDrawers";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { ScrollReveal } from "../components/ClientComponents";
import { ClubhouseNav, ClubhouseBottomNav } from "../components/ClubhouseNav";
import { QuickAddToCartButton } from "../components/QuickAddToCartButton";
import {
  getCollectionProducts,
  mergeCollectionProductsBySlug,
  PRO_SHOP_COLLECTION_HANDLE,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  type ShopifyProduct,
} from "@/lib/shopify";
import { FEATURED_DROP, getExclusiveDropDate } from "@/lib/dropConfig";
import type { ForumPost } from "../community/posts";
import {
  calculateHandicapIndex,
  getRoundCourseRating,
  getRoundDifferential,
  getRoundSlopeRating,
  getWHSParams,
  sortGolfRounds,
  type GolfRound,
  type GolfRoundSortKey,
  type GolfRoundSortState,
} from "@/lib/golfStats";

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
  uvIndex: number | null;
  sunrise: string;
  sunset: string;
  golfScore: number;
  locationName: string;
  locationCountry: string | null;
  requestedLat: number;
  requestedLon: number;
  dataSource: "live" | "mock";
  locationSource: "query" | "vercel-ip" | "default";
  golfSummary: string;
}

type WeatherErrorState = "none" | "service";

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
    addToCart,
    refreshStoreCredit,
    refreshSubscriptionStatus,
  } = useMembership();

  const isPaid = tier === "access" || tier === "member" || tier === "black";

  // ── First-visit password / magic-link gate ──
  // Triggered when user signed up via passwordless EmailCTA flow.
  // Reads `password_set` from Firestore. While loading we render nothing
  // for the gate (allow page to render normally). Once we know the value,
  // if false, render the BLOCKING modal.
  const [passwordSet, setPasswordSet] = useState<boolean | null>(null);
  const [onboardingCompletedDoc, setOnboardingCompletedDoc] = useState<
    boolean | null
  >(null);

  useEffect(() => {
    let cancelled = false;
    async function loadFlags() {
      if (!user || !db) return;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data();
          setPasswordSet(data.password_set !== false);
          setOnboardingCompletedDoc(data.onboarding_completed === true);
        } else {
          // No doc yet, treat as needing the gate.
          setPasswordSet(false);
          setOnboardingCompletedDoc(false);
        }
      } catch (err) {
        console.error("[HomePage] failed to load user flags", err);
        // Fail open. Don't block the user if Firestore read errors.
        if (!cancelled) {
          setPasswordSet(true);
          setOnboardingCompletedDoc(true);
        }
      }
    }
    loadFlags();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const handleGateSatisfied = () => {
    setPasswordSet(true);
  };

  const showPasswordGate = passwordSet === false;
  const showWelcome =
    passwordSet === true && onboardingCompletedDoc === false;

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
  const [weatherError, setWeatherError] = useState<WeatherErrorState>("none");

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather(url: string) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Weather API failed");
      const data = await res.json();
      if (!cancelled) {
        setWeather(data);
        setWeatherError("none");
        setWeatherLoading(false);
      }
    }

    async function loadWeather() {
      try {
        // Try geolocation first
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) reject(new Error("No geolocation"));
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        await fetchWeather(`/api/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
      } catch {
        try {
          // If browser geolocation is unavailable, let the server resolve IP-based
          // coordinates on Vercel and only fall back to New York as a last resort.
          await fetchWeather("/api/weather");
        } catch (error) {
          console.error("[Home weather] Unable to load weather data", error);
          if (!cancelled) {
            setWeatherError("service");
            setWeatherLoading(false);
          }
        }
      }
    }

    if (isSignedIn) loadWeather();
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
  const [golfRounds, setGolfRounds] = useState<GolfRound[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(true);
  const [logRoundOpen, setLogRoundOpen] = useState(false);
  const [roundCourse, setRoundCourse] = useState("");
  const [roundDate, setRoundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roundScore, setRoundScore] = useState("");
  const [roundCourseRating, setRoundCourseRating] = useState("");
  const [roundSlopeRating, setRoundSlopeRating] = useState("");
  const [roundSaving, setRoundSaving] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [roundsHistoryOpen, setRoundsHistoryOpen] = useState(false);
  const [roundSort, setRoundSort] = useState<GolfRoundSortState>({
    key: "date",
    direction: "desc",
  });

  useEffect(() => {
    let cancelled = false;

    async function loadGolfRounds() {
      if (!isSignedIn || !user) {
        if (!cancelled) {
          setGolfRounds([]);
          setRoundsLoading(false);
        }
        return;
      }

      try {
        setRoundsLoading(true);
        const token = await user.getIdToken();
        const res = await fetch("/api/golf/rounds", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(`Golf rounds API failed (${res.status})`);
        const data = (await res.json()) as { rounds?: GolfRound[] };
        if (!cancelled) {
          setGolfRounds(data.rounds ?? []);
          setRoundsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setGolfRounds([]);
          setRoundsLoading(false);
        }
      }
    }

    void loadGolfRounds();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, user]);

  // ── Upgrade modal ──
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  // ── Countdown state ──
  const [countdown, setCountdown] = useState("");
  const [dropDate] = useState(() => getExclusiveDropDate());
  const dropActive = dropDate.getTime() > Date.now();

  useEffect(() => {
    if (!dropActive) return;
    const tick = () => {
      const diff = dropDate.getTime() - Date.now();
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
  }, [dropActive, dropDate]);

  // ── Curated products (personalized selection) ──
  const curatedProducts = getCuratedProducts(products, fitProfile?.shirtSize, onboardingProfile?.vibeCheck);
  const staffPick = products.length > 0 ? products[Math.floor(products.length * 0.3)] : null;

  // ── WHS Handicap Index ──
  const calculatedHandicap = calculateHandicapIndex(golfRounds);
  const sortedRounds = sortGolfRounds(golfRounds, roundSort);

  // ── Community posts (top 3) ──
  const [topPosts, setTopPosts] = useState<ForumPost[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/community/posts")
      .then((res) => res.json())
      .then((data: { posts?: ForumPost[] }) => {
        if (cancelled) return;
        const sorted = [...(data.posts ?? [])]
          .sort((a, b) => b.likes - a.likes)
          .slice(0, 3);
        setTopPosts(sorted);
      })
      .catch(() => {
        if (!cancelled) setTopPosts([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // ── Seasonal editorial ──
  const editorial = getSeasonalEditorial();
  const toggleRoundSort = (key: GolfRoundSortKey) => {
    setRoundSort((current) => ({
      key,
      direction:
        current.key === key && current.direction === "desc" ? "asc" : "desc",
    }));
  };

  const handleLogRound = async () => {
    if (!user) {
      setRoundError("You need to be signed in to log a round.");
      return;
    }

    const course = roundCourse.trim();
    const score = Number(roundScore);
    if (!course || !roundDate || !Number.isFinite(score)) {
      setRoundError("Add course, date, and score before saving.");
      return;
    }

    setRoundError(null);
    setRoundSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/golf/rounds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          date: roundDate,
          course,
          score,
          courseRating: roundCourseRating ? Number(roundCourseRating) : undefined,
          slopeRating: roundSlopeRating ? Number(roundSlopeRating) : undefined,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { round: GolfRound };
      setGolfRounds((prev) =>
        [data.round, ...prev].sort((a, b) => b.date.localeCompare(a.date))
      );
      setRoundCourse("");
      setRoundDate(new Date().toISOString().slice(0, 10));
      setRoundScore("");
      setRoundCourseRating("");
      setRoundSlopeRating("");
      setLogRoundOpen(false);
    } catch (err) {
      setRoundError(err instanceof Error ? err.message : "Could not save your round.");
    } finally {
      setRoundSaving(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone">
      <ClubhouseNav />

      {/* First-visit password / magic-link gate (BLOCKING) */}
      {showPasswordGate && (
        <SetPasswordOrMagicLinkGate
          email={user?.email || ""}
          onSatisfied={handleGateSatisfied}
        />
      )}

      {/* First-visit welcome surfaces by tier (only after gate cleared) */}
      {showWelcome && tier === "member" && <FirstBoxWelcomeDrawer />}

      <main className="pt-48 pb-32 md:pb-24">
        {showWelcome && tier === "access" && <AccessWelcomeBanner />}
        {showWelcome && tier === "free" && <ProfileNudge />}

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
              {weather && weatherError === "none" ? (
                <div className="bg-gradient-to-br from-forest via-forest-light to-sage/70 p-6 md:p-8 text-bone">
                  <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                    {/* Left: Weather info */}
                    <div className="flex-1">
                      <p className="text-xs tracking-[0.3em] uppercase text-bone/50 font-medium mb-3">
                        {weather.dataSource === "live" ? "Live weather" : "Demo weather"} — Today
                      </p>
                      <div className="flex items-center gap-4 mb-4">
                        <span className="text-5xl">{getWeatherEmoji(weather.condition)}</span>
                        <div>
                          <p className="font-serif text-4xl md:text-5xl font-bold">{weather.temp}°F</p>
                          <p className="text-sm text-bone/60">{weather.condition} · Feels like {weather.feelsLike}°F</p>
                          <p className="mt-1 text-xs text-bone/50">
                            {weather.locationName}
                            {weather.locationCountry ? `, ${weather.locationCountry}` : ""}
                            {weather.locationSource === "query"
                              ? " · browser location"
                              : weather.locationSource === "vercel-ip"
                                ? " · approximate IP location"
                                : " · default location"}
                          </p>
                          <p className="text-xs text-bone/40">
                            {weather.requestedLat.toFixed(2)}, {weather.requestedLon.toFixed(2)}
                          </p>
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
                      {weather.uvIndex !== null && weather.uvIndex > 5 && (
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
                      <p className="mt-2 max-w-[13rem] text-center text-xs text-bone/60">
                        {weather.golfSummary}
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
                    Live weather is temporarily unavailable. Try again in a moment.
                  </p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-3 text-xs text-bone/90 border border-bone/30 rounded-full px-4 py-1.5 hover:bg-bone/10 transition-colors btn-press cursor-pointer"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </ScrollReveal>
        </section>
        

        {/* ═══════════════════════════════════════════
           4. THE DROP ZONE — Featured drop + countdown
           ═══════════════════════════════════════════ */}
        <section className="px-6 md:px-12 max-w-6xl mx-auto mb-10">
          <ScrollReveal delay={0.1}>
            <div className="relative overflow-hidden rounded-2xl topo-pattern-dark p-6 md:p-8">
              {/* Grain overlay */}
              <div className="absolute inset-0 hero-grain opacity-30 pointer-events-none" />
              <div className="relative z-10">
                <div className="flex flex-col md:flex-row md:items-center gap-6 md:gap-8">
                  {/* Featured product image */}
                  <Link
                    href={`/shop/${FEATURED_DROP.productHandle}?from=home`}
                    className="relative w-full md:w-48 lg:w-56 flex-shrink-0 aspect-square rounded-xl overflow-hidden bg-bone/5 group"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={FEATURED_DROP.image}
                      alt={FEATURED_DROP.productName}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
                    />
                    <span className="absolute top-2 left-2 px-2 py-1 rounded-full bg-bone/90 text-forest text-[10px] font-bold tracking-[0.2em] uppercase">
                      {FEATURED_DROP.number}
                    </span>
                  </Link>

                  {/* Drop copy */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] tracking-[0.35em] uppercase text-sage font-medium mb-2">
                      {dropActive ? "Next Exclusive Drop" : "The Drop Is Live"}
                    </p>
                    <h2 className="font-serif text-2xl md:text-3xl text-bone mb-1 leading-tight">
                      {FEATURED_DROP.headline}
                    </h2>
                    <p className="text-sm text-bone/55 mb-4">{FEATURED_DROP.subhead}</p>
                    <div className="flex items-baseline gap-3 mb-4">
                      {isPaid ? (
                        <>
                          <span className="font-serif text-xl text-bone font-medium">${FEATURED_DROP.memberPrice}</span>
                          <span className="text-xs text-bone/40 line-through">${FEATURED_DROP.retailPrice}</span>
                          <span className="text-[10px] tracking-[0.2em] uppercase text-sage">Member Price</span>
                        </>
                      ) : (
                        <>
                          <span className="font-serif text-xl text-bone font-medium">${FEATURED_DROP.retailPrice}</span>
                          <span className="text-[10px] tracking-[0.2em] uppercase text-sage">
                            Members ${FEATURED_DROP.memberPrice}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Countdown / Live banner */}
                    {dropActive ? (
                      <div className="flex items-center gap-3 mb-5">
                        <p className="text-[10px] tracking-[0.3em] uppercase text-bone/40">Dropping In</p>
                        <p className="font-mono text-base md:text-lg text-bone font-bold tracking-wider">{countdown}</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 mb-5">
                        <span className="w-2.5 h-2.5 rounded-full bg-ember animate-pulse" />
                        <span className="font-serif text-base text-ember font-bold tracking-wide">LIVE NOW</span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3">
                      <Link
                        href={`/shop/${FEATURED_DROP.productHandle}?from=home`}
                        className="inline-flex items-center gap-2 px-5 py-2 rounded-full bg-bone text-forest text-xs font-medium tracking-wide hover:bg-cream transition-colors btn-press"
                      >
                        {dropActive ? "Preview Drop" : "Shop the Drop"}
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                        </svg>
                      </Link>
                      <Link
                        href="/dashboard?tab=drops"
                        className="text-xs text-bone/70 hover:text-bone tracking-wide transition-colors"
                      >
                        View Drops →
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>

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
                      <Link href={`/shop/${staffPick.slug}`} className="block">
                        <div className="aspect-square bg-bone-dark overflow-hidden product-img-wrap">
                          {staffPick.images[0] && (
                            <Image
                              src={staffPick.images[0]}
                              alt={staffPick.name}
                              width={720}
                              height={720}
                              sizes="(min-width: 768px) 18rem, 16rem"
                              className="w-full h-full object-cover product-img-primary"
                            />
                          )}
                        </div>
                        <div className="p-4 pb-0">
                          <p className="text-[10px] tracking-[0.2em] uppercase text-sage font-medium">{staffPick.brand}</p>
                          <p className="text-sm font-medium text-obsidian mt-0.5 line-clamp-1">{staffPick.name}</p>
                          <p className="text-xs text-charcoal/50 mt-1 italic line-clamp-2">
                            &ldquo;Our team is living in this right now.&rdquo;
                          </p>
                        </div>
                      </Link>
                      <div className="px-4 pb-4 pt-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isPaid && staffPick.price > staffPick.reservePrice && (
                              <span className="text-xs text-charcoal/40 line-through">${staffPick.price}</span>
                            )}
                            <span className="text-sm font-semibold text-forest">
                              ${isPaid ? staffPick.reservePrice : staffPick.price}
                            </span>
                          </div>
                          <QuickAddToCartButton
                            product={staffPick}
                            isPaid={isPaid}
                            onAddToCart={addToCart}
                            idleClassName="w-8 h-8 rounded-full bg-forest text-bone flex items-center justify-center hover:bg-forest-dark transition-colors btn-press cursor-pointer"
                            addedClassName="w-8 h-8 rounded-full bg-sage text-bone flex items-center justify-center transition-colors btn-press cursor-pointer"
                            idleContent={
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                              </svg>
                            }
                            addedContent={
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Curated products */}
                {curatedProducts.map((product) => (
                  <div key={product.slug} className="flex-shrink-0 w-56 md:w-64 snap-start">
                    <div className="rounded-2xl overflow-hidden bg-cream group product-tile-hover border border-taupe/15">
                      <Link href={`/shop/${product.slug}`} className="block">
                        <div className="aspect-square bg-bone-dark overflow-hidden product-img-wrap">
                          {product.images[0] && (
                            <Image
                              src={product.images[0]}
                              alt={product.name}
                              width={720}
                              height={720}
                              sizes="(min-width: 768px) 16rem, 14rem"
                              className="w-full h-full object-cover product-img-primary"
                            />
                          )}
                          {product.images[1] && (
                            <Image
                              src={product.images[1]}
                              alt=""
                              width={720}
                              height={720}
                              sizes="(min-width: 768px) 16rem, 14rem"
                              aria-hidden="true"
                              className="w-full h-full object-cover product-img-secondary"
                            />
                          )}
                        </div>
                        <div className="p-4 pb-0">
                          <p className="text-[10px] tracking-[0.2em] uppercase text-sage font-medium">{product.brand}</p>
                          <p className="text-sm font-medium text-obsidian mt-0.5 line-clamp-1">{product.name}</p>
                        </div>
                      </Link>
                      <div className="px-4 pb-4 pt-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {isPaid && product.price > product.reservePrice && (
                              <span className="text-xs text-charcoal/40 line-through">${product.price}</span>
                            )}
                            <span className="text-sm font-semibold text-forest">
                              ${isPaid ? product.reservePrice : product.price}
                            </span>
                          </div>
                          <QuickAddToCartButton
                            product={product}
                            isPaid={isPaid}
                            onAddToCart={addToCart}
                            idleClassName="w-8 h-8 rounded-full bg-forest text-bone flex items-center justify-center hover:bg-forest-dark transition-colors btn-press cursor-pointer"
                            addedClassName="w-8 h-8 rounded-full bg-sage text-bone flex items-center justify-center transition-colors btn-press cursor-pointer"
                            idleContent={
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                              </svg>
                            }
                            addedContent={
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            }
                          />
                        </div>
                      </div>
                    </div>
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
                  {/* Handicap — WHS calculated */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {roundsLoading
                        ? "..."
                        : calculatedHandicap !== null
                          ? calculatedHandicap.toFixed(1)
                          : onboardingProfile?.handicap || "—"}
                    </p>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 mt-1">
                      Handicap{calculatedHandicap !== null ? " (approx.)" : ""}
                    </p>
                  </div>

                  {/* Rounds This Month */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {roundsLoading
                        ? "…"
                        : golfRounds.filter((r) => {
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
                      {roundsLoading ? "…" : golfRounds.length > 0 ? Math.min(...golfRounds.map((r) => r.score)) : "—"}
                    </p>
                    <p className="text-[10px] tracking-[0.2em] uppercase text-bone/40 mt-1">Best Score</p>
                  </div>

                  {/* Total Rounds */}
                  <div className="bg-white/8 rounded-xl p-4 text-center">
                    <p className="font-serif text-4xl md:text-5xl font-bold text-bone">
                      {roundsLoading ? "…" : golfRounds.length || "0"}
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

                <div className="mt-5 flex items-center gap-3">
                  <button
                    className="text-xs text-bone/70 border border-bone/20 rounded-full px-5 py-2 hover:bg-bone/10 transition-colors btn-press cursor-pointer"
                    onClick={() => {
                      setRoundError(null);
                      setLogRoundOpen(true);
                    }}
                  >
                    + Log a Round
                  </button>
                  {golfRounds.length > 0 && (
                    <button
                      className="text-xs text-bone/70 border border-bone/20 rounded-full px-5 py-2 hover:bg-bone/10 transition-colors btn-press cursor-pointer"
                      onClick={() => setRoundsHistoryOpen(true)}
                    >
                      View Rounds
                    </button>
                  )}
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

      {/* ─── FOOTER ─── */}
      <footer className="py-16 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto">
          {/* Top — Logo + Nav columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10 mb-14">
            {/* Logo */}
            <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
              <span className="flex items-center gap-2 text-bone mb-3">
                <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
                <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
              </span>
              <p className="text-sm text-bone/50 leading-relaxed max-w-xs">
                Members-only access to the best golf has to offer.
              </p>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Company
              </h4>
              <ul className="space-y-2.5">
                <li><a href="/outings" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Outings &amp; Groups</a></li>
                <li><Link href="/blog" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Blog</Link></li>
                <li><a href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">FAQ</a></li>
              </ul>
            </div>

            {/* Partners */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Partners
              </h4>
              <ul className="space-y-2.5">
                <li><a href="/affiliates" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Affiliates</a></li>
                <li><a href="/influencers" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Influencers</a></li>
              </ul>
            </div>

            {/* Policies */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Policies
              </h4>
              <ul className="space-y-2.5">
                <li><a href="/policies/refund" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Refund Policy</a></li>
                <li><a href="/returns" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Returns</a></li>
                <li><a href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Privacy Policy</a></li>
                <li><a href="/policies/shipping" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Shipping Policy</a></li>
                <li><a href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Terms of Service</a></li>
              </ul>
            </div>
          </div>

          {/* Contact + Socials */}
          <div className="border-t border-bone/15 pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-sm text-bone/70 mb-1">
                Info@MyMully.com
              </p>
              <p className="text-xs text-bone/40">
                555 Friendly St., Pontiac, MI 48341
              </p>
            </div>

            {/* Social icons */}
            <div className="flex items-center gap-4">
              <a href="https://instagram.com/MullyReserve" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="Instagram">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              </a>
              <a href="https://tiktok.com/@Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="TikTok">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48V13a8.28 8.28 0 005.58 2.16V11.7a4.83 4.83 0 01-3.77-1.24V6.69h3.77z"/></svg>
              </a>
              <a href="https://facebook.com/Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="Facebook">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a href="https://x.com/MyMully" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="X">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://youtube.com/@Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="YouTube">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </a>
            </div>
          </div>

          {/* Copyright */}
          <div className="mt-8">
            <p className="text-xs text-bone/25">
              &copy; {new Date().getFullYear()} Mully Group, Inc. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>

      {logRoundOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-6">
          <div
            className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm"
            onClick={() => {
              if (!roundSaving) setLogRoundOpen(false);
            }}
          />
          <div className="relative w-full max-w-md rounded-2xl border border-taupe/20 bg-bone p-6 md:p-7 shadow-2xl animate-fade-up">
            <button
              onClick={() => {
                if (!roundSaving) setLogRoundOpen(false);
              }}
              className="absolute right-4 top-4 text-charcoal/35 hover:text-charcoal transition-colors"
              aria-label="Close log round form"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            <p className="text-[10px] tracking-[0.3em] uppercase text-sage font-medium mb-2">The Scorecard</p>
            <h3 className="font-serif text-2xl text-obsidian mb-5">Log a Round</h3>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] tracking-[0.18em] uppercase text-charcoal/45 mb-1.5">Course</label>
                <input
                  type="text"
                  value={roundCourse}
                  onChange={(e) => setRoundCourse(e.target.value)}
                  placeholder="e.g. Oakland Hills South"
                  className="w-full h-11 px-3 rounded-lg border border-taupe/25 bg-cream text-sm text-obsidian placeholder:text-charcoal/35 focus:outline-none focus:border-forest/40 transition-colors"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] tracking-[0.18em] uppercase text-charcoal/45 mb-1.5">Date</label>
                  <input
                    type="date"
                    value={roundDate}
                    onChange={(e) => setRoundDate(e.target.value)}
                    className="w-full h-11 px-3 rounded-lg border border-taupe/25 bg-cream text-sm text-obsidian focus:outline-none focus:border-forest/40 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] tracking-[0.18em] uppercase text-charcoal/45 mb-1.5">Score</label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={40}
                    max={200}
                    value={roundScore}
                    onChange={(e) => setRoundScore(e.target.value)}
                    placeholder="78"
                    className="w-full h-11 px-3 rounded-lg border border-taupe/25 bg-cream text-sm text-obsidian placeholder:text-charcoal/35 focus:outline-none focus:border-forest/40 transition-colors"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] tracking-[0.18em] uppercase text-charcoal/45 mb-1.5">Course Rating <span className="normal-case text-charcoal/30">(opt.)</span></label>
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    min={55}
                    max={85}
                    value={roundCourseRating}
                    onChange={(e) => setRoundCourseRating(e.target.value)}
                    placeholder="72.0"
                    className="w-full h-11 px-3 rounded-lg border border-taupe/25 bg-cream text-sm text-obsidian placeholder:text-charcoal/35 focus:outline-none focus:border-forest/40 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] tracking-[0.18em] uppercase text-charcoal/45 mb-1.5">Slope Rating <span className="normal-case text-charcoal/30">(opt.)</span></label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={55}
                    max={155}
                    value={roundSlopeRating}
                    onChange={(e) => setRoundSlopeRating(e.target.value)}
                    placeholder="113"
                    className="w-full h-11 px-3 rounded-lg border border-taupe/25 bg-cream text-sm text-obsidian placeholder:text-charcoal/35 focus:outline-none focus:border-forest/40 transition-colors"
                  />
                </div>
              </div>
              <p className="text-[10px] text-charcoal/35 mt-1">
                Course &amp; slope ratings are optional. Defaults: 72 / 113. Check your scorecard for exact values for a more accurate handicap.
              </p>
            </div>

            {roundError && <p className="mt-3 text-xs text-ember">{roundError}</p>}

            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                onClick={() => setLogRoundOpen(false)}
                disabled={roundSaving}
                className="h-10 px-4 rounded-lg border border-taupe/25 text-xs font-medium tracking-wide text-charcoal/55 hover:text-charcoal hover:border-taupe/40 transition-colors disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleLogRound()}
                disabled={roundSaving}
                className="h-10 px-5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wide uppercase hover:bg-forest-dark transition-colors disabled:opacity-60"
              >
                {roundSaving ? "Saving..." : "Save Round"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── ROUNDS HISTORY MODAL ─── */}
      {roundsHistoryOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center px-4">
          <div
            className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm"
            onClick={() => setRoundsHistoryOpen(false)}
          />
          <div className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl border border-taupe/20 bg-bone shadow-2xl animate-fade-up flex flex-col">
            <div className="p-6 pb-0 flex items-start justify-between">
              <div>
                <p className="text-[10px] tracking-[0.3em] uppercase text-sage font-medium mb-2">The Scorecard</p>
                <h3 className="font-serif text-2xl text-obsidian">Round History</h3>
              </div>
              <button
                onClick={() => setRoundsHistoryOpen(false)}
                className="text-charcoal/35 hover:text-charcoal transition-colors"
                aria-label="Close round history"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Summary stats */}
            <div className="px-6 pt-4 pb-3 grid grid-cols-3 gap-3">
              <div className="bg-cream rounded-lg p-3 text-center">
                <p className="font-serif text-2xl font-bold text-forest">
                  {calculatedHandicap !== null ? calculatedHandicap.toFixed(1) : "—"}
                </p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-charcoal/40 mt-0.5">Handicap (approx.)</p>
              </div>
              <div className="bg-cream rounded-lg p-3 text-center">
                <p className="font-serif text-2xl font-bold text-forest">
                  {golfRounds.length > 0 ? Math.min(...golfRounds.map((r) => r.score)) : "—"}
                </p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-charcoal/40 mt-0.5">Best Score</p>
              </div>
              <div className="bg-cream rounded-lg p-3 text-center">
                <p className="font-serif text-2xl font-bold text-forest">
                  {golfRounds.length > 0
                    ? Math.round(golfRounds.reduce((s, r) => s + r.score, 0) / golfRounds.length)
                    : "—"}
                </p>
                <p className="text-[10px] tracking-[0.15em] uppercase text-charcoal/40 mt-0.5">Avg Score</p>
              </div>
            </div>

            {/* Rounds table */}
            <div className="px-6 pb-6 overflow-y-auto flex-1">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-taupe/15">
                    <th
                      aria-sort={roundSort.key === "date" ? (roundSort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className="py-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRoundSort("date")}
                        className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-charcoal/40 font-medium hover:text-forest transition-colors"
                      >
                        Date
                        <span>{roundSort.key === "date" ? (roundSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th
                      aria-sort={roundSort.key === "course" ? (roundSort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className="py-2.5"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRoundSort("course")}
                        className="inline-flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase text-charcoal/40 font-medium hover:text-forest transition-colors"
                      >
                        Course
                        <span>{roundSort.key === "course" ? (roundSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th
                      aria-sort={roundSort.key === "score" ? (roundSort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className="py-2.5 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRoundSort("score")}
                        className="inline-flex items-center justify-center gap-1 text-[10px] tracking-[0.15em] uppercase text-charcoal/40 font-medium hover:text-forest transition-colors"
                      >
                        Score
                        <span>{roundSort.key === "score" ? (roundSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th
                      aria-sort={roundSort.key === "courseMetrics" ? (roundSort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className="py-2.5 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRoundSort("courseMetrics")}
                        className="inline-flex items-center justify-center gap-1 text-[10px] tracking-[0.15em] uppercase text-charcoal/40 font-medium hover:text-forest transition-colors"
                      >
                        CR / SR
                        <span>{roundSort.key === "courseMetrics" ? (roundSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                    <th
                      aria-sort={roundSort.key === "differential" ? (roundSort.direction === "asc" ? "ascending" : "descending") : "none"}
                      className="py-2.5 text-center"
                    >
                      <button
                        type="button"
                        onClick={() => toggleRoundSort("differential")}
                        className="inline-flex items-center justify-center gap-1 text-[10px] tracking-[0.15em] uppercase text-charcoal/40 font-medium hover:text-forest transition-colors"
                      >
                        Diff.
                        <span>{roundSort.key === "differential" ? (roundSort.direction === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRounds.map((round) => {
                      const cr = getRoundCourseRating(round);
                      const sr = getRoundSlopeRating(round);
                      const diff = getRoundDifferential(round);
                      return (
                        <tr key={round.id} className="border-b border-taupe/10 last:border-0">
                          <td className="py-2.5 text-charcoal/70 whitespace-nowrap">
                            {new Date(round.date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })}
                          </td>
                          <td className="py-2.5 text-obsidian font-medium truncate max-w-[10rem]">{round.course}</td>
                          <td className="py-2.5 text-center font-semibold text-obsidian">{round.score}</td>
                          <td className="py-2.5 text-center text-charcoal/50 text-xs">{cr} / {sr}</td>
                          <td className={`py-2.5 text-center font-medium ${diff <= 0 ? "text-green-600" : diff <= 10 ? "text-sage" : "text-ember"}`}>
                            {diff >= 0 ? "+" : ""}{diff.toFixed(1)}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
              {golfRounds.length === 0 && (
                <p className="text-center text-sm text-charcoal/40 py-8">No rounds recorded yet. Log your first round above.</p>
              )}
              <p className="mt-4 text-[10px] text-charcoal/35">
                Handicap calculated using the USGA World Handicap System formula. Score Differential = (113 / Slope) x (Score - Course Rating). Uses the best {golfRounds.length > 0 ? getWHSParams(golfRounds.length).use : 0} of {golfRounds.length} differential{golfRounds.length !== 1 ? "s" : ""}. Marked as approximate — for an official GHIN handicap, register with the USGA.
              </p>
            </div>
          </div>
        </div>
      )}

      <ClubhouseBottomNav />

      {/* ─── SLIDE CART ─── */}
      <SlideCart />

      {/* ─── UPGRADE MODAL ─── */}
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentTier={tier}
        onSelectPlan={() => {}}
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

  const normalizedSize = shirtSize?.trim().toLowerCase();
  const normalizedVibe = vibeCheck?.trim().toLowerCase();

  const vibeKeywords: Record<string, string[]> = {
    classic: ["polo", "traditional", "core", "staple"],
    modern: ["tech", "performance", "lightweight", "stretch"],
    street: ["oversized", "graphic", "drop", "layer"],
    bold: ["statement", "color", "limited", "premium"],
  };

  const scoreProduct = (product: ShopifyProduct) => {
    const searchText = [
      product.name,
      product.brand,
      product.collection,
      product.description,
      product.whyWeLikeIt,
      product.sizing,
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;

    if (normalizedSize && product.sizing.toLowerCase().includes(normalizedSize)) {
      score += 3;
    }

    if (normalizedVibe) {
      if (searchText.includes(normalizedVibe)) score += 4;
      for (const keyword of vibeKeywords[normalizedVibe] ?? []) {
        if (searchText.includes(keyword)) score += 1;
      }
    }

    return score;
  };

  return [...products]
    .sort((a, b) => {
      const diff = scoreProduct(b) - scoreProduct(a);
      if (diff !== 0) return diff;
      return a.slug.localeCompare(b.slug);
    })
    .slice(0, 4);
}

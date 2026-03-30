"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { ScrollReveal } from "../components/ClientComponents";
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal } from "../components/UpgradeModal";
import {
  useMembership,
  type FitProfile,
  type OnboardingProfile,
  type MemberTier,
  type ClubStatus,
} from "../context/MembershipContext";
import {
  getCollectionProducts,
  mergeCollectionProductsBySlug,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  PRO_SHOP_COLLECTION_HANDLE,
  type ShopifyProduct,
} from "@/lib/shopify";
import { formatExclusiveDropLabel, getExclusiveDropDate } from "@/lib/dropConfig";
import type { ForumPost } from "../community/posts";

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

interface GolfRound {
  id: string;
  date: string;
  course: string;
  score: number;
}

interface TeeWindowRecommendation {
  label: string;
  detail: string;
}

interface ScorecardSnapshot {
  recentAverage: string;
  trendLabel: string;
  trendTone: string;
  roundsThisMonth: number;
  totalRounds: number;
  bestScore: string;
  favoriteCourse: string;
  latestCourse: string;
  recentScores: number[];
}

interface PrimaryAction {
  kind: "link" | "upgrade" | "log";
  label: string;
  description: string;
  href?: string;
}

export default function HomeLabPage() {
  const router = useRouter();
  const {
    isSignedIn,
    authLoading,
    user,
    username,
    tier,
    tierLabel,
    storeCredit,
    subscriptions,
    onboardingProfile,
    fitProfile,
    clubStatus,
    interestedClubs,
    cartCount,
    setCartOpen,
    addToCart,
    refreshStoreCredit,
    refreshSubscriptionStatus,
  } = useMembership();

  const isPaid = tier === "access" || tier === "member" || tier === "black";

  useEffect(() => {
    if (!authLoading && !isSignedIn) {
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, router]);

  useEffect(() => {
    if (isSignedIn) {
      void refreshStoreCredit();
      void refreshSubscriptionStatus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(true);
  const [weatherError, setWeatherError] = useState<WeatherErrorState>("none");
  const [products, setProducts] = useState<ShopifyProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [golfRounds, setGolfRounds] = useState<GolfRound[]>([]);
  const [roundsLoading, setRoundsLoading] = useState(true);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [logRoundOpen, setLogRoundOpen] = useState(false);
  const [roundCourse, setRoundCourse] = useState("");
  const [roundDate, setRoundDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [roundScore, setRoundScore] = useState("");
  const [roundSaving, setRoundSaving] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [badgePop, setBadgePop] = useState(false);
  const prevCartCount = useRef(cartCount);

  useEffect(() => {
    const previousCount = prevCartCount.current;
    prevCartCount.current = cartCount;
    if (cartCount > previousCount) {
      setBadgePop(true);
      const timeout = setTimeout(() => setBadgePop(false), 400);
      return () => clearTimeout(timeout);
    }
  }, [cartCount]);

  useEffect(() => {
    let cancelled = false;

    async function fetchWeather(url: string) {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Weather API failed");
      const data = (await res.json()) as WeatherData;
      if (!cancelled) {
        setWeather(data);
        setWeatherError("none");
        setWeatherLoading(false);
      }
    }

    async function loadWeather() {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) reject(new Error("No geolocation"));
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
        });
        await fetchWeather(`/api/weather?lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`);
      } catch {
        try {
          await fetchWeather("/api/weather");
        } catch (error) {
          console.error("[home-lab weather] Unable to load weather data", error);
          if (!cancelled) {
            setWeatherError("service");
            setWeatherLoading(false);
          }
        }
      }
    }

    if (isSignedIn) {
      setWeatherLoading(true);
      void loadWeather();
    }

    return () => {
      cancelled = true;
    };
  }, [isSignedIn]);

  useEffect(() => {
    let cancelled = false;

    async function loadProducts() {
      try {
        const [proShop, privateReleases] = await Promise.all([
          getCollectionProducts(PRO_SHOP_COLLECTION_HANDLE),
          getCollectionProducts(PRIVATE_RELEASES_COLLECTION_HANDLE),
        ]);
        if (!cancelled) {
          setProducts(
            mergeCollectionProductsBySlug([
              { handle: PRO_SHOP_COLLECTION_HANDLE, products: proShop },
              { handle: PRIVATE_RELEASES_COLLECTION_HANDLE, products: privateReleases },
            ])
          );
          setProductsLoading(false);
        }
      } catch (error) {
        console.error("[home-lab products] Unable to load products", error);
        if (!cancelled) setProductsLoading(false);
      }
    }

    void loadProducts();
    return () => {
      cancelled = true;
    };
  }, []);

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
      } catch (error) {
        console.error("[home-lab rounds] Unable to load rounds", error);
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

  useEffect(() => {
    let cancelled = false;

    fetch("/api/community/posts")
      .then((res) => {
        if (!res.ok) throw new Error("Community posts API failed");
        return res.json();
      })
      .then((data: { posts?: ForumPost[] }) => {
        if (cancelled) return;
        setPosts(data.posts ?? []);
        setPostsLoading(false);
      })
      .catch((error) => {
        console.error("[home-lab posts] Unable to load posts", error);
        if (!cancelled) {
          setPosts([]);
          setPostsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const [countdown, setCountdown] = useState("");
  const [dropDate] = useState(() => getExclusiveDropDate());
  const dropActive = dropDate.getTime() > Date.now();

  useEffect(() => {
    if (!dropActive) return;
    const tick = () => {
      const diff = dropDate.getTime() - Date.now();
      if (diff <= 0) {
        setCountdown("LIVE NOW");
        return;
      }
      const days = Math.floor(diff / 86_400_000);
      const hours = Math.floor((diff % 86_400_000) / 3_600_000);
      const minutes = Math.floor((diff % 3_600_000) / 60_000);
      setCountdown(`${days}d ${String(hours).padStart(2, "0")}h ${String(minutes).padStart(2, "0")}m`);
    };
    tick();
    const interval = setInterval(tick, 60_000);
    return () => clearInterval(interval);
  }, [dropActive, dropDate]);

  const teeWindow = useMemo(() => getTeeWindow(weather), [weather]);
  const featuredClub = useMemo(() => getFeaturedClub(onboardingProfile, interestedClubs), [interestedClubs, onboardingProfile]);
  const scorecard = useMemo(() => buildScorecard(golfRounds), [golfRounds]);
  const curatedProducts = useMemo(() => getLabCuratedProducts(products, fitProfile, onboardingProfile, isPaid), [fitProfile, isPaid, onboardingProfile, products]);
  const featuredProduct = curatedProducts[0] ?? null;
  const secondaryProducts = curatedProducts.slice(1, 3);
  const radarPosts = useMemo(() => getRadarPosts(posts, onboardingProfile, isPaid), [isPaid, onboardingProfile, posts]);
  const guestPlayPost = radarPosts.find((post) => post.tag === "Guest Play") ?? radarPosts[0] ?? null;
  const fitCompletion = useMemo(() => getFitCompletion(fitProfile), [fitProfile]);
  const primaryAction = useMemo(() => getPrimaryAction(tier, dropActive, golfRounds, storeCredit), [dropActive, golfRounds, storeCredit, tier]);
  const featuredReasons = useMemo(() => getProductReasons(featuredProduct, fitProfile, onboardingProfile, isPaid), [featuredProduct, fitProfile, onboardingProfile, isPaid]);
  const lockerItems = useMemo(
    () => [
      {
        label: "Today's focus",
        value: primaryAction.label,
        detail: primaryAction.description,
      },
      {
        label: "Reserve window",
        value: dropActive ? countdown || "Updating..." : "Open",
        detail: dropActive ? formatExclusiveDropLabel(dropDate) : "No timed drop is blocking the shop right now.",
      },
      {
        label: "Locker balance",
        value: storeCredit && storeCredit.balance_cents > 0 ? formatMoney(storeCredit.balance_cents / 100) : tierLabel,
        detail: storeCredit && storeCredit.balance_cents > 0 ? "Available credit ready to spend." : "Membership state synced to your account.",
      },
      {
        label: "Home base",
        value: featuredClub.title,
        detail: featuredClub.detail,
      },
    ],
    [countdown, dropActive, dropDate, featuredClub, primaryAction, storeCredit, tierLabel]
  );

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
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }

      const data = (await res.json()) as { round: GolfRound };
      setGolfRounds((prev) => [data.round, ...prev].sort((a, b) => b.date.localeCompare(a.date)));
      setRoundCourse("");
      setRoundDate(new Date().toISOString().slice(0, 10));
      setRoundScore("");
      setLogRoundOpen(false);
    } catch (error) {
      setRoundError(error instanceof Error ? error.message : "Could not save your round.");
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
    <div className="min-h-screen bg-bone text-obsidian">
      <header className="fixed inset-x-0 top-0 z-50 border-b border-taupe/15 bg-bone/85 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 md:px-12 h-16 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/home-lab" className="flex items-center gap-2 text-forest">
              <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true">
                <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
              </svg>
              <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
            </Link>
            <div className="hidden md:flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-forest/8 text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                Clubhouse Lab
              </span>
              <Link href="/home" className="px-3 py-1 rounded-full border border-taupe/25 text-[11px] tracking-[0.2em] uppercase text-charcoal/60 hover:text-forest hover:border-forest/25 transition-colors">
                Classic Home
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button onClick={() => setCartOpen(true)} className="relative text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer" aria-label="Cart">
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

      <main className="pt-24 pb-24 md:pb-28">
        <section className="px-6 md:px-12 max-w-7xl mx-auto">
          <div className="relative overflow-hidden rounded-[2rem] bg-obsidian text-bone px-6 py-8 md:px-10 md:py-10">
            <div className="absolute inset-0 hero-grain opacity-25 pointer-events-none" />
            <div className="absolute inset-0 clubhouse-radar-bg opacity-60 pointer-events-none" />
            <div className="absolute -left-16 top-0 h-64 w-64 rounded-full bg-sage/15 blur-3xl pointer-events-none" />
            <div className="absolute -right-10 bottom-4 h-56 w-56 rounded-full bg-ember/10 blur-3xl pointer-events-none" />
            <div className="relative z-10 grid gap-8 xl:grid-cols-[1.08fr_0.92fr]">
              <div className="max-w-2xl">
                <div className="flex flex-wrap items-center gap-3 mb-5">
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/8 text-[11px] tracking-[0.28em] uppercase text-bone/75">
                    Experimental Clubhouse
                  </span>
                  <span className="text-[11px] tracking-[0.28em] uppercase text-bone/45">
                    {getFormattedDate()}
                  </span>
                </div>

                <h1 className="font-serif text-4xl md:text-5xl xl:text-[4.2rem] leading-[1.02] tracking-tight mb-5">
                  {getGreeting()}, {username || "Member"}.
                  <br />
                  <span className="text-sage">Your round, your locker, your club.</span>
                </h1>

                <p className="max-w-xl text-base md:text-lg leading-relaxed text-bone/65 mb-6">
                  A premium home built around what matters before you play:
                  useful weather, momentum in your game, fit-aware gear, and the
                  member activity worth your attention.
                </p>

                <div className="flex flex-wrap items-center gap-3 mb-7">
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium tracking-wide text-bone/85">
                    <span className={`w-2 h-2 rounded-full ${getTierDot(tier)}`} />
                    {tierLabel}
                  </span>
                  <span className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs font-medium tracking-wide text-bone/70">
                    {featuredClub.title}
                  </span>
                  {storeCredit && storeCredit.balance_cents > 0 && (
                    <span className="inline-flex items-center gap-2 rounded-full bg-ember/15 px-3 py-1.5 text-xs font-medium tracking-wide text-bone">
                      {formatMoney(storeCredit.balance_cents / 100)} in credit
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-7">
                  {primaryAction.kind === "link" ? (
                    <Link
                      href={primaryAction.href ?? "/dashboard"}
                      className="inline-flex items-center gap-2 rounded-full bg-bone px-5 py-3 text-sm font-medium text-forest hover:bg-cream transition-colors btn-press"
                    >
                      {primaryAction.label}
                      <ArrowRightIcon className="w-4 h-4" />
                    </Link>
                  ) : (
                    <button
                      onClick={() => {
                        if (primaryAction.kind === "upgrade") setUpgradeOpen(true);
                        if (primaryAction.kind === "log") {
                          setRoundError(null);
                          setLogRoundOpen(true);
                        }
                      }}
                      className="inline-flex items-center gap-2 rounded-full bg-bone px-5 py-3 text-sm font-medium text-forest hover:bg-cream transition-colors btn-press cursor-pointer"
                    >
                      {primaryAction.label}
                      <ArrowRightIcon className="w-4 h-4" />
                    </button>
                  )}
                  <Link
                    href="/home"
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-bone/75 hover:text-bone hover:border-white/25 transition-colors btn-press"
                  >
                    Compare with classic home
                  </Link>
                </div>

                <div className="flex flex-wrap gap-2">
                  {[
                    { label: "Tee Sheet", href: "#tee-sheet" },
                    { label: "Scorecard", href: "#scorecard" },
                    { label: "Locker Edit", href: "#picks" },
                    { label: "Radar", href: "#radar" },
                  ].map((item) => (
                    <a
                      key={item.label}
                      href={item.href}
                      className="rounded-full border border-white/10 px-4 py-2 text-xs tracking-[0.18em] uppercase text-bone/55 hover:text-bone hover:border-white/20 transition-colors"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              </div>

              <div id="tee-sheet">
                <div className="rounded-[1.75rem] border border-white/10 bg-white/6 p-5 md:p-6 backdrop-blur-xl">
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div>
                      <p className="text-[11px] tracking-[0.3em] uppercase text-bone/45 mb-2">Today&apos;s Tee Sheet</p>
                      <h2 className="font-serif text-2xl md:text-[2rem] leading-tight">
                        {weather?.locationName || "Course conditions"}
                      </h2>
                      <p className="text-sm text-bone/55 mt-1">
                        {weather?.locationCountry ? `${weather.locationCountry} / ` : ""}
                        {weatherLoading
                          ? "Loading local golf weather."
                          : weatherError === "service"
                            ? "Fallback mode for the course board."
                            : weather?.dataSource === "mock"
                              ? "Backup weather profile in use."
                              : "Live conditions tuned for golf."}
                      </p>
                    </div>
                    {weather && weatherError === "none" && (
                      <div className={`rounded-full border px-3 py-1.5 text-xs font-medium ${getGolfabilityPill(weather.golfScore)}`}>
                        Golfability {weather.golfScore}/10
                      </div>
                    )}
                  </div>

                  {weather && weatherError === "none" ? (
                    <div className="grid md:grid-cols-[0.95fr_1.05fr] gap-5 items-start">
                      <div className="rounded-[1.5rem] bg-obsidian/55 p-5 border border-white/6">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-5xl md:text-6xl font-serif leading-none">{weather.temp}F</p>
                            <p className="text-sm text-bone/60 mt-2">
                              {weather.condition} / Feels like {weather.feelsLike}F
                            </p>
                          </div>
                          <WeatherGlyph condition={weather.condition} className="w-14 h-14 text-bone/80" />
                        </div>
                        <div className="mt-5 grid grid-cols-2 gap-3">
                          <StatCell label="Wind" value={`${weather.windSpeed} mph`} />
                          <StatCell label="Humidity" value={`${weather.humidity}%`} />
                          <StatCell label="Sunrise" value={weather.sunrise} />
                          <StatCell label="Sunset" value={weather.sunset} />
                        </div>
                      </div>

                      <div className="rounded-[1.5rem] bg-white/7 p-5 border border-white/8">
                        <p className="text-[11px] tracking-[0.26em] uppercase text-bone/45 mb-2">Suggested tee window</p>
                        <h3 className="font-serif text-2xl leading-tight mb-2">{teeWindow.label}</h3>
                        <p className="text-sm text-bone/60 leading-relaxed mb-4">{teeWindow.detail}</p>
                        <div className="rounded-2xl border border-white/8 bg-obsidian/40 p-4">
                          <div className="flex items-center justify-between gap-3 mb-3">
                            <span className="text-xs tracking-[0.18em] uppercase text-bone/45">Caddie note</span>
                            {weather.uvIndex !== null && (
                              <span className="text-xs text-bone/55">UV {weather.uvIndex}</span>
                            )}
                          </div>
                          <p className="text-sm text-bone/72 leading-relaxed">{weather.golfSummary}</p>
                          <div className="mt-4 h-2 rounded-full bg-white/8 overflow-hidden">
                            <div
                              className={`h-full rounded-full wind-ribbon ${getGolfabilityBar(weather.golfScore)}`}
                              style={{ width: `${Math.max(weather.golfScore * 10, 14)}%` }}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : weatherLoading ? (
                    <div className="h-[17rem] rounded-[1.5rem] border border-white/8 bg-white/6 flex items-center justify-center">
                      <div className="flex items-center gap-3 text-bone/60">
                        <div className="w-4 h-4 border-2 border-bone/20 border-t-bone rounded-full animate-spin" />
                        <span className="text-sm">Pulling live course conditions...</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-[1.5rem] border border-white/8 bg-white/6 p-6">
                      <p className="text-sm text-bone/70 leading-relaxed">
                        Live weather is unavailable right now. The rest of the clubhouse still works,
                        but the tee sheet needs another try.
                      </p>
                      <button
                        onClick={() => window.location.reload()}
                        className="mt-4 inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.18em] text-bone hover:border-white/25 transition-colors btn-press cursor-pointer"
                      >
                        Retry tee sheet
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="px-6 md:px-12 max-w-7xl mx-auto mt-6">
          <ScrollReveal>
            <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
              {lockerItems.map((item) => (
                <div key={item.label} className="rounded-[1.4rem] border border-taupe/15 bg-cream px-5 py-5 shadow-[0_18px_40px_-32px_rgba(17,17,17,0.45)]">
                  <p className="text-[11px] tracking-[0.24em] uppercase text-sage font-medium mb-2">
                    {item.label}
                  </p>
                  <p className="font-serif text-2xl leading-tight text-obsidian">{item.value}</p>
                  <p className="mt-2 text-sm text-charcoal/55 leading-relaxed">{item.detail}</p>
                </div>
              ))}
            </div>
          </ScrollReveal>
        </section>

        <section id="scorecard" className="px-6 md:px-12 max-w-7xl mx-auto mt-10">
          <div className="grid lg:grid-cols-[1.12fr_0.88fr] gap-5">
            <ScrollReveal>
              <div className="relative overflow-hidden rounded-[1.85rem] border border-taupe/15 bg-cream p-6 md:p-8">
                <div className="absolute inset-0 scorecard-grid opacity-30 pointer-events-none" />
                <div className="relative z-10">
                  <SectionIntro
                    eyebrow="Your game"
                    title="The Scorecard, rebuilt for momentum"
                    body="Less vanity, more signal. Recent average, trend, and the course you keep returning to."
                  />

                  <div className="grid xl:grid-cols-[0.7fr_1.3fr] gap-6 items-start">
                    <div>
                      <p className="text-[11px] tracking-[0.22em] uppercase text-charcoal/40 mb-2">Recent average</p>
                      <p className="font-serif text-6xl leading-none text-forest mb-3">{scorecard.recentAverage}</p>
                      <p className={`text-sm font-medium ${scorecard.trendTone}`}>{scorecard.trendLabel}</p>
                      <p className="text-sm text-charcoal/55 mt-3 leading-relaxed">
                        {scorecard.latestCourse === "No rounds yet"
                          ? "Start logging rounds and this board will turn into a real season dashboard."
                          : `Your latest scorecard came from ${scorecard.latestCourse}.`}
                      </p>
                    </div>

                    <div className="rounded-[1.45rem] border border-taupe/12 bg-bone/70 p-4 md:p-5">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                          <p className="text-[11px] tracking-[0.22em] uppercase text-charcoal/35">Recent form</p>
                          <p className="text-sm text-charcoal/50">Last six rounds, newest on the right.</p>
                        </div>
                        <span className="rounded-full bg-forest/8 px-3 py-1 text-xs font-medium text-forest">
                          {roundsLoading ? "..." : `${scorecard.totalRounds} total`}
                        </span>
                      </div>
                      <Sparkline values={scorecard.recentScores} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 mt-6">
                    <MetricCell label="This month" value={String(scorecard.roundsThisMonth)} />
                    <MetricCell label="Best score" value={scorecard.bestScore} />
                    <MetricCell label="Home track" value={scorecard.favoriteCourse} />
                    <MetricCell label="Club status" value={getClubStatusLabel(clubStatus)} />
                  </div>

                  <div className="flex flex-wrap items-center gap-3 mt-6">
                    <button
                      onClick={() => {
                        setRoundError(null);
                        setLogRoundOpen(true);
                      }}
                      className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-3 text-sm font-medium text-bone hover:bg-forest-dark transition-colors btn-press cursor-pointer"
                    >
                      Log a round
                      <ArrowRightIcon className="w-4 h-4" />
                    </button>
                    <Link
                      href="/dashboard?tab=club"
                      className="inline-flex items-center gap-2 rounded-full border border-forest/12 px-5 py-3 text-sm font-medium text-forest hover:border-forest/25 transition-colors btn-press"
                    >
                      Open club tab
                    </Link>
                  </div>
                </div>
              </div>
            </ScrollReveal>

            <div className="space-y-5">
              <ScrollReveal delay={0.05}>
                <div className="rounded-[1.65rem] overflow-hidden border border-taupe/15 bg-obsidian text-bone">
                  <div className="px-5 py-5 border-b border-white/8">
                    <p className="text-[11px] tracking-[0.24em] uppercase text-sage font-medium mb-2">Guest play board</p>
                    <h3 className="font-serif text-2xl leading-tight">
                      {guestPlayPost ? guestPlayPost.title : "No guest-day chatter yet"}
                    </h3>
                  </div>
                  <div className="px-5 py-5">
                    <p className="text-sm text-bone/65 leading-relaxed mb-4">
                      {guestPlayPost
                        ? guestPlayPost.body
                        : "When the community starts organizing rounds, this card becomes your fastest route into the action."}
                    </p>
                    {guestPlayPost ? (
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-bone">{guestPlayPost.author}</p>
                          <p className="text-xs text-bone/45">
                            {guestPlayPost.comments.length} comments / {guestPlayPost.likes} likes
                          </p>
                        </div>
                        <Link
                          href={`/community/post/${guestPlayPost.id}`}
                          className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.18em] text-bone/75 hover:text-bone hover:border-white/25 transition-colors"
                        >
                          Open post
                        </Link>
                      </div>
                    ) : (
                      <Link
                        href="/dashboard?tab=community"
                        className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-xs uppercase tracking-[0.18em] text-bone/75 hover:text-bone hover:border-white/25 transition-colors"
                      >
                        Visit community
                      </Link>
                    )}
                  </div>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.1}>
                <div className="rounded-[1.65rem] border border-taupe/15 bg-cream p-5">
                  <p className="text-[11px] tracking-[0.24em] uppercase text-sage font-medium mb-2">Locker fit</p>
                  <h3 className="font-serif text-2xl leading-tight mb-3">Personalization you can actually feel</h3>
                  <p className="text-sm text-charcoal/55 leading-relaxed mb-4">
                    Your gear curation gets stronger as your fit and club profile fill in.
                  </p>

                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between gap-3 text-xs text-charcoal/45 mb-1.5">
                        <span>Profile completion</span>
                        <span>{fitCompletion.filled}/{fitCompletion.total}</span>
                      </div>
                      <div className="h-2 rounded-full bg-taupe/15 overflow-hidden">
                        <div className="h-full rounded-full bg-forest" style={{ width: `${fitCompletion.percent}%` }} />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <MetricCell label="Shirt" value={fitProfile.shirtSize || "Unset"} compact />
                      <MetricCell label="Shoe" value={fitProfile.shoeSize || "Unset"} compact />
                      <MetricCell label="Vibe" value={getVibeLabel(onboardingProfile.vibeCheck)} compact />
                      <MetricCell label="Club" value={featuredClub.shortValue} compact />
                    </div>
                  </div>

                  <Link href="/account" className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-forest hover:text-forest-dark transition-colors">
                    Update account profile
                    <ArrowRightIcon className="w-4 h-4" />
                  </Link>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        <section id="picks" className="px-6 md:px-12 max-w-7xl mx-auto mt-10">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
              <SectionIntro
                eyebrow="Locker edit"
                title="Make the shop feel like a caddie, not a catalog"
                body="Curated around your fit, your vibe, and where Reserve pricing actually changes the decision."
              />
              <Link href="/dashboard?tab=shop" className="inline-flex items-center gap-2 text-sm font-medium text-forest hover:text-forest-dark transition-colors">
                Open full shop
                <ArrowRightIcon className="w-4 h-4" />
              </Link>
            </div>

            {productsLoading ? (
              <div className="h-72 rounded-[1.75rem] border border-taupe/15 bg-cream flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
              </div>
            ) : featuredProduct ? (
              <div className="grid xl:grid-cols-[1.15fr_0.85fr] gap-5">
                <div className="overflow-hidden rounded-[1.85rem] bg-forest text-bone">
                  <div className="grid md:grid-cols-[0.9fr_1.1fr] h-full">
                    <div className="relative min-h-[21rem] bg-bone-dark/20">
                      {featuredProduct.images[0] ? (
                        <Image
                          src={featuredProduct.images[0]}
                          alt={featuredProduct.name}
                          fill
                          sizes="(min-width: 1280px) 28rem, (min-width: 768px) 50vw, 100vw"
                          className="object-cover"
                        />
                      ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-bone/50">
                          No image
                        </div>
                      )}
                    </div>

                    <div className="p-6 md:p-7 flex flex-col">
                      <div className="flex items-center justify-between gap-3 mb-4">
                        <div>
                          <p className="text-[11px] tracking-[0.26em] uppercase text-sage font-medium mb-2">Featured pick</p>
                          <p className="text-sm text-bone/55">{featuredProduct.brand}</p>
                        </div>
                        <span className="rounded-full bg-bone/10 px-3 py-1 text-xs font-medium text-bone/75">
                          Save {formatMoney(Math.max(featuredProduct.price - featuredProduct.reservePrice, 0))}
                        </span>
                      </div>

                      <h3 className="font-serif text-3xl leading-tight mb-3">{featuredProduct.name}</h3>
                      <p className="text-sm text-bone/65 leading-relaxed mb-5 line-clamp-4">
                        {featuredProduct.whyWeLikeIt || featuredProduct.description}
                      </p>

                      <div className="space-y-2 mb-6">
                        {featuredReasons.map((reason) => (
                          <div key={reason} className="flex items-center gap-2 text-sm text-bone/72">
                            <span className="w-1.5 h-1.5 rounded-full bg-sage shrink-0" />
                            <span>{reason}</span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-auto">
                        <div className="flex items-end gap-3 mb-4">
                          {isPaid && featuredProduct.price > featuredProduct.reservePrice && (
                            <span className="text-sm text-bone/35 line-through">
                              {formatMoney(featuredProduct.price)}
                            </span>
                          )}
                          <span className="font-serif text-3xl leading-none">
                            {formatMoney(isPaid ? featuredProduct.reservePrice : featuredProduct.price)}
                          </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-3">
                          <button
                            onClick={() =>
                              void addToCart({
                                slug: featuredProduct.slug,
                                name: featuredProduct.name,
                                brand: featuredProduct.brand,
                                price: isPaid ? featuredProduct.reservePrice : featuredProduct.price,
                                variantId: featuredProduct.variantId,
                                image: featuredProduct.images[0],
                              })
                            }
                            disabled={!featuredProduct.variantId}
                            className="inline-flex items-center gap-2 rounded-full bg-bone px-5 py-3 text-sm font-medium text-forest hover:bg-cream transition-colors btn-press cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Quick add
                            <ArrowRightIcon className="w-4 h-4" />
                          </button>
                          <Link href={`/shop/${featuredProduct.slug}`} className="inline-flex items-center gap-2 rounded-full border border-white/15 px-5 py-3 text-sm font-medium text-bone/80 hover:text-bone hover:border-white/25 transition-colors btn-press">
                            View detail
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-5">
                  {secondaryProducts.map((product) => (
                    <div key={product.slug} className="rounded-[1.6rem] border border-taupe/15 bg-cream p-4 md:p-5 flex gap-4">
                      <Link href={`/shop/${product.slug}`} className="block shrink-0 w-28 h-28 rounded-2xl overflow-hidden bg-bone-dark relative">
                        {product.images[0] ? (
                          <Image src={product.images[0]} alt={product.name} fill sizes="7rem" className="object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center text-charcoal/40 text-xs">
                            No image
                          </div>
                        )}
                      </Link>
                      <div className="min-w-0 flex-1 flex flex-col">
                        <p className="text-[11px] tracking-[0.22em] uppercase text-sage font-medium">{product.brand}</p>
                        <h3 className="font-serif text-2xl leading-tight mt-1">{product.name}</h3>
                        <p className="text-sm text-charcoal/50 mt-2 line-clamp-2">
                          {product.whyWeLikeIt || product.description}
                        </p>
                        <div className="mt-auto pt-4 flex items-center justify-between gap-3">
                          <div className="flex items-end gap-2">
                            {isPaid && product.price > product.reservePrice && (
                              <span className="text-xs text-charcoal/35 line-through">
                                {formatMoney(product.price)}
                              </span>
                            )}
                            <span className="text-lg font-semibold text-forest">
                              {formatMoney(isPaid ? product.reservePrice : product.price)}
                            </span>
                          </div>
                          <button
                            onClick={() =>
                              void addToCart({
                                slug: product.slug,
                                name: product.name,
                                brand: product.brand,
                                price: isPaid ? product.reservePrice : product.price,
                                variantId: product.variantId,
                                image: product.images[0],
                              })
                            }
                            disabled={!product.variantId}
                            className="w-10 h-10 rounded-full bg-forest text-bone flex items-center justify-center hover:bg-forest-dark transition-colors btn-press cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                            aria-label={`Add ${product.name} to cart`}
                          >
                            <PlusIcon className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  <div className="rounded-[1.6rem] border border-taupe/15 bg-cream p-5">
                    <p className="text-[11px] tracking-[0.22em] uppercase text-sage font-medium mb-2">Why this works</p>
                    <h3 className="font-serif text-2xl leading-tight mb-3">The shopper feels coached</h3>
                    <p className="text-sm text-charcoal/55 leading-relaxed mb-4">
                      This version explains why products belong here instead of hoping the user assumes it.
                    </p>
                    <div className="space-y-2 text-sm text-charcoal/55">
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-forest shrink-0" />
                        Fit profile completion: {fitCompletion.percent}%
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-forest shrink-0" />
                        Current style leaning: {getVibeLabel(onboardingProfile.vibeCheck)}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-forest shrink-0" />
                        Reserve access: {isPaid ? "Unlocked" : "Locked behind upgrade"}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[1.75rem] border border-taupe/15 bg-cream p-6">
                <p className="text-sm text-charcoal/55">No products are available right now.</p>
              </div>
            )}
          </ScrollReveal>
        </section>

        <section id="radar" className="px-6 md:px-12 max-w-7xl mx-auto mt-10">
          <ScrollReveal>
            <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 mb-5">
              <SectionIntro
                eyebrow="Club radar"
                title="Community deserves more than a list of likes"
                body="This version surfaces guest play, gear reviews, and posts with actual signal for a golfer deciding what to do next."
              />
              <Link href="/dashboard?tab=community" className="inline-flex items-center gap-2 text-sm font-medium text-forest hover:text-forest-dark transition-colors">
                Open full community
                <ArrowRightIcon className="w-4 h-4" />
              </Link>
            </div>

            {postsLoading ? (
              <div className="h-72 rounded-[1.75rem] border border-taupe/15 bg-cream flex items-center justify-center">
                <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
              </div>
            ) : radarPosts.length > 0 ? (
              <div className="grid lg:grid-cols-[1.25fr_0.9fr_0.9fr] gap-5">
                {radarPosts.slice(0, 3).map((post, index) => (
                  <Link key={post.id} href={`/community/post/${post.id}`} className={`group rounded-[1.75rem] overflow-hidden border border-taupe/15 transition-transform duration-300 hover:-translate-y-0.5 ${index === 0 ? "bg-obsidian text-bone" : "bg-cream text-obsidian"}`}>
                    {index === 0 && post.images?.[0] ? (
                      <div className="h-48 bg-cover bg-center" style={{ backgroundImage: `linear-gradient(rgba(17,17,17,0.18), rgba(17,17,17,0.42)), url(${post.images[0]})` }} />
                    ) : null}
                    <div className="p-5 md:p-6">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <span className={`rounded-full px-3 py-1 text-[11px] font-medium tracking-[0.18em] uppercase ${getPostTagClasses(post.tag, index === 0)}`}>
                          {post.tag}
                        </span>
                        <span className={`text-xs ${index === 0 ? "text-bone/45" : "text-charcoal/35"}`}>
                          {post.timestamp}
                        </span>
                      </div>
                      <h3 className={`font-serif text-2xl leading-tight mb-3 ${index === 0 ? "text-bone" : "text-obsidian"}`}>
                        {post.title}
                      </h3>
                      <p className={`text-sm leading-relaxed mb-5 line-clamp-4 ${index === 0 ? "text-bone/65" : "text-charcoal/55"}`}>
                        {post.body}
                      </p>
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className={`text-sm font-medium ${index === 0 ? "text-bone" : "text-obsidian"}`}>
                            {post.author}
                          </p>
                          <p className={`text-xs ${index === 0 ? "text-bone/45" : "text-charcoal/35"}`}>
                            {post.comments.length} comments / {post.likes} likes
                          </p>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${index === 0 ? "text-bone/80" : "text-forest"}`}>
                          Read
                          <ArrowRightIcon className="w-4 h-4" />
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-[1.75rem] border border-taupe/15 bg-cream p-6">
                <p className="text-sm text-charcoal/55">The community feed is quiet right now.</p>
              </div>
            )}
          </ScrollReveal>
        </section>

        <section className="px-6 md:px-12 max-w-7xl mx-auto mt-10">
          <ScrollReveal>
            {tier === "free" ? (
              <div className="rounded-[1.85rem] bg-obsidian text-bone px-6 py-7 md:px-8 md:py-8">
                <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-3">Unlock the full clubhouse</p>
                <div className="grid lg:grid-cols-[1fr_auto] gap-5 items-center">
                  <div>
                    <h2 className="font-serif text-3xl md:text-4xl leading-tight mb-3">
                      Reserve pricing, early drops, and the club-side experience should live in the same home.
                    </h2>
                    <p className="text-sm md:text-base text-bone/60 max-w-2xl leading-relaxed">
                      The experimental version is built to make premium access feel obvious, not hidden behind generic cards.
                    </p>
                  </div>
                  <button
                    onClick={() => setUpgradeOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-full bg-bone px-6 py-3 text-sm font-medium text-forest hover:bg-cream transition-colors btn-press cursor-pointer"
                  >
                    Explore plans
                    <ArrowRightIcon className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-[1.85rem] border border-taupe/15 bg-cream px-6 py-7 md:px-8 md:py-8">
                <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-3">Clubhouse desk</p>
                <div className="grid lg:grid-cols-[1fr_auto] gap-6 items-center">
                  <div>
                    <h2 className="font-serif text-3xl md:text-4xl leading-tight mb-3">
                      Keep the premium feel all the way through the member flow.
                    </h2>
                    <p className="text-sm md:text-base text-charcoal/55 max-w-2xl leading-relaxed">
                      From guest play to benefits to account management, the next step should feel intentional and close at hand.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <a
                      href="https://outings-self.vercel.app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 rounded-full bg-forest px-5 py-3 text-sm font-medium text-bone hover:bg-forest-dark transition-colors btn-press"
                    >
                      Outings & groups
                      <ArrowRightIcon className="w-4 h-4" />
                    </a>
                    <Link href={subscriptions?.manage_url ?? "/account"} className="inline-flex items-center gap-2 rounded-full border border-forest/12 px-5 py-3 text-sm font-medium text-forest hover:border-forest/25 transition-colors btn-press">
                      {subscriptions?.manage_url ? "Manage membership" : "Go to account"}
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </ScrollReveal>
        </section>

        <footer className="px-6 md:px-12 max-w-7xl mx-auto mt-12 pt-8 border-t border-taupe/15">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="flex items-center gap-2 text-forest mb-2">
                <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true">
                  <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
                </svg>
                <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
              </div>
              <p className="text-sm text-charcoal/50">
                Experimental home route for A/B testing. Classic experience remains untouched at <span className="font-medium text-forest">/home</span>.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-sm text-charcoal/55">
              <Link href="/home" className="hover:text-forest transition-colors">Classic home</Link>
              <Link href="/dashboard?tab=shop" className="hover:text-forest transition-colors">Shop</Link>
              <Link href="/dashboard?tab=community" className="hover:text-forest transition-colors">Community</Link>
              <Link href="/account" className="hover:text-forest transition-colors">Account</Link>
            </div>
          </div>
        </footer>
      </main>

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

      <SlideCart />

      <UpgradeModal open={upgradeOpen} onClose={() => setUpgradeOpen(false)} currentTier={tier} onSelectPlan={() => {}} />
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <div>
      <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-2">{eyebrow}</p>
      <h2 className="font-serif text-3xl md:text-[2.4rem] leading-tight text-obsidian mb-3">{title}</h2>
      <p className="text-sm md:text-base text-charcoal/55 leading-relaxed max-w-2xl">{body}</p>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/7 p-3">
      <p className="text-[10px] tracking-[0.18em] uppercase text-bone/45">{label}</p>
      <p className="text-sm font-medium text-bone mt-1">{value}</p>
    </div>
  );
}

function MetricCell({
  label,
  value,
  compact,
}: {
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className={`rounded-2xl border border-taupe/12 bg-bone/70 ${compact ? "p-3" : "p-4"}`}>
      <p className="text-[10px] tracking-[0.18em] uppercase text-charcoal/35">{label}</p>
      <p className={`font-serif leading-tight text-obsidian mt-1 ${compact ? "text-xl" : "text-2xl"}`}>
        {value}
      </p>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length === 0) {
    return (
      <div className="h-44 rounded-[1.25rem] border border-dashed border-taupe/20 bg-cream/80 flex items-center justify-center text-sm text-charcoal/40">
        No rounds yet
      </div>
    );
  }

  const width = 420;
  const height = 180;
  const padding = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const points = values.map((value, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(values.length - 1, 1);
    const y = padding + ((value - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-44">
        <defs>
          <linearGradient id="score-line" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1F3D2B" />
            <stop offset="100%" stopColor="#6E8B74" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width={width} height={height} rx="22" fill="#FAF9F6" />
        {[0.25, 0.5, 0.75].map((ratio) => (
          <line
            key={ratio}
            x1={padding}
            x2={width - padding}
            y1={padding + ratio * (height - padding * 2)}
            y2={padding + ratio * (height - padding * 2)}
            stroke="rgba(31,61,43,0.08)"
            strokeDasharray="4 8"
          />
        ))}
        <path d={path} fill="none" stroke="url(#score-line)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <circle key={`${point.x}-${point.y}`} cx={point.x} cy={point.y} r="5" fill="#F5F1E8" stroke="#1F3D2B" strokeWidth="2.5" />
        ))}
      </svg>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-charcoal/35">
        <span>Earlier</span>
        <span>Recent</span>
      </div>
    </div>
  );
}

function WeatherGlyph({ condition, className = "" }: { condition: string; className?: string }) {
  const value = condition.toLowerCase();

  if (value.includes("rain") || value.includes("drizzle")) {
    return (
      <svg viewBox="0 0 48 48" fill="none" className={className}>
        <path d="M16 22c0-5.523 4.477-10 10-10 4.53 0 8.357 3.013 9.588 7.143C40.292 20.058 44 23.624 44 28c0 5.523-4.477 10-10 10H18C11.373 38 6 32.627 6 26s5.373-12 12-12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M18 35l-2 5M26 35l-2 5M34 35l-2 5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }

  if (value.includes("storm") || value.includes("thunder")) {
    return (
      <svg viewBox="0 0 48 48" fill="none" className={className}>
        <path d="M16 22c0-5.523 4.477-10 10-10 4.53 0 8.357 3.013 9.588 7.143C40.292 20.058 44 23.624 44 28c0 5.523-4.477 10-10 10H18C11.373 38 6 32.627 6 26s5.373-12 12-12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M26 26l-5 9h5l-4 9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (value.includes("cloud")) {
    return (
      <svg viewBox="0 0 48 48" fill="none" className={className}>
        <path d="M16 24c0-5.523 4.477-10 10-10 4.53 0 8.357 3.013 9.588 7.143C40.292 22.058 44 25.624 44 30c0 5.523-4.477 10-10 10H18C11.373 40 6 34.627 6 28s5.373-12 12-12" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 48 48" fill="none" className={className}>
      <circle cx="24" cy="24" r="9" stroke="currentColor" strokeWidth="2.5" />
      <path d="M24 6v6M24 36v6M42 24h-6M12 24H6M36.728 11.272l-4.243 4.243M15.515 32.485l-4.243 4.243M36.728 36.728l-4.243-4.243M15.515 15.515l-4.243-4.243" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function ArrowRightIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
    </svg>
  );
}

function PlusIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}

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

function getTierDot(tier: MemberTier): string {
  if (tier === "black") return "bg-bone";
  if (tier === "member") return "bg-ember";
  if (tier === "access") return "bg-sage";
  return "bg-taupe";
}

function getGolfabilityPill(score: number): string {
  if (score >= 8) return "border-green-300/20 bg-green-300/10 text-green-200";
  if (score >= 6) return "border-sage/25 bg-sage/15 text-bone";
  if (score >= 4) return "border-amber-300/20 bg-amber-300/10 text-amber-200";
  return "border-rose-300/20 bg-rose-300/10 text-rose-200";
}

function getGolfabilityBar(score: number): string {
  if (score >= 8) return "bg-green-300";
  if (score >= 6) return "bg-sage";
  if (score >= 4) return "bg-amber-300";
  return "bg-rose-300";
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value % 1 === 0 ? 0 : 2,
  }).format(value);
}

function getClubStatusLabel(status: ClubStatus): string {
  if (status === "approved") return "Approved";
  if (status === "pending") return "Pending";
  return "Open";
}

function getPostTagClasses(tag: string, dark: boolean): string {
  if (tag === "Guest Play") {
    return dark ? "bg-sage/20 text-bone" : "bg-sage/15 text-forest";
  }
  if (tag === "Gear Talk") {
    return dark ? "bg-ember/20 text-bone" : "bg-ember/12 text-ember";
  }
  if (tag === "Events") {
    return dark ? "bg-bone/12 text-bone" : "bg-forest/8 text-forest";
  }
  return dark ? "bg-white/10 text-bone" : "bg-forest/8 text-forest";
}

function getTeeWindow(weather: WeatherData | null): TeeWindowRecommendation {
  if (!weather) {
    return { label: "Syncing your tee window", detail: "Checking local conditions before making the recommendation." };
  }

  if (weather.feelsLike >= 86) {
    return { label: "First light or golden hour", detail: "The heat is the story today. Go early or finish late." };
  }

  if (weather.feelsLike <= 52) {
    return { label: "Late morning start", detail: "A little patience should make the round more comfortable." };
  }

  if (weather.windSpeed >= 18) {
    return { label: "Go before the breeze builds", detail: "Club selection gets noisy once the wind owns the round." };
  }

  return { label: "Anytime before sunset", detail: "This is a friendly day for eighteen, a quick nine, or a range session." };
}

function getFeaturedClub(onboardingProfile: OnboardingProfile, interestedClubs: string[]) {
  if (onboardingProfile.privateClub && onboardingProfile.clubName) {
    return {
      title: onboardingProfile.clubName,
      shortValue: "Private club",
      detail: "Declared as your private-club home base during onboarding.",
    };
  }

  if (interestedClubs.length > 0) {
    return {
      title: interestedClubs[0],
      shortValue: `${interestedClubs.length} watched`,
      detail: interestedClubs.length > 1 ? `${interestedClubs.length} clubs are on your interest list.` : "One club is on your interest list.",
    };
  }

  return {
    title: "Build your home base",
    shortValue: "Unset",
    detail: "Add a club or interest list to make the clubhouse feel more local.",
  };
}

function buildScorecard(rounds: GolfRound[]): ScorecardSnapshot {
  const now = new Date();
  const roundsThisMonth = rounds.filter((round) => {
    const date = new Date(round.date);
    return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  }).length;
  const bestScore = rounds.length ? Math.min(...rounds.map((round) => round.score)) : null;
  const recentScores = rounds.slice(0, 6).reverse().map((round) => round.score);
  const recentFive = rounds.slice(0, 5).map((round) => round.score);
  const previousFive = rounds.slice(5, 10).map((round) => round.score);
  const recentAverage = recentFive.length > 0 ? average(recentFive) : null;
  const previousAverage = previousFive.length > 0 ? average(previousFive) : null;
  const delta = recentAverage !== null && previousAverage !== null ? recentAverage - previousAverage : null;

  let trendLabel = "Log a few rounds to unlock trend analysis.";
  let trendTone = "text-charcoal/45";

  if (delta !== null) {
    if (delta < 0) {
      trendLabel = `${Math.abs(delta).toFixed(1)} strokes better than the previous five rounds.`;
      trendTone = "text-forest";
    } else if (delta > 0) {
      trendLabel = `${delta.toFixed(1)} strokes off your previous five-round pace.`;
      trendTone = "text-ember";
    } else {
      trendLabel = "Flat versus your previous five-round sample.";
      trendTone = "text-charcoal/55";
    }
  } else if (recentAverage !== null) {
    trendLabel = "Keep logging rounds to turn this into a real form line.";
  }

  return {
    recentAverage: recentAverage !== null ? recentAverage.toFixed(1) : "-",
    trendLabel,
    trendTone,
    roundsThisMonth,
    totalRounds: rounds.length,
    bestScore: bestScore !== null ? String(bestScore) : "-",
    favoriteCourse: getFavoriteCourse(rounds),
    latestCourse: rounds[0]?.course ?? "No rounds yet",
    recentScores,
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function getFavoriteCourse(rounds: GolfRound[]): string {
  if (rounds.length === 0) return "Unset";

  const tally = new Map<string, number>();
  for (const round of rounds) {
    tally.set(round.course, (tally.get(round.course) ?? 0) + 1);
  }

  const top = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) return "Unset";
  const [course] = top;
  return course.length > 18 ? `${course.slice(0, 18)}...` : course;
}

function getPrimaryAction(
  tier: MemberTier,
  dropActive: boolean,
  golfRounds: GolfRound[],
  storeCredit: { balance_cents: number } | null
): PrimaryAction {
  if (tier === "free") {
    return { kind: "upgrade", label: "Unlock Reserve", description: "Reserve pricing, better shipping, and more club access." };
  }
  if (storeCredit && storeCredit.balance_cents > 0) {
    return { kind: "link", label: "Use your credit", description: "You have spending room waiting in the locker.", href: "/dashboard?tab=shop" };
  }
  if (dropActive) {
    return { kind: "link", label: "Open the next drop", description: "The next release deserves top billing right now.", href: "/dashboard?tab=drops" };
  }
  if (golfRounds.length === 0) {
    return { kind: "log", label: "Log your first round", description: "Give the scorecard real data to work with." };
  }
  return { kind: "link", label: "Review your edit", description: "Fit-aware shopping should feel coached, not random.", href: "/dashboard?tab=shop" };
}

function getLabCuratedProducts(
  products: ShopifyProduct[],
  fitProfile: FitProfile,
  onboardingProfile: OnboardingProfile,
  isPaid: boolean
) {
  if (products.length === 0) return [];
  const scoreProduct = (product: ShopifyProduct) => {
    const haystack = [product.name, product.brand, product.description, product.whyWeLikeIt, product.sizing, product.collection].join(" ").toLowerCase();
    let score = 0;
    if (fitProfile.shirtSize && haystack.includes(fitProfile.shirtSize.toLowerCase())) score += 3;
    for (const keyword of getVibeKeywords(onboardingProfile.vibeCheck)) {
      if (haystack.includes(keyword)) score += 2;
    }
    if (isPaid && product.sourceCollections?.includes(PRIVATE_RELEASES_COLLECTION_HANDLE)) score += 3;
    score += Math.max(product.price - product.reservePrice, 0) / 25;
    return score;
  };
  return [...products].sort((a, b) => scoreProduct(b) - scoreProduct(a)).slice(0, 3);
}

function getRadarPosts(posts: ForumPost[], onboardingProfile: OnboardingProfile, isPaid: boolean) {
  const tagWeight: Record<string, number> = {
    "Guest Play": isPaid ? 6 : 4,
    Events: isPaid ? 5 : 3,
    "Gear Talk": onboardingProfile.vibeCheck ? 5 : 4,
    General: 3,
  };
  return [...posts]
    .sort((a, b) => {
      const aWeight = (tagWeight[a.tag] ?? 2) + a.likes + a.comments.length * 1.5;
      const bWeight = (tagWeight[b.tag] ?? 2) + b.likes + b.comments.length * 1.5;
      return bWeight - aWeight;
    })
    .slice(0, 3);
}

function getFitCompletion(fitProfile: FitProfile) {
  const values = [fitProfile.shirtSize, fitProfile.gloveSize, fitProfile.waistSize, fitProfile.shoeSize];
  const filled = values.filter(Boolean).length;
  const total = values.length;
  return { filled, total, percent: Math.round((filled / total) * 100) };
}

function getProductReasons(
  product: ShopifyProduct | null,
  fitProfile: FitProfile,
  onboardingProfile: OnboardingProfile,
  isPaid: boolean
) {
  if (!product) return [];
  const reasons: string[] = [];
  if (fitProfile.shirtSize) reasons.push(`Uses your ${fitProfile.shirtSize} size profile where possible.`);
  if (onboardingProfile.vibeCheck) reasons.push(`Matched to your ${getVibeLabel(onboardingProfile.vibeCheck).toLowerCase()} preference.`);
  if (isPaid && product.price > product.reservePrice) reasons.push("Reserve pricing materially improves the value.");
  if (product.whyWeLikeIt) reasons.push(product.whyWeLikeIt);
  return reasons.slice(0, 3);
}

function getVibeKeywords(vibeCheck: string): string[] {
  switch (vibeCheck) {
    case "polite":
      return ["classic", "traditional", "core", "tailored", "polo"];
    case "turn-up":
      return ["statement", "graphic", "limited", "color", "drop"];
    case "move":
      return ["performance", "lightweight", "stretch", "travel", "tech"];
    case "depends":
      return ["premium", "modern", "elevated", "layer", "refined"];
    default:
      return ["premium", "performance", "core"];
  }
}

function getVibeLabel(vibeCheck: string): string {
  switch (vibeCheck) {
    case "polite":
      return "Traditionalist";
    case "turn-up":
      return "Social round";
    case "move":
      return "Fast mover";
    case "depends":
      return "Taste first";
    default:
      return "Not set";
  }
}

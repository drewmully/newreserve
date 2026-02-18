"use client";

import { useState } from "react";
import Link from "next/link";

/* ═══════════════════════════════════════════
   DASHBOARD — Shop · Benefits · Club · Community
   ═══════════════════════════════════════════ */

type Tab = "shop" | "benefits" | "club" | "community";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("shop");
  const [cartCount] = useState(0);

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── TOP BAR ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link
            href="/"
            className="font-serif text-2xl text-forest font-bold tracking-wide"
          >
            mully.
          </Link>
          <div className="flex items-center gap-5">
            {/* Cart */}
            <button className="relative text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer" aria-label="Cart">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              {cartCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ember text-white text-[10px] font-medium flex items-center justify-center">
                  {cartCount}
                </span>
              )}
            </button>
            {/* Account */}
            <button className="text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer" aria-label="Account">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* ─── TAB BAR ─── */}
      <nav className="fixed top-16 left-0 right-0 z-40 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {(
              [
                { key: "shop", label: "Shop" },
                { key: "benefits", label: "Benefits" },
                { key: "club", label: "Club" },
                { key: "community", label: "Community" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-5 py-3.5 text-sm tracking-wider uppercase font-medium transition-all duration-300 border-b-2 whitespace-nowrap cursor-pointer ${
                  activeTab === key
                    ? "border-forest text-forest"
                    : "border-transparent text-charcoal/40 hover:text-charcoal/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ─── TAB CONTENT ─── */}
      <main className="pt-32 pb-24">
        {activeTab === "shop" && <ShopTab />}
        {activeTab === "benefits" && <BenefitsTab />}
        {activeTab === "club" && <ClubTab />}
        {activeTab === "community" && <CommunityTab />}
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 md:px-12 bg-ember">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="font-serif text-xl text-white font-bold tracking-wide">
            mully.
          </span>
          <p className="text-xs text-white/40">
            &copy; {new Date().getFullYear()} Mully Group, Inc. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP TAB
   ═══════════════════════════════════════════ */

function ShopTab() {
  return (
    <div className="px-6 md:px-12">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-10">
          <p className="text-sm text-charcoal/50">
            Browse and shop at Reserve pricing.{" "}
            <Link href="/shop" className="text-forest underline underline-offset-2 hover:text-forest-dark transition-colors">
              Open full shop
            </Link>
          </p>
        </div>

        {/* Featured products grid (placeholder) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
          {FEATURED_PRODUCTS.map((p) => (
            <Link key={p.slug} href={`/shop/${p.slug}`} className="group">
              <div className="aspect-square bg-cream rounded-xl border border-taupe/15 flex items-center justify-center mb-3 overflow-hidden">
                <div className="w-12 h-12 text-taupe/30 group-hover:text-taupe/50 transition-colors duration-300">
                  <ProductIcon />
                </div>
              </div>
              <p className="text-xs text-sage tracking-wide uppercase">{p.brand}</p>
              <p className="text-sm text-obsidian font-medium mt-0.5 group-hover:text-forest transition-colors duration-300">{p.name}</p>
              <p className="text-sm text-forest font-medium mt-1">${p.price}</p>
            </Link>
          ))}
        </div>

        <div className="text-center mt-10">
          <Link
            href="/shop"
            className="inline-flex items-center gap-2 h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300"
          >
            View All Products
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

const FEATURED_PRODUCTS = [
  { slug: "titleist-tour-soft-ball", name: "Tour Soft Ball (Dozen)", brand: "Titleist", price: 36 },
  { slug: "travismathew-el-capitano-polo", name: "El Capitano Polo", brand: "TravisMathew", price: 72 },
  { slug: "peter-millar-crown-sport-polo", name: "Crown Sport Polo", brand: "Peter Millar", price: 89 },
  { slug: "gfore-mg4-shoe", name: "MG4+ Golf Shoe", brand: "G/FORE", price: 169 },
  { slug: "callaway-chrome-soft-ball", name: "Chrome Soft Ball (Dozen)", brand: "Callaway", price: 39 },
  { slug: "greyson-spirit-wolf-polo", name: "Spirit Wolf Polo", brand: "Greyson", price: 95 },
  { slug: "titleist-players-cap", name: "Players Performance Cap", brand: "Titleist", price: 24 },
  { slug: "travismathew-brekkie-short", name: "Brekkie Short", brand: "TravisMathew", price: 68 },
];

/* ═══════════════════════════════════════════
   BENEFITS TAB — SkyMiles-style perks
   ═══════════════════════════════════════════ */

function BenefitsTab() {
  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Status card */}
        <div className="bg-forest rounded-2xl p-8 md:p-10 mb-10 relative overflow-hidden">
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
            backgroundSize: "24px 24px",
          }} />
          <div className="relative">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
              <div>
                <p className="text-xs tracking-[0.3em] uppercase text-sage font-medium mb-2">Your Status</p>
                <h2 className="font-serif text-3xl text-bone mb-2">Reserve Member</h2>
                <p className="text-sm text-bone/50">Member since January 2026</p>
              </div>
              <div className="text-right">
                <p className="text-xs tracking-[0.3em] uppercase text-sage font-medium mb-2">Reserve Points</p>
                <p className="font-serif text-4xl text-bone">2,450</p>
                <p className="text-sm text-bone/40 mt-1">Points this quarter</p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="mt-8">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-bone/50">Progress to Reserve Black</span>
                <span className="text-xs text-sage">2,450 / 10,000</span>
              </div>
              <div className="h-1.5 bg-bone/10 rounded-full overflow-hidden">
                <div className="h-full bg-sage rounded-full" style={{ width: "24.5%" }} />
              </div>
            </div>
          </div>
        </div>

        {/* Benefit categories */}
        <div className="mb-8">
          <h3 className="font-serif text-2xl text-obsidian mb-6">Your Benefits</h3>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <BenefitTile
            icon={<PricingBenefitIcon />}
            title="Reserve Pricing"
            description="Members-only pricing on all products. Save an average of $250+ per year across gear, apparel, and accessories."
            status="Active"
          />
          <BenefitTile
            icon={<ShippingBenefitIcon />}
            title="Free 2-Day Shipping"
            description="Complimentary 2-day shipping on all Pro Shop orders. No minimums."
            status="Active"
          />
          <BenefitTile
            icon={<DropBenefitIcon />}
            title="Priority Drop Access"
            description="48-hour early access to limited releases before they go live to Access members."
            status="Active"
          />
          <BenefitTile
            icon={<FittingBenefitIcon />}
            title="Expert Fittings"
            description="Complimentary club fitting sessions with our partner network. Book through concierge."
            status="Active"
          />
          <BenefitTile
            icon={<ConciergeBenefitIcon />}
            title="Concierge Support"
            description="Dedicated concierge for booking, styling advice, and product recommendations."
            status="Active"
          />
          <BenefitTile
            icon={<EventBenefitIcon />}
            title="Invite-Only Events"
            description="Access to member-only outings, demo days, and partner experiences."
            status="Active"
          />
          <BenefitTile
            icon={<HandicapBenefitIcon />}
            title="Official USGA Handicap"
            description="Track your handicap officially through Mully Reserve. Post scores from any course."
            status="Coming Soon"
          />
          <BenefitTile
            icon={<PointsBenefitIcon />}
            title="Reserve Points"
            description="Earn points on every purchase. Redeem for store credit, experiences, and exclusive gear."
            status="Active"
          />
        </div>

        {/* Points earning table */}
        <div className="mt-12 bg-cream rounded-2xl border border-taupe/15 p-8">
          <h3 className="font-serif text-xl text-obsidian mb-6">How You Earn Points</h3>
          <div className="space-y-4">
            <PointsRow action="Every $1 spent in Pro Shop" points="1 pt" />
            <PointsRow action="Refer a friend who joins" points="500 pts" />
            <PointsRow action="Post a review" points="25 pts" />
            <PointsRow action="Attend an event" points="100 pts" />
            <PointsRow action="Complete a fitting" points="200 pts" />
            <PointsRow action="Quarterly membership renewal" points="250 pts" />
          </div>
          <div className="mt-6 pt-6 border-t border-taupe/15">
            <p className="text-xs text-charcoal/40">
              1,000 points = $10 store credit. Points never expire for active members.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CLUB TAB — Registry + Guest Play Browser
   ═══════════════════════════════════════════ */

const US_STATES = [
  "Alabama", "Arizona", "California", "Colorado", "Connecticut", "Florida",
  "Georgia", "Hawaii", "Illinois", "Indiana", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Nevada", "New Jersey", "New York",
  "North Carolina", "Ohio", "Oregon", "Pennsylvania", "South Carolina",
  "Tennessee", "Texas", "Virginia", "Washington",
];

const SAMPLE_CLUBS: ClubEntry[] = [
  { name: "Oakland Hills Country Club", city: "Bloomfield Hills", state: "Michigan", holes: 36, guestPolicy: "Member must accompany", addedBy: "J. Mitchell" },
  { name: "Barton Hills Country Club", city: "Ann Arbor", state: "Michigan", holes: 18, guestPolicy: "Member introduction required", addedBy: "D. Parker" },
  { name: "Detroit Golf Club", city: "Detroit", state: "Michigan", holes: 36, guestPolicy: "Guest pass available", addedBy: "R. Chen" },
  { name: "Country Club of Detroit", city: "Grosse Pointe Farms", state: "Michigan", holes: 18, guestPolicy: "Member must accompany", addedBy: "S. Williams" },
  { name: "Orchard Lake Country Club", city: "Orchard Lake", state: "Michigan", holes: 18, guestPolicy: "Limited guest days", addedBy: "T. Anderson" },
  { name: "Augusta National Golf Club", city: "Augusta", state: "Georgia", holes: 18, guestPolicy: "Member invitation only", addedBy: "M. Roberts" },
  { name: "Winged Foot Golf Club", city: "Mamaroneck", state: "New York", holes: 36, guestPolicy: "Member must accompany", addedBy: "K. Lewis" },
  { name: "Pebble Beach Golf Links", city: "Pebble Beach", state: "California", holes: 18, guestPolicy: "Public / resort guest", addedBy: "A. Kim" },
  { name: "Pinehurst Resort", city: "Pinehurst", state: "North Carolina", holes: 18, guestPolicy: "Resort guest access", addedBy: "B. Hall" },
  { name: "TPC Sawgrass", city: "Ponte Vedra Beach", state: "Florida", holes: 36, guestPolicy: "Resort guest access", addedBy: "C. Davis" },
];

interface ClubEntry {
  name: string;
  city: string;
  state: string;
  holes: number;
  guestPolicy: string;
  addedBy: string;
}

function ClubTab() {
  const [selectedState, setSelectedState] = useState("Michigan");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    clubName: "",
    city: "",
    state: "",
    holes: "18",
    guestPolicy: "",
  });

  const filteredClubs = SAMPLE_CLUBS.filter((c) => c.state === selectedState);

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Intro */}
        <div className="mb-10">
          <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-3">Private Club Registry</h2>
          <p className="text-base text-charcoal/55 leading-relaxed max-w-2xl">
            Reserve members can register their country club membership in the registry.
            Once listed, browse clubs by state that offer guest play to fellow members.
          </p>
        </div>

        {/* Add your club CTA */}
        <div className="bg-cream rounded-2xl border border-taupe/15 p-6 md:p-8 mb-10">
          {!showForm ? (
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <h3 className="font-serif text-lg text-obsidian mb-1">List Your Club</h3>
                <p className="text-sm text-charcoal/50">
                  Share your membership to connect with fellow Reserve members for guest play.
                </p>
              </div>
              <button
                onClick={() => setShowForm(true)}
                className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer whitespace-nowrap"
              >
                Add Your Club
              </button>
            </div>
          ) : (
            <div>
              <h3 className="font-serif text-lg text-obsidian mb-5">Register Your Club Membership</h3>
              <div className="grid md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">Club Name</label>
                  <input
                    type="text"
                    value={formData.clubName}
                    onChange={(e) => setFormData((p) => ({ ...p, clubName: e.target.value }))}
                    placeholder="e.g. Oakland Hills Country Club"
                    className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                </div>
                <div>
                  <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">City</label>
                  <input
                    type="text"
                    value={formData.city}
                    onChange={(e) => setFormData((p) => ({ ...p, city: e.target.value }))}
                    placeholder="e.g. Bloomfield Hills"
                    className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                </div>
                <div>
                  <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">State</label>
                  <select
                    value={formData.state}
                    onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
                    className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  >
                    <option value="">Select state</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">Holes</label>
                  <select
                    value={formData.holes}
                    onChange={(e) => setFormData((p) => ({ ...p, holes: e.target.value }))}
                    className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  >
                    <option value="9">9 holes</option>
                    <option value="18">18 holes</option>
                    <option value="27">27 holes</option>
                    <option value="36">36 holes</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">Guest Policy</label>
                  <input
                    type="text"
                    value={formData.guestPolicy}
                    onChange={(e) => setFormData((p) => ({ ...p, guestPolicy: e.target.value }))}
                    placeholder="e.g. Member must accompany guest"
                    className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer">
                  Submit
                </button>
                <button
                  onClick={() => setShowForm(false)}
                  className="h-11 px-6 rounded-xl text-sm text-charcoal/50 hover:text-charcoal/70 transition-colors duration-300 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* State browser */}
        <div>
          <h3 className="font-serif text-xl text-obsidian mb-5">Browse Clubs by State</h3>

          {/* State pills */}
          <div className="flex flex-wrap gap-2 mb-8">
            {US_STATES.map((state) => (
              <button
                key={state}
                onClick={() => setSelectedState(state)}
                className={`px-3.5 py-2 rounded-lg text-xs tracking-wide transition-all duration-300 cursor-pointer border ${
                  selectedState === state
                    ? "bg-forest text-bone border-forest"
                    : "bg-cream border-taupe/20 text-charcoal/50 hover:border-forest/30"
                }`}
              >
                {state}
              </button>
            ))}
          </div>

          {/* Club list */}
          {filteredClubs.length > 0 ? (
            <div className="space-y-3">
              {filteredClubs.map((club) => (
                <div
                  key={club.name}
                  className="bg-cream rounded-xl border border-taupe/15 p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <div>
                    <h4 className="text-sm font-medium text-obsidian">{club.name}</h4>
                    <p className="text-xs text-charcoal/45 mt-0.5">
                      {club.city}, {club.state} &middot; {club.holes} holes
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-sage bg-sage/10 px-3 py-1.5 rounded-lg">
                      {club.guestPolicy}
                    </span>
                    <span className="text-xs text-charcoal/30">
                      Listed by {club.addedBy}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-cream rounded-2xl border border-taupe/15">
              <p className="text-sm text-charcoal/40 mb-2">No clubs listed in {selectedState} yet.</p>
              <p className="text-xs text-charcoal/30">Be the first to register your club.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMMUNITY TAB — Forum
   ═══════════════════════════════════════════ */

interface ForumPost {
  id: string;
  author: string;
  avatar: string;
  timestamp: string;
  title: string;
  body: string;
  likes: number;
  comments: number;
  tag: string;
}

const SAMPLE_POSTS: ForumPost[] = [
  {
    id: "1",
    author: "Jack M.",
    avatar: "JM",
    timestamp: "2 hours ago",
    title: "Oakland Hills guest day — anyone in?",
    body: "Planning a guest day at Oakland Hills South Course next month. Reserve members welcome. Reach out if interested, trying to get a foursome together.",
    likes: 14,
    comments: 6,
    tag: "Guest Play",
  },
  {
    id: "2",
    author: "Sarah K.",
    avatar: "SK",
    timestamp: "5 hours ago",
    title: "Peter Millar Crown Sport — sizing question",
    body: "Just ordered the Crown Sport polo in medium. For reference I'm 5'8\" 165lbs and it fits perfectly. The fabric is incredible, way better than the standard line. Highly recommend at Reserve pricing.",
    likes: 23,
    comments: 8,
    tag: "Gear Talk",
  },
  {
    id: "3",
    author: "Mike R.",
    avatar: "MR",
    timestamp: "1 day ago",
    title: "Club Champion fitting review — worth every minute",
    body: "Just completed my fitting at Club Champion (Troy, MI location). The concierge booking through Mully made it seamless. Ended up getting fitted for a full iron set. The data they pull is unreal. If you haven't used this benefit yet, do it.",
    likes: 41,
    comments: 12,
    tag: "Fittings",
  },
  {
    id: "4",
    author: "Dave T.",
    avatar: "DT",
    timestamp: "2 days ago",
    title: "G/FORE MG4+ on-course review after 30 rounds",
    body: "I've put about 30 rounds on the MG4+ from the Reserve drop. They've held up incredibly well. The traction is still solid and they're the most comfortable golf shoe I've owned. Zero break-in period.",
    likes: 35,
    comments: 15,
    tag: "Gear Talk",
  },
  {
    id: "5",
    author: "Alex P.",
    avatar: "AP",
    timestamp: "3 days ago",
    title: "New member — what should I check out first?",
    body: "Just joined as a Reserve Member. What are the must-have benefits I should take advantage of right away? Already eyeing the Titleist Pro V1 at Reserve pricing.",
    likes: 18,
    comments: 22,
    tag: "General",
  },
];

const FORUM_TAGS = ["All", "General", "Gear Talk", "Fittings", "Guest Play", "Events"];

function CommunityTab() {
  const [activeTag, setActiveTag] = useState("All");
  const [showCompose, setShowCompose] = useState(false);

  const filtered = activeTag === "All"
    ? SAMPLE_POSTS
    : SAMPLE_POSTS.filter((p) => p.tag === activeTag);

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-3xl mx-auto">
        {/* Heading + compose */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">Community</h2>
            <p className="text-sm text-charcoal/50">
              Connect with fellow Reserve members. Share gear reviews, organize guest play, and more.
            </p>
          </div>
          <button
            onClick={() => setShowCompose(!showCompose)}
            className="h-10 px-5 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer whitespace-nowrap shrink-0 ml-4"
          >
            + Post
          </button>
        </div>

        {/* Compose */}
        {showCompose && (
          <div className="bg-cream rounded-2xl border border-taupe/15 p-6 mb-6">
            <input
              type="text"
              placeholder="Post title"
              className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 mb-3"
            />
            <textarea
              placeholder="Share something with the community..."
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 resize-none mb-3"
            />
            <div className="flex items-center justify-between">
              <select className="h-9 px-3 rounded-lg bg-bone border border-taupe/30 text-xs text-charcoal/60 focus:border-forest/40 transition-all duration-300">
                <option>General</option>
                <option>Gear Talk</option>
                <option>Fittings</option>
                <option>Guest Play</option>
                <option>Events</option>
              </select>
              <button className="h-10 px-6 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer">
                Publish
              </button>
            </div>
          </div>
        )}

        {/* Tags filter */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {FORUM_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={`px-4 py-2 rounded-lg text-xs tracking-wide transition-all duration-300 cursor-pointer border whitespace-nowrap ${
                activeTag === tag
                  ? "bg-forest text-bone border-forest"
                  : "bg-cream border-taupe/20 text-charcoal/50 hover:border-forest/30"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Posts */}
        <div className="space-y-4">
          {filtered.map((post) => (
            <article
              key={post.id}
              className="bg-cream rounded-xl border border-taupe/15 p-6 hover:border-taupe/30 transition-colors duration-300"
            >
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-forest/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-medium text-forest">{post.avatar}</span>
                </div>

                <div className="flex-1 min-w-0">
                  {/* Meta */}
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-medium text-obsidian">{post.author}</span>
                    <span className="text-xs text-charcoal/30">&middot;</span>
                    <span className="text-xs text-charcoal/35">{post.timestamp}</span>
                    <span className="text-xs text-sage bg-sage/10 px-2 py-0.5 rounded ml-auto">
                      {post.tag}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="text-base font-medium text-obsidian mb-2 leading-snug">
                    {post.title}
                  </h3>

                  {/* Body */}
                  <p className="text-sm text-charcoal/55 leading-relaxed mb-4">
                    {post.body}
                  </p>

                  {/* Actions */}
                  <div className="flex items-center gap-5">
                    <button className="flex items-center gap-1.5 text-xs text-charcoal/40 hover:text-forest transition-colors duration-300 cursor-pointer">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913v2.437c0 .532-.065 1.06-.218 1.551l-1.474 4.74a3.375 3.375 0 00.851 3.421l.426.388M6.633 10.5H4.869a2.376 2.376 0 00-2.344 2.752l.88 5.749A2.376 2.376 0 005.749 21h1.102M6.633 10.5v10.5" />
                      </svg>
                      <span>{post.likes}</span>
                    </button>
                    <button className="flex items-center gap-1.5 text-xs text-charcoal/40 hover:text-forest transition-colors duration-300 cursor-pointer">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                      </svg>
                      <span>{post.comments}</span>
                    </button>
                    <button className="flex items-center gap-1.5 text-xs text-charcoal/40 hover:text-forest transition-colors duration-300 cursor-pointer ml-auto">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                      </svg>
                      <span>Share</span>
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {/* SEO note */}
        <noscript>
          <div className="mt-8">
            <h3>Recent Community Posts</h3>
            {SAMPLE_POSTS.map((post) => (
              <div key={post.id}>
                <h4>{post.title}</h4>
                <p>By {post.author} &middot; {post.tag}</p>
                <p>{post.body}</p>
              </div>
            ))}
          </div>
        </noscript>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════ */

function BenefitTile({
  icon,
  title,
  description,
  status,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: "Active" | "Coming Soon";
}) {
  return (
    <div className="bg-cream rounded-xl border border-taupe/15 p-6 flex gap-4">
      <div className="w-10 h-10 rounded-xl bg-forest/8 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-sm font-medium text-obsidian">{title}</h4>
          <span
            className={`text-[10px] tracking-wider uppercase font-medium px-2 py-0.5 rounded-full ${
              status === "Active"
                ? "bg-forest/10 text-forest"
                : "bg-taupe/20 text-charcoal/40"
            }`}
          >
            {status}
          </span>
        </div>
        <p className="text-xs text-charcoal/50 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function PointsRow({ action, points }: { action: string; points: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-taupe/10 last:border-0">
      <span className="text-sm text-charcoal/65">{action}</span>
      <span className="text-sm font-medium text-forest">{points}</span>
    </div>
  );
}

function ProductIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
    </svg>
  );
}

/* ═══════════════════════════════════════════
   BENEFIT ICONS
   ═══════════════════════════════════════════ */

function PricingBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

function ShippingBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

function DropBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  );
}

function FittingBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75" />
    </svg>
  );
}

function ConciergeBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

function EventBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
    </svg>
  );
}

function HandicapBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

function PointsBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
    </svg>
  );
}

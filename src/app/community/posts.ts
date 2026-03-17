/* ═══════════════════════════════════════════
   COMMUNITY POST DATA
   Shared between public /community pages (SSR/SSG for SEO)
   and the dashboard community tab (client-side interactive).
   ═══════════════════════════════════════════ */

export interface ForumComment {
  id: string;
  authorId?: string;
  author: string;
  avatar: string;
  timestamp: string;
  body: string;
  likes: number;
}

export interface ForumPost {
  id: string;
  authorId?: string;
  author: string;
  avatar: string;
  timestamp: string;
  title: string;
  body: string;
  likes: number;
  comments: ForumComment[];
  tag: string;
  images?: string[];
}

export const FORUM_TAGS = ["All", "General", "Gear Talk", "Guest Play", "Events"];

export const posts: ForumPost[] = [
  {
    id: "1",
    author: "Jack M.",
    avatar: "JM",
    timestamp: "2 hours ago",
    title: "Oakland Hills guest day — anyone in?",
    body: "Planning a guest day at Oakland Hills South Course next month. Reserve members welcome. Reach out if interested, trying to get a foursome together.",
    likes: 14,
    tag: "Guest Play",
    comments: [
      { id: "1a", author: "Mike R.", avatar: "MR", timestamp: "1 hour ago", body: "I'm in. DM me the date and I'll block it off.", likes: 3 },
      { id: "1b", author: "Sarah K.", avatar: "SK", timestamp: "45 min ago", body: "Would love to join if there's room. South Course is incredible.", likes: 2 },
      { id: "1c", author: "Dave T.", avatar: "DT", timestamp: "30 min ago", body: "Count me in as well. Haven't played Oakland Hills since the renovation.", likes: 1 },
    ],
  },
  {
    id: "2",
    author: "Sarah K.",
    avatar: "SK",
    timestamp: "5 hours ago",
    title: "Peter Millar Crown Sport — sizing question",
    body: "Just ordered the Crown Sport polo in medium. For reference I'm 5'8\" 165lbs and it fits perfectly. The fabric is incredible, way better than the standard line. Highly recommend at Reserve pricing.",
    likes: 23,
    tag: "Gear Talk",
    images: ["https://placehold.co/600x400/1a3325/F5F1E8?text=Crown+Sport+Polo"],
    comments: [
      { id: "2a", author: "Alex P.", avatar: "AP", timestamp: "4 hours ago", body: "Good to know on the sizing. I'm similar build, been eyeing that one. How's the collar hold up?", likes: 4 },
      { id: "2b", author: "Sarah K.", avatar: "SK", timestamp: "3 hours ago", body: "Collar is structured but not stiff. Stays popped if that's your thing, lays flat cleanly too.", likes: 6 },
    ],
  },
  {
    id: "3",
    author: "Mike R.",
    avatar: "MR",
    timestamp: "1 day ago",
    title: "Titleist Hybrid 14 stand bag — 6 months in",
    body: "Just hit the six-month mark with the Hybrid 14 from the Reserve drop. This bag is the real deal. 14-way divider keeps everything organized, the straps are comfortable for 18, and it still looks brand new. Best bag I've owned.",
    likes: 41,
    tag: "Gear Talk",
    images: [
      "https://placehold.co/600x400/1a3325/F5F1E8?text=Hybrid+14+Bag",
      "https://placehold.co/600x400/1a3325/F5F1E8?text=Bag+Organization",
    ],
    comments: [
      { id: "3a", author: "Jack M.", avatar: "JM", timestamp: "22 hours ago", body: "How's the weight? I walk most rounds and my current bag feels like a brick by the back nine.", likes: 2 },
      { id: "3b", author: "Mike R.", avatar: "MR", timestamp: "20 hours ago", body: "It's noticeably lighter than my old Sun Mountain. The stand mechanism is solid too — never had it tip over.", likes: 5 },
      { id: "3c", author: "Dave T.", avatar: "DT", timestamp: "18 hours ago", body: "Picked one up at Reserve pricing last month. The pockets are surprisingly deep. Fits everything I need for 18.", likes: 8 },
      { id: "3d", author: "Alex P.", avatar: "AP", timestamp: "12 hours ago", body: "This post just sold me. Adding to cart now.", likes: 3 },
    ],
  },
  {
    id: "4",
    author: "Dave T.",
    avatar: "DT",
    timestamp: "2 days ago",
    title: "G/FORE MG4+ on-course review after 30 rounds",
    body: "I've put about 30 rounds on the MG4+ from the Reserve drop. They've held up incredibly well. The traction is still solid and they're the most comfortable golf shoe I've owned. Zero break-in period.",
    likes: 35,
    tag: "Gear Talk",
    images: ["https://placehold.co/600x400/1a3325/F5F1E8?text=MG4%2B+On+Course"],
    comments: [
      { id: "4a", author: "Sarah K.", avatar: "SK", timestamp: "2 days ago", body: "Been debating between these and the Gallivanter. You've convinced me on the MG4+.", likes: 4 },
      { id: "4b", author: "Jack M.", avatar: "JM", timestamp: "1 day ago", body: "How are they in wet conditions? That's my main concern with a knit upper.", likes: 2 },
      { id: "4c", author: "Dave T.", avatar: "DT", timestamp: "1 day ago", body: "Surprisingly good in the wet. Not fully waterproof but they dry fast and grip holds. I've played 3-4 dewy morning rounds with no issues.", likes: 7 },
    ],
  },
  {
    id: "5",
    author: "Alex P.",
    avatar: "AP",
    timestamp: "3 days ago",
    title: "New member — what should I check out first?",
    body: "Just joined as a Reserve Member. What are the must-have benefits I should take advantage of right away? Already eyeing the Titleist Pro V1 at Reserve pricing.",
    likes: 18,
    tag: "General",
    comments: [
      { id: "5a", author: "Mike R.", avatar: "MR", timestamp: "3 days ago", body: "Pro V1 at Reserve pricing is a no-brainer. And check the drops calendar — the limited releases go fast even with member access.", likes: 9 },
      { id: "5b", author: "Jack M.", avatar: "JM", timestamp: "3 days ago", body: "Welcome! Check the drops calendar first. The limited releases sell out fast even with member access.", likes: 5 },
      { id: "5c", author: "Sarah K.", avatar: "SK", timestamp: "2 days ago", body: "The Peter Millar and TravisMathew apparel at Reserve pricing is honestly the best value. Way better than any sale you'll find retail.", likes: 11 },
      { id: "5d", author: "Dave T.", avatar: "DT", timestamp: "2 days ago", body: "Free 2-day shipping alone pays for itself if you order regularly. And definitely join the community events — great way to meet people.", likes: 6 },
    ],
  },
];

export function getPostById(id: string): ForumPost | undefined {
  return posts.find((p) => p.id === id);
}

export function formatRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

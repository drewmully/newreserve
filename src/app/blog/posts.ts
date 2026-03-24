export type BlogCategory =
  | "Announcements"
  | "Drops"
  | "Guides"
  | "Community"
  | "Member Life"
  | "Partners";

export interface BlogSection {
  heading: string;
  paragraphs: string[];
}

export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  category: BlogCategory;
  date: string;
  readTime: string;
  image: string;
  imageAlt: string;
  featured?: boolean;
  intro: string;
  highlights: string[];
  sections: BlogSection[];
  closing: string;
}

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: "welcome-to-mully-reserve",
    title: "Welcome to Mully Reserve",
    excerpt:
      "We built Mully Reserve because the best of golf should not require a six-figure initiation. Here is what we are building and why.",
    category: "Announcements",
    date: "Feb 20, 2026",
    readTime: "4 min read",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_24_2026_03_08_18_PM.png?v=1771963720",
    imageAlt: "Mully Reserve membership card over a golf-inspired background.",
    featured: true,
    intro:
      "Mully Reserve started with a simple frustration: most golf communities are either too expensive, too transactional, or too disconnected from everyday golfers. We are building something in the middle, premium access with practical value.",
    highlights: [
      "Membership tiers designed for access before status.",
      "Partner pricing with brands golfers already trust.",
      "A digital clubhouse that includes community, benefits, and concierge support.",
    ],
    sections: [
      {
        heading: "Why We Built It",
        paragraphs: [
          "Traditional club models still work for some players, but they leave out a huge group of golfers who want quality without heavy initiation fees. We wanted to create a model where value is clear from day one.",
          "That means fewer vanity perks and more useful outcomes: better pricing, faster shipping, trusted recommendations, and a network that helps members play more often.",
        ],
      },
      {
        heading: "What Members Get Today",
        paragraphs: [
          "The core experience already includes reserve pricing, a members-only shop flow, and benefit tracking. Members can also access early drops and curated partner offers through a single dashboard.",
          "As we expand, we are prioritizing reliability first, then layering on richer personalization and concierge workflows.",
        ],
      },
      {
        heading: "What Is Next",
        paragraphs: [
          "Upcoming milestones include expanded content, stronger fit-profile personalization, and deeper partner integrations. The goal is to make each membership tier feel earned and coherent, not inflated.",
        ],
      },
    ],
    closing:
      "If you are here early, you are helping shape what a modern golf membership can actually look like.",
  },
  {
    slug: "spring-2026-drop-preview",
    title: "Spring 2026 Drop Preview",
    excerpt:
      "A first look at what is landing this quarter, from Greyson polos to Titleist Tour Soft by the dozen.",
    category: "Drops",
    date: "Feb 18, 2026",
    readTime: "3 min read",
    image: "/hero-golf-ball.png",
    imageAlt: "Golf ball and spring product teaser composition.",
    intro:
      "Spring is our most requested season for lightweight layers and versatile course essentials. This drop focuses on pieces that work from first tee to post-round without overcomplicating your bag.",
    highlights: [
      "Performance polos and layering staples built for temperature swings.",
      "Course-ready accessories with practical everyday use.",
      "Inventory pacing by tier to avoid one-minute sellouts.",
    ],
    sections: [
      {
        heading: "Product Direction",
        paragraphs: [
          "We prioritized breathable tops, weather-flexible mid-layers, and accessories that solve common pain points. Every item in this drop has a clear reason to exist, no filler SKUs.",
          "The mix is intentionally broad enough for different playing styles while still feeling curated.",
        ],
      },
      {
        heading: "Release Mechanics",
        paragraphs: [
          "Paid tiers continue to receive earlier access windows and stronger pricing. Free members still get visibility into the drop and can shop available inventory after the early window.",
          "This staggered approach protects member value while keeping the program discoverable.",
        ],
      },
      {
        heading: "How to Prepare",
        paragraphs: [
          "Make sure account sizing is current and payment details are ready before launch. For high-demand pieces, speed and sizing confidence make the biggest difference.",
        ],
      },
    ],
    closing:
      "The Spring 2026 drop is built for consistency, less guesswork, better rounds, and gear that actually gets used.",
  },
  {
    slug: "fit-profile-guide",
    title: "How Your Fit Profile Works",
    excerpt:
      "We use seven data points to make sure every item we send fits correctly. Here is the breakdown.",
    category: "Guides",
    date: "Feb 15, 2026",
    readTime: "2 min read",
    image: "/hero-tee-flag.png",
    imageAlt: "Golf apparel and fit planning visual.",
    intro:
      "A fit profile is only useful if it is actionable. Our approach turns a short set of member inputs into practical decisions for recommendations, merchandising, and member boxes.",
    highlights: [
      "Shirt, waist, inseam, shoe, glove, outerwear, and fit preference.",
      "Updates apply to future recommendations immediately.",
      "Profile data supports both commerce and curation workflows.",
    ],
    sections: [
      {
        heading: "The Seven Inputs",
        paragraphs: [
          "Instead of collecting every measurement possible, we focus on seven fields that predict most sizing outcomes in golf apparel. This keeps onboarding fast and still useful.",
          "When members update any value, those changes flow forward to future selections.",
        ],
      },
      {
        heading: "How Recommendations Use It",
        paragraphs: [
          "Recommendations prioritize products with higher confidence based on brand-specific fit behavior and your profile preferences. This improves conversion while reducing avoidable returns.",
        ],
      },
      {
        heading: "When You Should Update",
        paragraphs: [
          "Update your profile at season transitions, after major brand changes, or anytime your preferred silhouette changes. A one-minute refresh can save multiple mismatched orders.",
        ],
      },
    ],
    closing:
      "Good fit should feel invisible. The goal is simple: less friction, better confidence, and more usable gear.",
  },
  {
    slug: "top-5-courses-michigan",
    title: "Top 5 Public Courses in Michigan",
    excerpt:
      "From Arcadia Bluffs to Forest Dunes, our team picks for the best public rounds you can book now.",
    category: "Community",
    date: "Feb 12, 2026",
    readTime: "5 min read",
    image: "/hero-chalice.png",
    imageAlt: "Golf course landscape at golden hour.",
    intro:
      "Michigan has one of the strongest public golf lineups in the country. These five courses deliver different styles of challenge while staying realistic to book for planned trips.",
    highlights: [
      "Mix of destination layouts and local-favorite value rounds.",
      "Best windows for pace and conditions by region.",
      "Trip planning tips from the Mully community.",
    ],
    sections: [
      {
        heading: "What We Evaluated",
        paragraphs: [
          "Selection criteria included course architecture, conditioning consistency, booking practicality, and total experience value. We weighted replay value heavily, not just postcard aesthetics.",
        ],
      },
      {
        heading: "Course Notes",
        paragraphs: [
          "Arcadia Bluffs remains a benchmark for dramatic views and wind-exposed strategy. Forest Dunes continues to stand out for variety and destination-quality conditioning.",
          "The rest of the list balances pure golf quality with accessible booking windows for weekend players.",
        ],
      },
      {
        heading: "Planning Your Round",
        paragraphs: [
          "If you are traveling, build flexibility into tee time windows and monitor shoulder-season weather. Members in our community threads often share recent pace and condition updates that help with final planning.",
        ],
      },
    ],
    closing:
      "The best public rounds are the ones you can actually repeat, and Michigan gives you plenty of those.",
  },
  {
    slug: "member-box-unboxing-q1",
    title: "Q1 Member Box Unboxing",
    excerpt:
      "See what Reserve Members received this quarter and the logic behind each selected item.",
    category: "Member Life",
    date: "Feb 8, 2026",
    readTime: "3 min read",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Colorado_Hoodie.webp?v=1771960357",
    imageAlt: "Quarterly member box items laid out for unboxing.",
    intro:
      "Q1 focused on practical staples that members can use immediately in colder early-season conditions. Each box was assembled to balance apparel, utility, and brand discovery.",
    highlights: [
      "Core layering item selected from fit-profile confidence bands.",
      "Accessory mix tuned for early-season weather and travel.",
      "Partner spotlight insert with reorder path for favorites.",
    ],
    sections: [
      {
        heading: "How Curation Works",
        paragraphs: [
          "We start with fit profile data, then apply inventory and seasonality constraints to build a set that feels intentional per member segment. The goal is fewer novelty items and more weekly-use pieces.",
        ],
      },
      {
        heading: "What Was Inside Q1",
        paragraphs: [
          "Members saw a balanced mix of premium apparel, course utility add-ons, and small lifestyle inclusions. We kept the assortment compact so quality stayed high and shipping stayed reliable.",
        ],
      },
      {
        heading: "What We Learned",
        paragraphs: [
          "Feedback favored versatile neutrals and fit confidence over experiment-heavy assortments. That will guide how we tune Q2 packs by tier and playing frequency.",
        ],
      },
    ],
    closing:
      "Member boxes should feel like a smart recommendation engine in physical form, and Q1 moved us in that direction.",
  },
  {
    slug: "peter-millar-partnership",
    title: "Partner Spotlight: Peter Millar",
    excerpt:
      "Why we chose Peter Millar as a founding partner and what that unlocks for member pricing.",
    category: "Partners",
    date: "Feb 5, 2026",
    readTime: "3 min read",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_24_2026_02_24_48_PM.png?v=1771961106",
    imageAlt: "Premium golf apparel partner spotlight visual.",
    intro:
      "Partner quality directly defines member trust. Peter Millar was a clear fit because of product consistency, premium positioning, and strong overlap with what our members already wear.",
    highlights: [
      "Premium category coverage across on-course and off-course use.",
      "Reliable quality control and season-over-season consistency.",
      "Clear member value through structured reserve pricing.",
    ],
    sections: [
      {
        heading: "Why This Partner Matters",
        paragraphs: [
          "Partnerships only work when the brand standard aligns with member expectations. Peter Millar brings dependable construction and a product mix that fits a wide range of players.",
        ],
      },
      {
        heading: "How Pricing Value Shows Up",
        paragraphs: [
          "Members see the biggest value when premium products are consistently available at better-than-retail pricing. This partnership strengthens that promise with recognizable, repeatable demand items.",
        ],
      },
      {
        heading: "What Comes Next",
        paragraphs: [
          "We are expanding partner storytelling so members understand not just what is discounted, but why each partner earned a place in the program.",
        ],
      },
    ],
    closing:
      "Great partnerships are not just logos on a page, they are dependable value members can feel every season.",
  },
];

export const CATEGORY_COLORS: Record<BlogCategory, string> = {
  Announcements: "bg-forest/10 text-forest",
  Drops: "bg-sage/15 text-sage",
  Guides: "bg-ember/10 text-ember",
  Community: "bg-forest/10 text-forest",
  "Member Life": "bg-sage/15 text-sage",
  Partners: "bg-taupe/20 text-charcoal/65",
};

export const FEATURED_POST =
  BLOG_POSTS.find((post) => post.featured) ?? BLOG_POSTS[0];

export const BLOG_LIST_POSTS = BLOG_POSTS.filter((post) => !post.featured);

export function getBlogPostBySlug(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}

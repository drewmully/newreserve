export type EmailTemplate = (firstName: string | null) => {
  subject: string;
  text: string;
};

function hi(firstName: string | null, alt?: string): string {
  if (firstName) return `Hey ${firstName},`;
  return alt ?? "Hey there,";
}

// Email 1 — Welcome (immediate on signup)
export const free_1: EmailTemplate = (firstName) => ({
  subject: firstName ? `Welcome to Mully, ${firstName}` : "Welcome to Mully",
  text: `${hi(firstName)}

Drew here. I'm one of the founders at Mully. Wanted to personally welcome you.

We built Mully because we were tired of sifting through the noise to find gear that actually lives up to the hype. So we did the work, partnered directly with the best brands in golf, and curated a pro shop that only stocks what we'd actually put in our own bags.

You're in the community now, which means you can connect with other golfers, share reviews, and organize guest days at courses around the country.

Quick question for you. What got you interested in Mully? Always curious what brings people in.

Talk soon,

Drew

P.S. If you ever want the inside track on drops, member pricing, and some perks that'll make your golf buddies jealous, check out our Reserve tiers. No pressure, just wanted you to know it's there.`,
});

// Email 2 — Community Nudge (Day 3)
export const free_2: EmailTemplate = (firstName) => ({
  subject: "Have you checked this out yet?",
  text: `${hi(firstName)}

Wanted to make sure you saw our Community board. It's where the good stuff happens.

Right now there's a thread from a member organizing a guest day at Oakland Hills next month. Another member just dropped a detailed review on the Peter Millar Crown Sport polo (verdict: the fabric is unreal).

It's basically a clubhouse without the dress code.

Have you had a chance to poke around in there? If you post something, let me know. I'll make sure to check it out.

Drew`,
});

// Email 3 — The Shop Tease (Day 7)
export const free_3: EmailTemplate = (firstName) => ({
  subject: "What's in your bag right now?",
  text: `${hi(firstName)}

I'm always curious. What are you gaming right now? Driver, irons, putter... what's the setup?

Asking because we just restocked some stuff in the pro shop that I'm really excited about, and I'm wondering if any of it would be up your alley.

Right now, free members can browse everything. But our Reserve members get 15% off every item plus free 2-day shipping. For most guys, it pays for itself in one or two orders.

What's the one piece of gear you've been eyeing?

Drew`,
});

// Email 4 — Social Proof & Value (Day 14)
export const free_4: EmailTemplate = (firstName) => ({
  subject: "Something our members keep telling us",
  text: `${hi(firstName)}

Wanted to share something I keep hearing from our Reserve members.

The thing they mention most isn't the discounts or the shipping (though they love those). It's the access. Having a vetted network of golfers who can get you onto private courses, plus a concierge team that handles tee times, travel, and gifting.

One member told me he played three courses last quarter that he'd been trying to get on for years. All through connections he made in the Club network.

If you're the kind of golfer who wants more than just gear, who wants access to experiences, Reserve might be worth a look.

No hard sell, just think you'd get a lot out of it. Want me to walk you through what each tier includes?

Drew`,
});

// Email 5 — Last Touch / Feedback Ask (Day 21)
export const free_5: EmailTemplate = (firstName) => ({
  subject: firstName ? `Quick favor, ${firstName}?` : "Quick favor?",
  text: `${hi(firstName, "Hey friend,")}

Last thing from me for a while. Promise.

We're still early at Mully and I genuinely want to build something golfers actually love. So I'm asking everyone: what would make Mully a no-brainer for you?

Is it more brands in the shop? Different types of content? Better pricing? Something we haven't even thought of?

Seriously, hit reply and tell me. Every response gets read by me personally.

Thanks for being here.

Drew`,
});

export const FREE_TEMPLATES = [free_1, free_2, free_3, free_4, free_5];

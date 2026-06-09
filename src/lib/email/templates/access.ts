import type { EmailTemplate } from "./types";

function hi(firstName: string | null): string {
  return firstName ? `${firstName},` : "Hey there,";
}

// Email 1 — Welcome to Access (immediate on upgrade)
export const access_1: EmailTemplate = (firstName) => ({
  subject: firstName ? `You're in, ${firstName}` : "You're in",
  text: `${hi(firstName)}

Welcome to Reserve Access. You just made a great call.

Here's what's unlocked for you starting now:

* 15% off everything in the Pro Shop (auto-applied when you're signed in) — browse it here: https://mymully.com/dashboard?tab=shop

* Free 2-day shipping on every order, no minimums

* Access to our Drops, limited-edition collabs with premium brands (first one goes live May 15th)

* The Club network, where you connect with members at private courses across the country

* Your Benefits portal, including free V1+ virtual coaching (normally $60)

The V1+ coaching is something I'd check out first if I were you. You get matched with a PGA-certified instructor who does swing analysis and personalized drills over video. It's a legitimate tool.

One thing I'm curious about. What made you decide to join Access? Helps me understand what we're doing right.

Drew`,
});

// Email 2 — Club Network Intro (Day 3)
export const access_2: EmailTemplate = (firstName) => ({
  subject: "Ever played a course you shouldn't have?",
  text: `${hi(firstName)}

One of the most underrated parts of your Access membership is the Private Club Registry.

Here's how it works: if you're a member at a private club, you can apply to list it in our network. Once approved, you're connected with other verified members who host and play at each other's courses.

Think of it like a golf exchange program, except everyone involved is vetted and serious about the game.

Even if you're not at a private club, you can still browse the network and connect with members who are happy to host guests.

Are you a member anywhere? If so, I'd love to get your club in the network.

Drew`,
});

// Email 3 — First Drop Hype (Day 7)
export const access_3: EmailTemplate = (firstName) => ({
  subject: "Something's coming May 15th",
  text: `${hi(firstName)}

Heads up. Our very first Drop goes live Friday, May 15th at 9 PM EST.

I can't share details yet (that's the point), but I can tell you this: it's a collab with one of the most respected names in golf apparel, and stock is extremely limited.

As an Access member, you get early access and member pricing on Drops. We'll send a reminder before it goes live so you don't miss it.

What brands would you love to see us collab with? I'm always building the list.

Drew`,
});

// Email 4 — The Reserve Member Tease (Day 14)
export const access_4: EmailTemplate = (firstName) => ({
  subject: "The box that keeps selling out",
  text: `${hi(firstName)}

Quick question. Have you heard about our Curated Box?

It's something we do exclusively for Reserve Members ($249/quarter). Every quarter, we put together a box of premium golf gear tailored to your profile. Apparel, accessories, sometimes equipment. All from brands we hand-select.

Members tell me it's like getting a gift from someone who actually knows what you'd pick for yourself.

The value of what's inside always exceeds the price of the membership itself, so between that and the other perks, it's a pretty easy math problem.

If that sounds interesting, I can walk you through exactly how it works. Just reply to this and I'll give you the full rundown.

Drew`,
});

// Email 5 — Check-In & Feedback (Day 30)
export const access_5: EmailTemplate = (firstName) => ({
  subject: firstName ? `How's it going so far, ${firstName}?` : "How's it going so far?",
  text: `${hi(firstName)}

You've been on Access for about a month now. How's it going?

Have you had a chance to explore the Pro Shop? Used the V1+ coaching? Connected with anyone in the Club network?

If the shop slipped past you, this is where your 15% lives: https://mymully.com/dashboard?tab=shop

I ask because I want to make sure you're getting real value. If there's anything that feels confusing or anything you wish worked differently, I want to know.

We're building Mully for people like you, so your feedback shapes what we do next.

What's one thing you'd improve?

Drew`,
});

export const ACCESS_TEMPLATES = [access_1, access_2, access_3, access_4, access_5];

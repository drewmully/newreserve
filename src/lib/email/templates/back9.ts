import type { EmailTemplate } from "./free";

function hi(firstName: string | null, alt?: string): string {
  if (firstName) return `${firstName},`;
  return alt ?? "Hey there,";
}

// Email 1 — Welcome Back (immediate on first login)
export const back9_1: EmailTemplate = (firstName) => ({
  subject: firstName
    ? `You're still one of our originals, ${firstName}`
    : "You're still one of our originals",
  text: `${hi(firstName)}

Drew here. I noticed you just logged into the new platform, and I wanted to reach out personally.

You're a Back 9 member. That means you were with us before a lot of what you're seeing here even existed. That's not something we take lightly.

We've been building since you first signed up. New brands, new drops, new tools. The platform looks a little different now, so take a minute to look around.

One quick question: what did you use Mullybox for most back in the day? Gear upgrades, gifts, just treating yourself? I'm curious what brought you back.

Good to have you here.

Drew

P.S. We've got a lot more to show you. More on that soon.`,
});

// Email 2 — What's New on the Platform (Day 2)
export const back9_2: EmailTemplate = (firstName) => ({
  subject: firstName ? `A lot has changed, ${firstName}` : "A lot has changed",
  text: `${hi(firstName)}

Wanted to give you a quick lay of the land since the platform has changed quite a bit.

The core is still the same. Curated gear, brands you can trust, a community of golfers who actually know what they're talking about. But we've added a lot on top of that.

As a Back 9 member, here's what you currently have access to:

* The Pro Shop, with your member discount applied
* Community, including the Private Club Registry
* The Benefits portal

And here's what's new that you might not have seen yet: the Drops. We're doing limited-edition collabs with premium brands now. Stock is short, demand is high, and Access members get first crack at them.

What part of the platform do you want to dig into first?

Drew`,
});

// Email 3 — The Box Backstory (Day 5)
export const back9_3: EmailTemplate = (firstName) => ({
  subject: "How we build your box now",
  text: `${hi(firstName)}

The thing I'm most excited to tell you about is how much the box itself has changed.

When you were a Back 9 member, we were putting boxes together with good taste and solid product knowledge. That was it. What we're doing now is different.

Our Reserve Members get a box built by a combination of our curation team and a proprietary AI that's been trained on everything we know about golf gear, brand quality, player profiles, and what actually performs on the course. It learns from your feedback each quarter and gets more dialed in every time.

The result is a box that feels like it was picked by someone who knows your game. Not just your taste, your actual game.

One question: what's the one piece of gear that's been on your radar that you just haven't pulled the trigger on yet?

Drew`,
});

// Email 4 — The Value Case (Day 10)
export const back9_4: EmailTemplate = (firstName) => ({
  subject: firstName
    ? `The math on your membership, ${firstName}`
    : "The math on your membership",
  text: `${hi(firstName)}

I want to be straight with you about something.

As a Back 9 member, you're grandfathered in at $150/quarter. We're not taking that away. That was a promise and we're keeping it.

But I also want to make sure you know what's sitting just above that tier, because the gap between what you have and what Reserve Members get is bigger than it sounds.

At $250/quarter, Reserve Members receive:

* A quarterly curated box where the value of the contents consistently exceeds the cost of the membership
* Products personalized to their profile using our AI, which gets smarter every quarter
* Priority concierge support for tee times, travel, gifting, and gear sourcing
* First access on all limited drops

The way most members think about it: the box alone covers the membership. Everything else is gravy.

No pressure here. But I'd feel like I wasn't doing my job if I didn't at least put the comparison in front of you.

Want me to walk you through exactly what a Reserve Member box looks like for someone with your profile?

Drew`,
});

// Email 5 — Social Proof from the Community (Day 16)
export const back9_5: EmailTemplate = (firstName) => ({
  subject: "What members are saying about the box",
  text: `${hi(firstName)}

Every quarter after boxes ship, I read through what members post in the Community.

The thing that comes up most isn't the retail value, though members always mention it. It's that the box feels personal. Like someone actually knew what they wanted before they did.

One member told me he'd been on the fence about a specific waterproof jacket for two seasons and it showed up in his box. He said he would have bought it himself eventually, but getting it this way felt different. That's what we're going for.

The AI-driven personalization is what makes that possible. It's not a gimmick. It's what separates us from any other subscription box in golf.

If you want to see what other members are saying, the Community board has a whole thread on box reactions after every drop. Worth checking out.

And if you want that experience for yourself, you know where to find me.

Drew`,
});

// Email 6 — The Direct Ask (Day 22)
export const back9_6: EmailTemplate = (firstName) => ({
  subject: firstName ? `I'll just ask, ${firstName}` : "I'll just ask",
  text: `${hi(firstName, "Hey friend,")}

I'll keep this short.

You've been a Back 9 member since the early days. You know the product. You know the community. At this point, you probably have a pretty clear sense of whether upgrading to Reserve Member is something you want to do.

If the answer is yes, here's the link: https://mymully.com/dashboard?upgrade=1

If the answer is not yet, that's fine too. I just want to hear why. What's the thing that would push you over the edge? Price point? Wanting to see more? Something specific about the box?

Hit reply and tell me. I'm asking because I actually want to know.

Drew`,
});

export const BACK9_TEMPLATES: Array<(firstName: string | null) => { subject: string; text: string }> = [
  back9_1,
  back9_2,
  back9_3,
  back9_4,
  back9_5,
  back9_6,
];

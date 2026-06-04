import type { EmailTemplate } from "./types";

function hi(firstName: string | null, alt?: string): string {
  if (firstName) return `${firstName},`;
  return alt ?? "Hey there,";
}

// Email 1 — Welcome to Reserve (immediate on upgrade)
export const member_1: EmailTemplate = (firstName) => ({
  subject: firstName
    ? `Welcome to the inner circle, ${firstName}`
    : "Welcome to the inner circle",
  text: `${hi(firstName)}

You just joined the top tier at Mully. Thank you. Seriously.

Here's everything that's now yours:

* Everything in Access (15% off, free 2-day shipping, Drops, Club network, Benefits)

* Quarterly Curated Box, premium gear handpicked for your profile, shipped to your door

* Priority Concierge. Need tee times, travel help, gifting ideas, or product sourced? Our team handles it.

* First-priority access on all limited releases

Your first Curated Box ships within the first few weeks. To make sure we nail it, we'll be building your profile. The more we know about your preferences, the better the box gets each quarter.

Quick question to kick things off: what's your style on the course? Classic and clean, or do you like to stand out? Helps us dial in your box.

Drew`,
});

// Email 2 — Concierge Introduction (Day 2)
export const member_2: EmailTemplate = (firstName) => ({
  subject: "Your concierge is ready",
  text: `${hi(firstName)}

One of the perks I'm most proud of is your personal concierge.

Here's how it works: you submit a request through the Benefits page, and our team takes it from there. Some things members have asked for recently:

* Tee times at sold-out resort courses

* A birthday gift for a golf buddy (we sourced and shipped it)

* Travel recommendations for a guys' trip to Scottsdale

* Help finding a specific limited-edition putter

We can't promise miracles, but we've got some solid connections and we'll always give it our best shot.

Is there anything on your wish list right now? Try us.

Drew`,
});

// Email 3 — V1+ Coaching Reminder (Day 5)
export const member_3: EmailTemplate = (firstName) => ({
  subject: "Free coaching. Have you tried it?",
  text: `${hi(firstName)}

Just a quick nudge. Your membership includes free access to V1+ virtual coaching (normally $60).

You get paired with a PGA-certified instructor who can do swing analysis, create personalized drills, and give video feedback. It's not a gimmick. It's the same platform touring pros use.

You can activate it in your Benefits tab. Takes about two minutes to set up.

What part of your game are you working on right now? Driver? Short game? Putting? Just curious.

Drew`,
});

// Email 4 — Box Preview (14 days before box ships — event-triggered)
export const member_4: EmailTemplate = (firstName) => ({
  subject: "Your first box is almost ready",
  text: `${hi(firstName)}

Your first Curated Box ships in about two weeks and I wanted to give you a heads up.

We're putting the finishing touches on it now. Without giving too much away, I think you're going to be really happy with what's inside.

A couple things that would help us make it perfect:

1. Is your shipping address up to date? (You can check in your account settings)

2. Any brands or categories you'd specifically love or want to avoid?

Reply with any preferences and we'll work them in.

Drew`,
});

// Email 5 — Post-Box Follow-Up (3 days after delivery — event-triggered)
export const member_5: EmailTemplate = (firstName) => ({
  subject: "Did it live up to the hype?",
  text: `${hi(firstName)}

Your box should have landed by now. What did you think?

I'm always a little nervous sending these out because I want every box to feel like it was worth it. And then some.

If you loved it, I'd be grateful if you shared a quick review or photo in the Community. It helps other members know what to expect and it helps us keep improving.

And if anything missed the mark, please tell me. We adjust your profile each quarter based on your feedback so it only gets better.

What was the standout item?

Drew`,
});

// Email 6 — Insider Check-In (Day 45)
export const member_6: EmailTemplate = (firstName) => ({
  subject: "Quick check-in from me",
  text: `${hi(firstName, "Hey friend,")}

You've been a Reserve member for about six weeks now. I wanted to check in and ask: is it everything you expected?

The honest truth is we're still building. Mully is early, and our best members are the ones who tell us what's working and what isn't.

So: what's one thing you love? And what's one thing you'd change?

Your feedback goes directly to our product team (which, at this stage, is basically me and two other people). It matters.

Drew`,
});

export const MEMBER_TEMPLATES = [
  member_1,
  member_2,
  member_3,
  member_4,
  member_5,
  member_6,
];

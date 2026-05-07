# Legacy Member Upsell — AI Auto-Reply Test Results

Just shipped a prompt update to the AI auto-reply system in /admin. When a legacy member replies to a drip email, the AI draft now actively looks for an opening to mention the Reserve box ($249/quarter) instead of only doing it passively "if the conversation allows."

Applies to all legacy members (not just Back 9). The logic is tiered: if they bring up gear, boxes, or what's new → direct upsell. If it's a billing or admin question → answer first, soft mention at the end.

Before shipping I ran 4 test scenarios against a mock Back 9 legacy member profile. Here are the results:

---

**Scenario 1 — Member asks about gear**
> "What kind of gear are you guys sourcing these days? I've been looking for some new apparel."

*AI draft:*
> Mark, good to hear the season is treating you well.
>
> On the apparel side, we've been sourcing some really strong stuff lately. Modern cuts, performance fabrics, the kind of pieces that actually hold up when you're moving through a round. We keep a rotating selection in the Pro Shop, and with $25 in store credit sitting in your account, now's a solid time to browse. Might be something that catches your eye before the next Drop lands.
>
> That said, if you want the real first look at what we're pulling in, that's where our Reserve members have a serious edge. Every quarter they get a curated box of gear selected specifically for their profile, and the value in the box consistently runs well past the membership cost. Given your style and where your game is, I think you'd find a lot to like in what we put together.
>
> What are you specifically on the hunt for? Tops, outerwear, bottoms? Helps me point you in the right direction.
>
> Drew

---

**Scenario 2 — Member asks about billing**
> "I noticed my billing date changed. Is that normal?"

*AI draft:*
> Hey Mark, yeah, totally normal. Billing dates can shift by a day or two depending on weekends, holidays, or how the payment cycle processes. Nothing to worry about on your end. Your next billing date is June 15, 2026, and that's when your next Back 9 box ships too.
>
> If you ever notice anything that looks off beyond that, just reply here and I'll take a look personally.
>
> On a separate note, you've got $25 in store credit sitting in your account. Worth browsing the Pro Shop if anything catches your eye before your next cycle.
>
> What kind of gear have you been into lately? Always curious what our members are testing out.
>
> Drew

---

**Scenario 3 — Member asks directly about the box**
> "Do you guys still do the quarterly boxes? I remember hearing about that."

*AI draft:*
> Hey Mark, yeah we absolutely still do them. The Reserve box ships every quarter and honestly it's one of my favorite things we put together. We curate it specifically around gear that a serious golfer at your level would actually use, and the value in each box consistently clears the $249 membership cost. Sometimes by a good margin.
>
> Your current plan doesn't include the box, but you're already at Member-level access, so the gap isn't as big as you might think. If you want to make the jump to Reserve, just say the word and I'll take care of it.
>
> Curious what drew you to ask about it. Are you looking to add more gear to the bag, or just exploring what's out there?
>
> Drew

---

**Scenario 4 — Generic reply, no clear hook**
> "Things are good, been getting out a couple times a week. Appreciate you checking in."

*AI draft:*
> That's great to hear. Couple rounds a week at a 12 handicap, you're putting in the work.
>
> Quick question for you. Are you mostly playing the same course or mixing it up? I always find guys who get out consistently like that tend to have pretty specific opinions on their gear setup. Curious what you're gaming right now.
>
> Also worth mentioning, you've got $25 in store credit sitting in your account. If anything catches your eye in the Pro Shop, it's already there waiting for you.
>
> Drew

---

**Note:** In scenarios 2 and 4, the AI prioritized store credit and conversation-building over an explicit box mention. If Drew wants the Reserve box referenced in every single reply regardless of context, we can tighten the prompt. Otherwise this looks good to ship.

**v2 fixes (2026-05-07):** Removed broken `mymully.com/upgrade` link (page doesn't exist). Legacy members who show upgrade interest now get a personal offer: "just say the word and I'll take care of it." AI also creates an `upgrade-opportunity` task so the team is notified to execute the swap.

---

## Files changed

- `src/lib/email/ai-reply.ts` — updated `buildSystemPrompt`: proactive upsell for all legacy members, tiered approach
- `scripts/test-legacy-upsell.mjs` — test script (4 scenarios: gear, billing, box, general)

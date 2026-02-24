# Onboarding Step 1 Redesign — Plan

## Design Concept: "The Fitting"

Reframe step 1 as a premium "fitting" — the same way you'd walk into a high-end pro shop and have someone get to know your game before pulling product. The flow is conversational, one section at a time, and culminates in a playful personality question that makes the user smile and feel like this brand *gets* them.

---

## Structural Change: Sub-steps within Step 1

Currently step 1 is a single long scrolling form. We'll break it into **3 compact sub-steps** that animate between each other. This creates a sense of forward motion, reduces cognitive load, and makes each section feel intentional.

### Sub-step 1a — "The Basics" (Required)
- **Email** — pre-filled, editable (keep existing behavior)
- **Username** — keep existing behavior with smart suggestions
- **Birthdate** — new, required. Three inline `<select>` dropdowns (Month / Day / Year) styled as a single row. Selects are more forgiving than typed input for dates — no formatting errors. Clean, accessible, and on-brand.

**Continue button** enabled once email + username + birthdate are filled.

### Sub-step 1b — "Your Game" (Optional)
- **Handicap** — keep existing pill-button selector, same options
- **Private club member?** — a simple two-option toggle: "Yes" / "No". Tapping "Yes" reveals a text input for club name (slide-down reveal with a smooth height transition). This is lightweight and doesn't pressure anyone.

**Continue button** always enabled (everything here is optional). Also show "Skip" link.

### Sub-step 1c — "The Vibe Check" (Optional, fun)
A single question designed to feel like a personality quiz rather than a form field:

> **"Someone in the cart next to you starts playing music on the first tee. What's your move?"**

Four illustrated answer cards in a 2x2 grid. Each card has:
- A small thematic icon at top (inline SVG, matching the sage/forest palette)
- Bold answer text (1–3 words)
- A one-line subtitle in lighter text

Options:
1. **"Politely ask them to stop"** — *Respect the game.*  (icon: raised hand)
2. **"Turn it up"** — *Golf is supposed to be fun.* (icon: music note)
3. **"Move to another hole"** — *Conflict isn't my thing.* (icon: walking figure)
4. **"Depends on the song"** — *Taste matters.* (icon: headphones)

Cards use the same `bg-cream border-taupe/25 → bg-forest text-bone` active toggle pattern used throughout. On hover, a subtle lift (`card-hover` class). This question is memorable — it'll come up in conversations and social sharing, which is great for brand.

**Continue button** always enabled. Also show "Skip" link.

---

## Sub-step Progress Indicator

Replace the current two-bar progress indicator with a **three-dot stepper** within the Step 1 area, below the existing 2-bar top progress. The top bar still shows step 1 vs step 2 overall. The dots show 1a → 1b → 1c progress within step 1.

Implementation: three small circles connected by thin lines. Active = `bg-forest`, completed = `bg-forest`, upcoming = `bg-taupe/30`. The connecting lines fill from left to right as you advance. All transitions animated with the project's existing `transition-all duration-500` pattern.

---

## Animations & Transitions

- **Sub-step transitions**: When advancing from 1a → 1b → 1c, the current sub-step fades/slides out left and the next fades/slides in from right. Use CSS transitions (matching the existing `animate-fade-up` pattern but horizontal). We'll add a `.animate-slide-left-out` and `.animate-slide-right-in` keyframe pair in `globals.css`.
- **Birthdate selects**: Standard `animate-fade-up` on mount.
- **Club name reveal**: CSS `max-height` / `opacity` transition when "Yes" is tapped — smooth 300ms expand.
- **Vibe check cards**: Staggered `animate-fade-up` with 80ms delays (like the landing page's `ScrollReveal delay` pattern).
- **Overall entry**: Each sub-step container uses the existing `animate-fade-up` on mount.

---

## Section Headers

Each sub-step gets the same premium header treatment used in the current design:

- **1a**: "Let's get started." / *"The basics — so we know who we're talking to."*
- **1b**: "Tell us about your game." / *"Optional, but it helps us curate better."*
- **1c**: "One more thing." / *"A quick vibe check — just for fun."*

Uses the existing `font-serif text-3xl md:text-4xl` for the heading and `text-base text-charcoal/55` for the subtitle. The section label (e.g., "The Basics") uses the existing sage uppercase treatment.

---

## Removal: Interests Section

The current "What are you most interested in?" interests grid is removed from step 1. This is a post-signup discovery question that works better in-app (dashboard onboarding or first-session prompt). It clutters the critical conversion path and doesn't inform curation meaningfully at signup. Removing it keeps step 1 tight and purposeful.

---

## Data Flow

- New state variables: `birthMonth`, `birthDay`, `birthYear`, `privateClub` (boolean | null), `clubName` (string), `vibeCheck` (string).
- `substep` state (1 | 2 | 3) controls which sub-step is visible.
- `canAdvance` logic for sub-step 1 requires email + username + all three birthdate fields.
- Sub-steps 2 and 3 are always advanceable (optional content).
- All state stays client-side for now (same as current implementation).

---

## File Changes

**`src/app/onboarding/page.tsx`** — Primary rewrite of step 1:
- Add `substep` state and new field states
- Replace single step-1 block with three animated sub-step views
- Add sub-step progress dots component
- Add birthdate triple-select component
- Add private club toggle + conditional club name input
- Add vibe check card grid with 4 options and icons
- Remove interests section and its icons
- Update continue/skip logic per sub-step
- Add 4 new small icon components for vibe check cards

**`src/app/globals.css`** — Add sub-step transition animations:
- `@keyframes slide-out-left` and `@keyframes slide-in-right`
- `.animate-substep-enter` and `.animate-substep-exit` utility classes
- Club name reveal transition class

No new files needed. No new dependencies. Everything stays in the existing single-page component pattern.

---

## Summary

| Before | After |
|--------|-------|
| 1 long form with 4 sections | 3 focused sub-steps with clear progression |
| Email, username, handicap, interests | Email, username, birthdate (required) → handicap, private club (optional) → vibe check (optional, fun) |
| Static scroll | Animated horizontal transitions between sub-steps |
| Generic interests grid | Personality-driven "vibe check" that's memorable and shareable |
| No birthdate collection | Birthdate collected upfront (required) |

The result: a flow that feels like a curated experience from the first interaction — professional, intentional, and just enough personality to make users want to keep going into step 2.

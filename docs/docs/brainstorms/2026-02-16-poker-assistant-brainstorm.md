# Poker Assistant — Brainstorm

**Date:** 2026-02-16
**Status:** Ready for planning

---

## What We're Building

An AI-powered poker study companion — a Next.js web app where you upload screenshots of your poker table and Claude's vision API reads the game state (cards, positions, pot size, actions), then gives strategic advice tailored to your skill level.

### Core Features

1. **Screenshot Analysis** — Upload/paste a screenshot of your poker table. AI vision reads: your hole cards, community cards, pot size, stack sizes, positions, and current action.

2. **Strategic Advice Engine** — Based on the parsed game state, provide:
   - What to do (fold/call/raise) and why
   - Equity estimate against likely opponent ranges
   - Position-aware preflop charts
   - Pot odds calculation
   - Beginner-friendly explanations that teach concepts

3. **Poker Site Recommendation** — Curated guide to help choose where to play:
   - Platform comparison (PokerStars, GGPoker, CoinPoker, etc.)
   - Filters by: softness, rakeback, HUD policy, tournament quality
   - Netherlands/EU legal status

4. **Strategy Library** — Organized poker strategy content:
   - Beginner: starting hands, position, pot odds, bankroll management
   - Intermediate: 3-betting, c-betting, player types, ICM
   - Advanced: GTO vs exploitative, range construction, multi-street planning
   - Cash games vs tournaments differences

5. **Hand History Log** — Save analyzed hands to review later, track patterns in your play, identify leaks over time.

---

## Why This Approach

- **Claude vision is the killer feature** — No need for brittle OCR or site-specific scrapers. Claude can read any poker table screenshot regardless of the platform's UI.
- **Works with any poker site** — Not tied to one client or browser-based-only platforms.
- **Fully within tech stack** — Next.js + Supabase + Vercel. No extension development or unfamiliar tools.
- **Ethical and legal** — Designed for play-money tables and post-session review. Not an RTA for real-money play.
- **Teaches, not just tells** — Every recommendation includes the reasoning, building the user's understanding over time.

---

## Key Decisions

### User Profile
- **Experience level:** Beginner
- **Location:** Netherlands/EU
- **Goal:** Side income + deep study of the game
- **Format:** Both cash games and tournaments
- **Usage:** Real-time advice on play-money tables for learning

### Platform Recommendations (from research)
- **Best to start (play-money):** PokerStars — best play-money ecosystem, allows HUDs, transparent rakeback
- **Best soft games:** CoinPoker — 33% flat rakeback, soft player pool, crypto-friendly
- **Best tournaments:** GGPoker — largest guarantees, most variety
- **Best for HUD users:** ACR or PokerStars — fully HUD-friendly

### Technical Decisions
- **Vision API:** Claude (Anthropic) — multimodal, can read complex table layouts
- **Input method:** Clipboard paste (Cmd+Shift+4 → Cmd+V). Auto-analyze on paste — no confirm step.
- **Strategy content:** Curated and embedded in the app, not just AI-generated on the fly
- **Auth:** Supabase Auth (save hand history, track progress)
- **Storage:** Supabase for hand history, user preferences, strategy progress

### UX Decisions
- **Input flow:** Clipboard paste → auto-analyze. Total time: ~3 seconds per hand.
- **Layout:** Poker table in one window, app in another (or split screen).
- **Results display:** Action-first — big bold FOLD/CALL/RAISE at the top, expandable reasoning below. Scannable in 1 second.
- **Auto-analyze:** Analysis starts immediately on paste. No confirmation step.
- **Whole-page paste target:** The entire app window listens for paste events, no need to click a specific area.
- **Speed priority:** Analysis must feel fast. Show the action recommendation first, stream the reasoning as it comes.

### RTA Policy
- App is designed as a **study/training tool**
- Intended for use on **play-money tables** only
- Clear disclaimer that using RTA on real-money tables violates most sites' ToS
- Once skills are built, user plays real money unaided

---

## Strategy Content Structure

### Beginner Track
- Starting hand charts (by position)
- Position fundamentals
- Pot odds & basic math
- Bankroll management
- Common beginner mistakes

### Intermediate Track
- 3-betting & 4-betting ranges
- Continuation betting strategy
- Semi-bluffing
- Reading player types (TAG, LAG, nit, fish)
- ICM for tournaments

### Advanced Track
- GTO vs exploitative play
- Range construction
- Multi-street planning
- Population tendencies
- Solver-informed play

### Format-Specific
- Cash game strategy
- Tournament strategy
- 6-max vs full ring
- Stack depth adjustments

---

## Open Questions

1. **Pricing model** — Free? Freemium with limited analyses per day? Subscription?
2. **AI cost management** — Claude vision API calls per hand analysis add up. How to manage costs?
3. **Equity calculation** — Use AI estimation or integrate a proper equity calculator library?
4. **Mobile support** — Should we optimize for mobile screenshots too?
5. **Community features** — Hand sharing, leaderboards, study groups? Or keep it focused?

---

## Existing Tools in the Market

| Tool | What It Does | Gap We Fill |
|------|-------------|-------------|
| GTO Wizard | Pre-solved GTO scenarios | We're more accessible, AI-driven, screenshot-based |
| PokerTracker 4 | Hand history tracking + HUD | We're web-based, no install, AI-powered analysis |
| PioSolver | Advanced GTO solver | We're beginner-friendly, no learning curve |
| Equilab | Equity calculator | We combine equity with full strategic advice |

Our differentiator: **screenshot-in, strategy-out** — no manual data entry, no complex solver setup. Just show us your table and we tell you what to do and why.

---

## Next Steps

Run `/workflows:plan` to create the implementation plan.

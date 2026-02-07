# Poker UI Clarity-First Redesign

**Date:** February 6, 2026  
**Branch:** `codex/ui-enhancement`  
**Scope:** Full frontend UI pass for personal-use Texas Hold'em client with balanced desktop/mobile support.

## Goals

1. Improve in-hand decision clarity so turn ownership, pot size, call amount, and legal actions are immediately obvious.
2. Keep a single responsive component tree that behaves well on desktop and mobile without separate app variants.
3. Preserve current gameplay logic and socket data model; UI refresh only.
4. Make E2E tests more resilient by adding deterministic selectors (`data-testid`) instead of brittle class/text-dependent selectors.

## UX Direction

Chosen direction: **Clarity-first modern table**.

### Core Layout

The game screen is reorganized into three stable zones:

1. **Top HUD (sticky):** room identity, player count, pot, betting round, and connection state.
2. **Table Core:** community cards and seat list/table view with strong active-turn and dealer indicators.
3. **Bottom Action Dock (sticky on mobile, anchored on desktop):** grouped legal actions with clear visual separation of safe vs destructive actions.

This structure ensures high-value state remains visible while users scroll smaller screens and keeps decision controls always reachable.

### Visual Language

- Dark-green poker atmosphere with restrained contrast accents.
- Semantic state colors:
  - Turn: amber/highlight
  - Positive/safe: green/blue
  - Risk/destructive: red
  - Passive/inactive: slate/gray
- Minimal motion only for status transitions (turn highlight pulse, lightweight panel entrance, count updates).

## Component Architecture

### Home

- Preserve existing create/join workflow.
- Replace alert-driven validation with inline field feedback and status messaging.
- Keep existing action labels and placeholders to avoid unnecessary user retraining and test churn.
- Add stable selectors for key controls (name input, room code input, create/join/back buttons, connection indicator).

### GameRoom Shell

Split rendering concerns into logical blocks inside `GameRoom`:

- `RoomHeader`: room code and player occupancy.
- `HudStats`: pot, street, and player-level quick stats.
- `CommunityBoard`: shared cards and round-state context.
- `SeatsPanel`: player status list with stronger visual state markers.
- `ActionDock`: legal actions and raise input controls.
- `MetaPanel`: blinds and utility details.

### Action Dock Behavior

- Keep existing action semantics (`fold`, `check`, `call`, `raise`, `all-in`).
- Group controls by intent:
  - Primary flow: check/call
  - Aggressive flow: raise/all-in
  - Destructive: fold
- Preserve existing button labels (`Check`, `Call $X`, `Raise`, `All-In`) for test continuity.
- Add explicit min/max raise guidance and disabled-state styling.

### Card and Seat Components

- Update `Card` visuals (better contrast, clearer suit/rank hierarchy, cleaner card back design).
- Update `PlayerSeat` to present current turn, fold/all-in status, dealer chip, and bet amount clearly.
- Maintain simple, deterministic structure and test ids.

## Data Flow and State Strategy

- Keep current `SocketContext` and `GameContext` contracts intact.
- Add local, derived view-state calculations in `GameRoom` for:
  - `isYourTurn`
  - `callAmount`
  - `minRaise`
  - `canCheck`
  - player status badges
- Avoid spreading these calculations through multiple JSX branches.

## Error and Status Handling

- Home validation moves from browser alerts to inline messages.
- Room-level action invalidity is communicated through disabled controls and helper text.
- Connection status remains persistently visible in lobby and room HUD.

## E2E Testing Plan

### New Stable Selectors

Introduce `data-testid` on:

- Home controls (connection, inputs, create/join path controls)
- Room header (`room-title`, `room-player-count`)
- HUD (`pot-value`, `round-value`, `your-chips`)
- Action dock (`action-dock`, `action-fold`, `action-check`, `action-call`, `action-raise`, `action-all-in`, `raise-input`)
- Community cards and per-seat rows

### Test Changes

- Preserve existing text-based assertions when already robust.
- Update helper functions in comprehensive e2e spec to prefer `data-testid` lookups for pot, round, community card count, and seat parsing.
- Keep gameplay assertions identical (pot/chips/turn sequencing and side-pot behavior).

## Implementation Checklist

1. Create style tokens and shared utility classes in `index.css`.
2. Redesign `Home` for cleaner entry flow and inline validation feedback.
3. Redesign `GameRoom` shell with sticky HUD/action dock and clearer visual hierarchy.
4. Refresh `Card` and `PlayerSeat` visuals.
5. Add and wire `data-testid` attributes throughout key UI controls.
6. Update e2e helper selectors to use deterministic anchors.
7. Run frontend build and targeted Playwright tests; patch regressions.


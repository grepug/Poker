# iPhone 15 Immersive Poker Table Design

**Date:** February 7, 2026  
**Scope:** Mobile-first game board redesign for active hand experience  
**Primary Target:** iPhone 15 portrait (`393x852` CSS viewport)  
**Table Capacity Target:** 6-max seat orbit

## Product Decisions Locked

1. Replace list-style player panel with an orbit seat layout around a central oval table.
2. Optimize visual hierarchy for active-hand decisions, not room administration.
3. Keep game-critical info compact and persistent on small screens.
4. Make `call`, `raise`, and `all-in` commit through mandatory drag-to-pot interaction.
5. Keep `check` and `fold` as explicit tap actions.

## Experience Goals

1. Deliver a realistic table feel with fast, thumb-friendly controls.
2. Surface only high-value hand state by default: pot, street, turn, stack, to-call.
3. Prevent accidental betting by using preview + drag + drop confirmation.
4. Preserve current backend action contract and game rules.

## Layout Blueprint (Mobile-First)

### 1) Top Micro-HUD

- Fixed compact strip (`56-64px`).
- Shows: pot, betting street, your stack.
- Optional room/utility controls collapsed behind icon actions.

### 2) Center Stage (Primary Focus)

- Large oval felt table occupying most of viewport height.
- Board core includes:
  - pot stack and amount
  - community cards lane (5 slots)
  - active drop ring around pot for drag commits
- Drop ring visually activates only on your turn.

### 3) Seat Orbit (No Player List)

- Six compact seat pods anchored around the oval.
- Your seat locked at bottom-center; other seats map clockwise.
- Each seat shows:
  - player name (truncated)
  - stack
  - current committed bet
  - concise state badge (`TURN`, `FOLD`, `ALL-IN`)
  - dealer/SB/BB marker icons
- Tap seat pod for temporary detail popover.

### 4) Bottom Chip Composer Rail

- Sticky action rail for chip composition.
- Denomination taps (example): `+1`, `+5`, `+25`, `+100`, `+500`, `MAX`.
- Utility actions: `-LAST`, `CLEAR`.
- Visual output: draggable chip stack with total value badge.

## Bet Interaction Model

### Mandatory Drag Actions

1. User builds tray amount in chip composer.
2. User drags stack into pot drop ring.
3. On successful drop, UI resolves intent:
   - `tray == toCall` -> `CALL`
   - `tray > toCall` -> `RAISE` (to computed total)
   - `tray == stack` or `MAX` -> `ALL-IN`

### Non-Drag Actions

- `CHECK` and `FOLD` remain direct tap buttons.

### Drop Feedback

- During drag: live action preview (`CALL 40`, `RAISE TO 120`, etc.).
- Valid hover: ring glow + magnetic snap assist.
- Invalid drop: bounce back + precise reason toast.

## Architecture Plan

## Components

1. `TableScreen` (new shell in room view)
2. `TopMicroHud`
3. `TableFelt`
4. `BoardCenter`
5. `PotDropZone`
6. `SeatOrbit`
7. `SeatPod`
8. `ChipComposerRail`

## Hook and Utilities

1. `useBetComposer` for local interaction state:
   - `trayAmount`
   - `trayChips`
   - `dragState`
   - `dropPreview`
   - `validationMessage`
2. `resolveChipDropIntent` pure utility:
   - Inputs: `toCall`, `minRaise`, `stack`, `currentBet`, `trayAmount`
   - Output: backend action payload (`call`, `raise`, `all-in`) or invalid reason

## Integration Boundary

- Continue using `GameContext` as server truth source.
- UI layer derives legality state; server remains authoritative.
- No duplicated game-rule logic beyond preview and client-side guardrails.

## Error Handling and Resilience

1. Preview-before-commit for all drag actions.
2. No silent amount coercion; invalid drops are rejected with explanation.
3. Mid-drag socket state changes freeze drop zone and show sync status.
4. Composer restores last valid local tray after reconnect.

## Motion and Performance

1. Keep animations purposeful:
   - card deal reveal
   - chip pickup/drag
   - pot accept burst
2. Use transform/opacity animations to maintain 60fps on mobile.
3. Respect reduced-motion settings by minimizing non-essential effects.
4. Maintain minimum 44px touch target sizing.

## Testing Strategy

## Unit Tests

1. `resolveChipDropIntent` legality matrix:
   - exact call
   - legal raise
   - min-raise rejection
   - over-stack rejection
   - all-in edge cases
2. `useBetComposer` behavior:
   - chip add/remove
   - clear/max
   - drag lifecycle transitions

## E2E Tests (Playwright)

1. iPhone 15 viewport render baseline.
2. Orbit seats visible, no list-based players panel.
3. `CALL` via exact drag-to-pot.
4. `RAISE` via over-call drag.
5. `ALL-IN` via max stack drag.
6. Invalid drop bounce with reason messaging.

## Rollout Sequence

1. Build new table shell and orbit layout behind feature flag.
2. Introduce chip composer + drop intent utility.
3. Replace numeric raise input with drag flow.
4. Update/extend E2E selectors and scenarios.
5. Remove legacy list/table sections after parity is validated.

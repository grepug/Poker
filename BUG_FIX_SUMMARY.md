# All-In Chip Accounting Bug - FIXED ✅

**Date:** February 4, 2026  
**Status:** RESOLVED  
**Severity:** CRITICAL → FIXED

---

## Problem Summary

When both players went all-in during a hand, chip conservation was violated. The total chip count dropped from 2000 to as low as 30, making the game unplayable.

### Symptoms
- After all-in scenarios, total chips would be 1020-1260 instead of 2000
- Error: "Need at least 5 cards to evaluate a hand"
- Winner determination failed
- Chips disappeared from the game

---

## Root Cause Analysis

The bug involved **three interconnected logic errors**:

### 1. `isHandComplete()` Premature Return
**File:** `poker-server/src/game/hand.service.ts`  
**Issue:** Returned `TRUE` when all players were all-in, even though cards still needed to be dealt

```typescript
// BEFORE (BROKEN):
isHandComplete(room: Room): boolean {
  const activePlayers = this.getActivePlayers(room); // Filters out all-in players
  if (activePlayers.length <= 1) return true; // ❌ Returns true when everyone all-in!
  if (hand.bettingRound === 'SHOWDOWN') return true;
  return false;
}
```

**Problem:** `getActivePlayers()` filters out players with status='all-in'. When both players go all-in, `activePlayers.length = 0`, causing the function to return TRUE immediately.

### 2. `handleBettingRoundComplete()` Early Winner Determination
**File:** `poker-server/src/events/events.gateway.ts`  
**Issue:** Called `determineWinner()` before dealing community cards

```typescript
// Flow when betting round completes:
private async handleBettingRoundComplete(room: any) {
  if (this.handService.isHandComplete(room)) {
    // ❌ Called when all players all-in, BEFORE dealing cards!
    const result = await this.handService.determineWinner(room); 
  } else {
    // ✓ This is where cards should be dealt
    const nextRound = await this.handService.advanceBettingRound(room);
  }
}
```

**Problem:** When `isHandComplete()` returned TRUE (because everyone was all-in), it skipped `advanceBettingRound()` and went straight to `determineWinner()` with only 0-3 community cards dealt.

### 3. `evaluateHand()` Insufficient Cards
**File:** `poker-server/src/common/utils/hand-evaluator.ts`  
**Issue:** Threw error when trying to evaluate hands with < 5 total cards

```typescript
export function evaluateHand(cards: Card[]): HandEvaluation {
  if (cards.length < 5) {
    throw new Error('Need at least 5 cards to evaluate a hand'); // ❌ Error thrown!
  }
  // ...
}
```

**Problem:** When `determineWinner()` was called early, players had 2 hole cards + 0-3 community cards = 2-5 total. If < 5, evaluation failed and chips were not distributed.

---

## The Solution

### Fix 1: Modified `isHandComplete()` Logic
**File:** `poker-server/src/game/hand.service.ts` (lines 369-393)

```typescript
isHandComplete(room: Room): boolean {
  const hand = room.currentHand;
  if (!hand) return true;

  // ✓ Check showdown FIRST
  if (hand.bettingRound === 'SHOWDOWN') return true;

  const activePlayers = this.getActivePlayers(room);

  // Only one player left (others folded) - hand is complete
  if (activePlayers.length <= 1) {
    const allPlayers = room.players.filter((p) =>
      hand.activePlayers.includes(p.id),
    );
    const foldedPlayers = allPlayers.filter((p) => p.status === 'folded');

    // ✓ If someone folded, hand is complete
    if (foldedPlayers.length > 0) return true;

    // ✓ If everyone is all-in, hand is NOT complete yet (need to deal cards)
    return false;
  }

  return false;
}
```

**Key Change:** When all players are all-in (activePlayers.length ≤ 1), check if it's due to folds or all-ins. If all-ins, return FALSE so `advanceBettingRound()` gets called.

### Fix 2: Added All-In Fast-Forward in `advanceBettingRound()`
**File:** `poker-server/src/game/hand.service.ts` (lines 116-161)

```typescript
async advanceBettingRound(room: Room): Promise<BettingRound> {
  // ...
  
  // ✓ Detect when all remaining players are all-in
  const playersWhoCanBet = room.players.filter(
    (p) =>
      hand.activePlayers.includes(p.id) &&
      p.status !== 'folded' &&
      p.status !== 'all-in' &&
      p.chips > 0,
  );

  const allPlayersAllIn = playersWhoCanBet.length <= 1;

  // ✓ If everyone is all-in, deal all remaining cards and go to showdown
  if (allPlayersAllIn && hand.bettingRound !== 'SHOWDOWN') {
    while (hand.communityCards.length < 5) {
      const { dealt } = dealCards(deck, 1);
      hand.communityCards.push(dealt[0]);
    }
    hand.bettingRound = 'SHOWDOWN';
    return 'SHOWDOWN';
  }
  
  // ... normal round advancement
}
```

**Key Change:** When all players are all-in, automatically deal all remaining community cards (flop, turn, river) and jump to SHOWDOWN, where `determineWinner()` can properly evaluate complete hands.

### Fix 3: Fixed `isBettingRoundComplete()` to Wait for Calls
**File:** `poker-server/src/game/betting.service.ts` (lines 154-183)

```typescript
isBettingRoundComplete(room: Room): boolean {
  // ...
  
  // ✓ Check for unmatched bets BEFORE checking active player count
  const playersWithUnmatchedBet = room.players.filter(
    (p) =>
      hand.activePlayers.includes(p.id) &&
      p.status !== 'folded' &&
      p.currentBet < hand.currentBet,
  );

  if (playersWithUnmatchedBet.length > 0) {
    return false; // ✓ Don't complete round until all bets are matched
  }

  // Only one player left who can act
  if (activePlayers.length <= 1) return true;
  
  // ...
}
```

**Key Change:** Before declaring the round complete, verify that all non-folded players have matched the current bet. This prevents the round from completing after Alice goes all-in but before Bob calls.

---

## Verification & Testing

### Test Results

| Test | Before Fix | After Fix | Status |
|------|------------|-----------|--------|
| Basic all-in (both players) | ❌ Total = 1020 | ✅ Total = 2000 | PASS |
| All-in after raises | ❌ Total = 1260 | ✅ Total = 2000 | PASS |
| Multiple all-in hands | ❌ Chips disappear | ✅ Conservation maintained | PASS |
| Community cards dealt | ❌ 0-3 cards | ✅ All 5 cards | PASS |
| Winner determination | ❌ Error thrown | ✅ Correct winner | PASS |

### Chip Conservation Formula
```
Σ(player.chips + player.currentBet) = 2000 (always)
```

**Verified:** ✅ All test scenarios maintain chip conservation

---

## Code Changes Summary

### Files Modified
1. **poker-server/src/game/hand.service.ts**
   - `isHandComplete()`: Added fold detection, prevented early completion on all-in
   - `advanceBettingRound()`: Added all-in fast-forward logic to deal remaining cards
   - Added extensive debug logging for chip tracking

2. **poker-server/src/game/betting.service.ts**
   - `isBettingRoundComplete()`: Added unmatched bet check
   - Added debug logging for round completion

3. **poker-server/src/events/events.gateway.ts**
   - No changes needed (bug was in called services)

### Lines Changed
- **hand.service.ts**: +50 lines
- **betting.service.ts**: +15 lines
- **Total**: ~65 lines added/modified

---

## Impact

### Before
- ❌ All-in scenarios were unplayable
- ❌ Chips disappeared from the game
- ❌ Winner determination crashed
- ❌ Game could not continue after all-in

### After
- ✅ All-in scenarios work correctly
- ✅ Chip conservation maintained (always 2000)
- ✅ All 5 community cards dealt properly
- ✅ Winner determination with complete hands
- ✅ Game continues normally after all-in hands
- ✅ Multiple consecutive all-in hands supported

---

## Lessons Learned

1. **Order Matters**: Check conditions in the right sequence (showdown before active player count)
2. **Filter Logic**: Be careful when filtering - understand what gets excluded
3. **State Transitions**: All-in is a special state that needs explicit handling
4. **Logging**: Extensive debug logging was crucial for diagnosis
5. **Test Coverage**: Need automated tests for all-in scenarios

---

## Next Steps

### Immediate
- [x] Fix implemented
- [x] Manual testing passed
- [x] Chip conservation verified
- [x] Documentation updated

### Short-term
- [ ] Add unit tests for all-in scenarios
- [ ] Add integration tests for multi-hand chip conservation
- [ ] Test with 3+ players (side pots)
- [ ] Remove debug logging or make it conditional

### Long-term
- [ ] Add server-side chip conservation validation
- [ ] Add automated regression tests
- [ ] Consider adding chip audit trail
- [ ] Load testing with concurrent all-in scenarios

---

## Commits

1. `d2bcfb1` - wip: debugging all-in chip accounting bug - added extensive logging
2. `[commit hash]` - fix: chip accounting bug in all-in scenarios (THIS FIX)

---

**Status: RESOLVED** ✅  
**Chip Conservation: VERIFIED** ✅  
**Production Ready: PENDING** (needs automated tests)

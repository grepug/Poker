# Texas Hold'em Poker - Comprehensive Test Plan

## Test Environment

- Backend: NestJS server running on port 3001 (managed by pm2)
- Frontend: Vite React app on port 5174
- Testing Tool: agent-browser with 2 sessions (Alice & Bob)
- Debug Interface: window.pokerDebug global functions

## Pre-Test Verification

- [ ] Backend running: `pm2 status poker-server`
- [ ] Frontend running: Check localhost:5174
- [ ] Both browser sessions connected
- [ ] Chip conservation formula: `alice.chips + alice.currentBet + bob.chips + bob.currentBet = 2000`

---

## Test Suite 1: Basic Betting Actions

### Test 1.1: Check/Check Scenario

**Objective**: Verify both players can check through all rounds

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob check
- [ ] FLOP: Alice check, Bob check
- [ ] TURN: Alice check, Bob check
- [ ] RIVER: Alice check, Bob check
- [ ] Verify showdown, winner determined, chips conserved

### Test 1.2: Bet/Call Scenario

**Objective**: Test betting and calling across rounds

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $50, Alice call
- [ ] FLOP: Alice check, Bob raise $100, Alice call
- [ ] TURN: Both check
- [ ] RIVER: Both check
- [ ] Verify pot = $30 (blinds) + $100 (pre-flop) + $200 (flop) = $330
- [ ] Verify winner gets correct amount

### Test 1.3: Bet/Fold Scenario

**Objective**: Test folding functionality

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $100, Alice fold
- [ ] Verify Bob wins immediately (pot = $120)
- [ ] Verify Alice: $880, Bob: $1120
- [ ] Verify new hand starts automatically

---

## Test Suite 2: Raise/Re-raise Actions

### Test 2.1: Single Raise

**Objective**: Test raise mechanics

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $50
- [ ] Verify currentBet = $70 (big blind $20 + raise $50)
- [ ] Verify Alice must call $60 (from $10 to $70)
- [ ] Alice call, verify pot = $140

### Test 2.2: Re-raise (3-bet)

**Objective**: Test re-raising

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $50, Alice raise $100
- [ ] Verify currentBet = $170 (Bob's $70 + Alice re-raise $100)
- [ ] Verify Bob must call $100 more (from $70 to $170)
- [ ] Bob call, verify pot = $340

### Test 2.3: Multiple Re-raises

**Objective**: Test escalating bets

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $50, Alice raise $100, Bob raise $150, Alice call
- [ ] Track pot growth: $30 → $140 → $340 → $640
- [ ] Verify final pot = $640
- [ ] Verify chip conservation at each step

---

## Test Suite 3: All-In Scenarios

### Test 3.1: Small All-In (under pot size)

**Objective**: Test all-in with small stack

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $900 (leaving Bob with $90)
- [ ] Alice call $910
- [ ] Verify Bob is marked as "all-in" with $0 chips
- [ ] Continue through all betting rounds (Bob can't act)
- [ ] Verify showdown and pot distribution

### Test 3.2: All-In Call

**Objective**: Test calling all-in

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice check, Bob raise $500, Alice all-in $980
- [ ] Verify Alice is all-in with $0 chips
- [ ] Bob calls remaining $480
- [ ] Both all-in, verify immediate showdown
- [ ] Verify winner gets $2000

### Test 3.3: Both All-In Pre-Flop

**Objective**: Test double all-in scenario

- [ ] Create room, start game
- [ ] PRE_FLOP: Alice all-in $980, Bob all-in $990
- [ ] Verify both at $0 chips
- [ ] Verify immediate dealing of all community cards
- [ ] Verify showdown and winner determination

### Test 3.4: Partial All-In (Side Pot)

**Objective**: Test side pot creation (requires 3 players - note for future)

- [ ] Note: Current 2-player test can't verify side pots
- [ ] Document expected behavior for 3+ players

---

## Test Suite 4: Edge Cases

### Test 4.1: Minimum Raise

**Objective**: Verify minimum raise enforcement

- [ ] Create room, start game
- [ ] Try to raise $1 (should fail or enforce min raise)
- [ ] Verify minimum raise = currentBet _ 2 or bigBlind _ 2

### Test 4.2: Raise More Than Opponent Has

**Objective**: Test raise when opponent can't match

- [ ] Create room, start game
- [ ] Alice check, Bob raise $995 (leaves Bob with $5)
- [ ] Alice can only call up to Bob's total bet
- [ ] Verify proper handling

### Test 4.3: Check When Bet Required

**Objective**: Verify check validation

- [ ] Create room, start game
- [ ] Alice check, Bob raise $50
- [ ] Try Alice check (should fail, must call/raise/fold)
- [ ] Verify error handling

### Test 4.4: Multiple Hands in Sequence

**Objective**: Test continuous play

- [ ] Play 5 complete hands back-to-back
- [ ] Verify dealer button rotates
- [ ] Verify blinds post correctly each hand
- [ ] Verify chip conservation across all hands
- [ ] Track chip totals: hand start → hand end

---

## Test Suite 5: Turn/Round Advancement

### Test 5.1: Turn Skipping Check

**Objective**: Verify turn doesn't skip players

- [ ] Create room, start game
- [ ] PRE_FLOP: Verify Alice → Bob → Alice (if raises occur)
- [ ] Track currentPlayerTurn ID changes
- [ ] Verify correct player sequence

### Test 5.2: Round Progression

**Objective**: Test each betting round triggers correctly

- [ ] Verify PRE_FLOP → FLOP (3 cards dealt)
- [ ] Verify FLOP → TURN (4th card dealt)
- [ ] Verify TURN → RIVER (5th card dealt)
- [ ] Verify RIVER → SHOWDOWN
- [ ] Count community cards at each stage

### Test 5.3: Early Showdown (All-In)

**Objective**: Test immediate showdown when no more betting

- [ ] Both players all-in PRE_FLOP
- [ ] Verify all 5 community cards dealt immediately
- [ ] Verify hand goes straight to SHOWDOWN

---

## Test Suite 6: Chip Accounting

### Test 6.1: Chip Conservation Throughout Hand

**Objective**: Verify no chips lost/created

- [ ] Before each action: Calculate total chips
- [ ] Formula: `Σ(player.chips + player.currentBet) = 2000`
- [ ] Track through: Start → Blinds → Betting → Showdown → New Hand

### Test 6.2: Pot Calculation

**Objective**: Verify pot updates correctly

- [ ] Start pot = $30 (blinds)
- [ ] After each bet/call/raise: pot += amount
- [ ] Verify pot matches sum of all player bets
- [ ] After showdown: winner.chips += pot

### Test 6.3: Blind Posting

**Objective**: Test blind mechanics

- [ ] Hand 1: Alice (dealer/BB $20), Bob (SB $10)
- [ ] Hand 2: Bob (dealer/BB $20), Alice (SB $10)
- [ ] Verify correct blind positions
- [ ] Verify chips deducted before first action

---

## Test Suite 7: Winner Determination

### Test 7.1: High Card Win

**Objective**: Test weakest hand type

- [ ] Both check through to showdown
- [ ] Player with higher card wins
- [ ] Verify hand evaluation

### Test 7.2: Pair vs High Card

**Objective**: Test basic hand comparison

- [ ] Check cards to ensure different hand strengths
- [ ] Verify correct winner
- [ ] Check pot distribution

### Test 7.3: Tie (Split Pot)

**Objective**: Test tied hands

- [ ] Both players make same hand (e.g., both use board pair)
- [ ] Verify pot split evenly
- [ ] Verify remainder handling (if pot is odd)

### Test 7.4: Win by Fold

**Objective**: Test fold victory

- [ ] Alice fold before showdown
- [ ] Verify Bob wins without hand evaluation
- [ ] Verify pot awarded immediately

---

## Test Suite 8: UI/UX Validation

### Test 8.1: Real-Time Updates

**Objective**: Test UI reflects game state

- [ ] Verify "Your Chips" displays correct amount
- [ ] Verify pot updates in real-time
- [ ] Verify current round displays correctly
- [ ] Verify player turn highlighting

### Test 8.2: Button States

**Objective**: Test action buttons appear correctly

- [ ] When can check: "Check" button shows
- [ ] When must call: "Call $X" button shows correct amount
- [ ] When can raise: "Raise" input enabled
- [ ] When not your turn: buttons disabled

### Test 8.3: Card Display

**Objective**: Test card rendering

- [ ] Hole cards visible only to owner
- [ ] Community cards visible to all
- [ ] Cards display at correct times (FLOP/TURN/RIVER)

---

## Test Execution Order

1. **Run Test Suite 1** (Basic Actions) - Establish baseline functionality
2. **Run Test Suite 2** (Raises) - Test betting escalation
3. **Run Test Suite 3** (All-Ins) - Test edge scenarios
4. **Run Test Suite 4** (Edge Cases) - Verify error handling
5. **Run Test Suite 6** (Chip Accounting) - Verify money integrity
6. **Run Test Suite 7** (Winner Determination) - Test game logic
7. **Run Test Suite 5** (Turn/Round) - Already mostly verified, final check
8. **Run Test Suite 8** (UI) - Visual verification

---

## Test Reporting Template

```
TEST: [Test Name]
STATUS: ✅ PASS / ❌ FAIL
SETUP:
  - Room: [ID]
  - Players: Alice ($1000) vs Bob ($1000)

ACTIONS:
  1. [Action description]
  2. [Action description]

EXPECTED:
  - [Expected outcome]

ACTUAL:
  - [Actual outcome]

CHIP CONSERVATION:
  - Start: $2000
  - End: $2000
  - ✅ CONSERVED / ❌ DISCREPANCY: $[amount]

NOTES:
  - [Any observations]
```

---

## Automated Test Helper Script

Location: `poker-server/test-helper.js`

```javascript
// Helper functions to verify game state
function verifyChipConservation(room) {
  const total = room.players.reduce(
    (sum, p) => sum + p.chips + p.currentBet,
    0,
  );
  return {
    conserved: total === 2000,
    total,
    breakdown: room.players.map((p) => ({
      name: p.name,
      chips: p.chips,
      bet: p.currentBet,
      total: p.chips + p.currentBet,
    })),
  };
}
```

---

## Success Criteria

- ✅ All chip conservation checks pass
- ✅ No errors in backend logs
- ✅ UI updates reflect game state accurately
- ✅ Winner determination is correct
- ✅ New hands start automatically
- ✅ All betting actions work as expected

# Deterministic E2E Testing with Playwright

## Overview

This poker application now supports **deterministic end-to-end testing** using Playwright. Instead of relying on random card shuffling, tests can inject predetermined decks to test exact scenarios reproducibly.

## How It Works

### 1. Test Mode
Set the `TEST_MODE` environment variable to enable test deck functionality:

```bash
export TEST_MODE=true
npm run start:dev
```

### 2. Test Deck Injection
Tests use the `setTestDeck` WebSocket event to inject predetermined cards:

```typescript
const testDeck: Card[] = [
  { suit: 'hearts', rank: 'A' },   // Player1 hole card 1
  { suit: 'spades', rank: 'K' },   // Player2 hole card 1
  { suit: 'diamonds', rank: 'A' }, // Player1 hole card 2
  { suit: 'hearts', rank: 'Q' },   // Player2 hole card 2
  { suit: 'clubs', rank: '2' },    // Flop card 1
  { suit: 'diamonds', rank: '5' }, // Flop card 2
  { suit: 'spades', rank: '8' },   // Flop card 3
  { suit: 'hearts', rank: 'J' },   // Turn card
  { suit: 'diamonds', rank: '3' }, // River card
];

socket.emit('setTestDeck', { roomId, deck: testDeck });
```

### 3. Deck Order
Cards are dealt in order from the test deck:
1. **Hole cards**: Alternating between players (P1, P2, P1, P2...)
2. **Flop**: Next 3 cards
3. **Turn**: Next 1 card
4. **River**: Next 1 card

## Running Tests

### Run all E2E tests:
```bash
cd poker-server
npm run test:e2e:playwright
```

### Run with UI (interactive):
```bash
npm run test:e2e:ui
```

### Run specific test:
```bash
TEST_MODE=true npx playwright test pair-vs-highcard
```

## Example Tests

### ✅ Pair vs High Card
- **File**: `test/e2e/pair-vs-highcard.spec.ts`
- **Scenario**: Player1 has AA, Player2 has KQ
- **Expected**: Player1 wins with pair of Aces

### ✅ All-In Scenario
- **File**: `test/e2e/allin-scenario.spec.ts`
- **Scenario**: Both players all-in pre-flop
- **Expected**: All 5 community cards dealt immediately

### ✅ Flush vs Straight
- **File**: `test/e2e/flush-vs-straight.spec.ts`
- **Scenario**: Player1 makes flush, Player2 makes straight
- **Expected**: Flush wins

## Writing New Tests

1. **Create test file** in `test/e2e/`
2. **Define predetermined deck** with exact cards
3. **Set test deck** via WebSocket event
4. **Play through hand** with deterministic actions
5. **Assert expected outcomes** (winner, chip conservation, hand ranks)

### Template:
```typescript
import { test, expect } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { Card } from 'poker-types';

test.describe('My Test', () => {
  let player1Socket: Socket;
  let player2Socket: Socket;
  let roomId: string;

  test('should win with better hand', async () => {
    const testDeck: Card[] = [
      // Define your cards here
    ];

    // Setup sockets, create room, set test deck
    // Play through hand
    // Assert results
  });
});
```

## Benefits

✅ **Reproducible**: Same cards = same outcome every time  
✅ **Comprehensive**: Test all hand matchups (pair vs high card, flush vs straight, etc.)  
✅ **Fast**: No need to wait for random shuffles to produce desired scenarios  
✅ **Reliable**: Eliminates flakiness from randomness  
✅ **Debugging**: Exact scenarios can be recreated for bug investigation  

## Architecture

### Backend Changes
- **TestDeckService**: Manages predetermined decks per room
- **HandService**: Uses test deck when available (falls back to random)
- **EventsGateway**: Exposes `setTestDeck` event (TEST_MODE only)

### Test Files
- **playwright.config.ts**: Playwright configuration
- **test/e2e/*.spec.ts**: E2E test scenarios

## Security

⚠️ **Test mode is disabled in production**. The `setTestDeck` event only works when `TEST_MODE=true`.

## Chip Conservation

All tests verify chip conservation:
```typescript
const totalChips = result.players.reduce(
  (sum: number, p: any) => sum + p.chips,
  0,
);
expect(totalChips).toBe(2000);
```

This ensures no chips are lost or created during gameplay.

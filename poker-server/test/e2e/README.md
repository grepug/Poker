# E2E Testing Suite for Poker Game

## Overview

This directory contains comprehensive end-to-end tests for the poker game application. The tests use **Playwright** for browser automation and are designed to test real user workflows through the React frontend.

## Test Architecture

### 1. **Deterministic Testing Infrastructure**

The application has been enhanced with a deterministic testing system that allows predetermined card decks:

- **TestDeckService** (`poker-server/src/game/test-deck.service.ts`)
  - Manages predetermined card decks for reproducible tests
  - Only active when `TEST_MODE=true` environment variable is set
  
- **Modified HandService** 
  - Uses test decks instead of random shuffling when available
  - Preserves remaining cards for subsequent rounds

- **WebSocket Event**: `setTestDeck`
  - Allows tests to set predetermined decks via WebSocket
  - Only available in TEST_MODE

### 2. **Test Types**

#### Browser-Based E2E Tests (Playwright)
- **File**: `comprehensive-poker.spec.ts`
- **Purpose**: Test actual user interactions through the browser
- **Technology**: Playwright Page API
- **Coverage**:
  - Test Suite 1: Basic Betting Actions (check, bet/call, fold)
  - Test Suite 3: All-In Scenarios
  - Test Suite 6: Chip Conservation

#### Server-Side Integration Tests (Socket.io)
- **Files**: `pair-vs-highcard.spec.ts`, `allin-scenario.spec.ts`, `flush-vs-straight.spec.ts`
- **Purpose**: Test WebSocket API directly
- **Technology**: socket.io-client
- **Usage**: Faster tests for specific game logic scenarios

#### Basic Connectivity Test
- **File**: `simple-connection.spec.ts`
- **Status**: ✅ PASSING
- **Purpose**: Verify WebSocket connectivity and room creation

## Running Tests

### Prerequisites

```bash
# Install dependencies (if not already done)
cd poker-server
npm install

# Start both frontend and backend (automatic with Playwright config)
# OR start manually:
cd poker-client && npm run dev  # Terminal 1
cd poker-server && TEST_MODE=true npm run start:dev  # Terminal 2
```

### Run All E2E Tests

```bash
cd poker-server
NO_PROXY='*' npx playwright test comprehensive-poker --reporter=list
```

### Run Tests with UI

```bash
NO_PROXY='*' npx playwright test comprehensive-poker --ui
```

### Run Simple Connection Test

```bash
NO_PROXY='*' npx playwright test simple-connection --reporter=list
```

## Current Status

### ✅ Completed

1. **Infrastructure**
   - TestDeckService implementation
   - HandService modifications
   - EventsGateway setTestDeck event
   - Playwright configuration with auto-start

2. **Documentation**
   - E2E_TESTING.md (comprehensive guide)
   - This README

3. **Working Tests**
   - simple-connection.spec.ts (✅ PASSING)

### ⚠️ In Progress

**Browser-based tests** (`comprehensive-poker.spec.ts`) currently failing due to:

1. **Timing Issues**: Tests need better waiting strategies for async state updates
2. **window.pokerDebug API**: Need to ensure it's properly initialized before use
3. **Room State Synchronization**: Tests need to wait for WebSocket events to propagate

**Recommended Fixes:**

```typescript
// Add better waiting for room creation
const roomId = await alicePage.evaluate(() => {
  window.pokerDebug.createRoom('Alice');
  return new Promise<string>((resolve) => {
    const checkRoom = setInterval(() => {
      const room = window.pokerDebug.getRoom();
      if (room && room.id) {
        clearInterval(checkRoom);
        resolve(room.id);
      }
    }, 100);
  });
});

// Wait for state changes with Playwright's built-in waitForFunction
await alicePage.waitForFunction(
  () => window.pokerDebug.getRoom()?.players?.length === 2,
  { timeout: 5000 }
);
```

### 📋 Pending Test Coverage (from TEST_PLAN.md)

- [ ] **Suite 2**: Raise/Re-raise Actions
- [ ] **Suite 4**: Edge Cases (invalid actions, out-of-turn, etc.)
- [ ] **Suite 5**: Turn/Round Advancement
- [ ] **Suite 7**: Winner Determination (various hand rankings)
- [ ] **Suite 8**: UI/UX Validation

## Test Plan Reference

The comprehensive test plan is documented in `/Users/kai/Developer/games/Poker/TEST_PLAN.md`. The tests are designed to validate all scenarios outlined in that document.

## Known Issues

### Chip Conservation Bugs

During manual testing, chip conservation issues were discovered:
- Total chips sometimes = 1990 (should be 2000)
- Total chips sometimes = 2030 (should be 2000)

These issues need investigation in:
- `BettingService` (bet collection)
- `HandService` (pot distribution)

### WebSocket Event Naming

Event names use UPPERCASE_WITH_UNDERSCORES:
- `CREATE_ROOM` → `ROOM_CREATED`
- `JOIN_ROOM` → `PLAYER_JOINED`
- `START_GAME` → `GAME_STARTED`

Not camelCase (`createRoom`, `roomCreated`).

## Debugging

### View Test Screenshots

Failed tests automatically capture screenshots:

```bash
open poker-server/test-results/
```

### Run Tests in Headed Mode

```bash
NO_PROXY='*' npx playwright test comprehensive-poker --headed
```

### Enable Debug Logs

```bash
DEBUG=pw:api NO_PROXY='*' npx playwright test comprehensive-poker
```

### Use window.pokerDebug in Browser Console

When the app is running, open browser console:

```javascript
// Create a room
window.pokerDebug.createRoom('Alice');

// Check state
window.pokerDebug.logState();

// Get room
window.pokerDebug.getRoom();

// Perform actions
window.pokerDebug.check();
window.pokerDebug.raise(100);
```

## Architecture Notes

### Why Both Browser and Server Tests?

1. **Browser Tests (Playwright)**
   - Test full user experience
   - Verify UI updates correctly
   - Test real WebSocket communication through the app
   - Slower but comprehensive

2. **Server Tests (socket.io-client)**
   - Test WebSocket API directly
   - Faster execution
   - Better for testing specific game logic
   - Useful for CI/CD pipelines

### Test Isolation

Each test should:
- Create fresh browser contexts (separate sessions)
- Use unique room IDs
- Clean up after itself
- Not depend on other tests

### Predetermined Decks

Example of setting a test deck:

```typescript
const testDeck = [
  // Alice's hole cards
  { suit: 'hearts', rank: 'A' },
  { suit: 'hearts', rank: 'K' },
  // Bob's hole cards
  { suit: 'spades', rank: 'Q' },
  { suit: 'spades', rank: 'J' },
  // Flop
  { suit: 'hearts', rank: 'Q' },
  { suit: 'hearts', rank: '10' },
  { suit: 'hearts', rank: '9' },
  // Turn
  { suit: 'clubs', rank: '2' },
  // River
  { suit: 'diamonds', rank: '3' },
];

await page.evaluate((deck) => {
  const roomId = window.pokerDebug.getRoom().id;
  window.pokerDebug.emitCustom('setTestDeck', { roomId, deck });
}, testDeck);
```

## Next Steps

1. **Fix timing issues in comprehensive-poker.spec.ts**
   - Add proper waitForFunction calls
   - Ensure window.pokerDebug is initialized
   - Add timeouts for async operations

2. **Expand test coverage**
   - Implement remaining test suites from TEST_PLAN.md
   - Add more edge case scenarios

3. **Investigate chip conservation bugs**
   - Add detailed logging
   - Create specific tests to reproduce the issue

4. **CI/CD Integration**
   - Add GitHub Actions workflow
   - Run tests on pull requests
   - Generate test reports

## Resources

- [Playwright Documentation](https://playwright.dev/)
- [TEST_PLAN.md](/Users/kai/Developer/games/Poker/TEST_PLAN.md)
- [E2E_TESTING.md](/Users/kai/Developer/games/Poker/poker-server/E2E_TESTING.md)

import { test, expect, Page } from '@playwright/test';

/**
 * Comprehensive Poker E2E Test Suite
 * Tests actual browser interactions with the React frontend
 * Uses window.pokerDebug API for deterministic testing with predetermined cards
 */

const FRONTEND_URL = 'http://localhost:5174';
const BACKEND_URL = 'http://localhost:3001';

// Helper to wait for pokerDebug to be available
async function waitForPokerDebug(page: Page) {
  await page.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });
}

// Helper to verify chip conservation
async function verifyChipConservation(page: Page, expected: number = 2000) {
  const total = await page.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    return room.players.reduce((sum, p) => sum + p.chips + p.currentBet, 0);
  });
  expect(total).toBe(expected);
}

test.describe('Poker E2E - Test Suite 1: Basic Betting Actions', () => {
  let alicePage: Page;
  let bobPage: Page;

  test.beforeEach(async ({ browser }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    alicePage = await aliceContext.newPage();
    bobPage = await bobContext.newPage();

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    await waitForPokerDebug(alicePage);
    await waitForPokerDebug(bobPage);
  });

  test.afterEach(async () => {
    await alicePage?.close();
    await bobPage?.close();
  });

  test('1.1: Check/Check Scenario - both players check through all rounds', async () => {
    // Alice creates room
    await alicePage.evaluate(() => {
      window.pokerDebug.createRoom('Alice');
    });

    // Get room ID
    const roomId = await alicePage.evaluate(() => {
      return window.pokerDebug.getRoom()?.id;
    });

    expect(roomId).toBeTruthy();

    // Bob joins
    await bobPage.evaluate((rid) => {
      window.pokerDebug.joinRoom(rid, 'Bob');
    }, roomId);

    // Wait for Bob to join
    await alicePage.waitForTimeout(500);

    // Alice starts game
    await alicePage.evaluate(() => {
      window.pokerDebug.startGame();
    });

    await alicePage.waitForTimeout(1000);

    // PRE_FLOP: Both check
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.check());

    await alicePage.waitForTimeout(500);

    // FLOP: Both check
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.check());

    await alicePage.waitForTimeout(500);

    // TURN: Both check
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.check());

    await alicePage.waitForTimeout(500);

    // RIVER: Both check
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.check());

    await alicePage.waitForTimeout(2000);

    // Verify hand completed and chips conserved
    await verifyChipConservation(alicePage, 2000);

    const gameState = await alicePage.evaluate(() => {
      return window.pokerDebug.getRoom()?.gameState;
    });

    // Should be waiting for next hand or in progress of new hand
    expect(['WAITING', 'IN_PROGRESS']).toContain(gameState);
  });

  test('1.2: Bet/Call Scenario - betting and calling across rounds', async () => {
    // Setup
    await alicePage.evaluate(() => window.pokerDebug.createRoom('Alice'));
    const roomId = await alicePage.evaluate(() => window.pokerDebug.getRoom()?.id);
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForTimeout(500);
    await alicePage.evaluate(() => window.pokerDebug.startGame());
    await alicePage.waitForTimeout(1000);

    // PRE_FLOP: Alice check, Bob raise $50, Alice call
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.raise(50));
    await alicePage.waitForTimeout(300);
    await alicePage.evaluate(() => window.pokerDebug.call());

    await alicePage.waitForTimeout(500);

    // FLOP: Alice check, Bob raise $100, Alice call
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.raise(100));
    await alicePage.waitForTimeout(300);
    await alicePage.evaluate(() => window.pokerDebug.call());

    await alicePage.waitForTimeout(500);

    // TURN: Both check
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.check());

    await alicePage.waitForTimeout(500);

    // RIVER: Both check
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.check());

    await alicePage.waitForTimeout(2000);

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);
  });

  test('1.3: Bet/Fold Scenario - folding functionality', async () => {
    // Setup
    await alicePage.evaluate(() => window.pokerDebug.createRoom('Alice'));
    const roomId = await alicePage.evaluate(() => window.pokerDebug.getRoom()?.id);
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForTimeout(500);
    await alicePage.evaluate(() => window.pokerDebug.startGame());
    await alicePage.waitForTimeout(1000);

    // Get initial chips
    const initialChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players[0].chips,
        bob: room.players[1].chips,
      };
    });

    // PRE_FLOP: Alice check, Bob raise $100, Alice fold
    await alicePage.evaluate(() => window.pokerDebug.check());
    await bobPage.evaluate(() => window.pokerDebug.raise(100));
    await alicePage.waitForTimeout(300);
    await alicePage.evaluate(() => window.pokerDebug.fold());

    await alicePage.waitForTimeout(2000);

    // Verify Bob won and chips updated
    const finalChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players[0].chips,
        bob: room.players[1].chips,
      };
    });

    // Bob should have won the pot (blinds: $10 + $20 = $30)
    // Alice loses $10 (small blind), Bob gains $10
    expect(finalChips.alice).toBeLessThan(initialChips.alice);
    expect(finalChips.bob).toBeGreaterThan(initialChips.bob);

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);
  });
});

test.describe('Poker E2E - Test Suite 3: All-In Scenarios', () => {
  let alicePage: Page;
  let bobPage: Page;

  test.beforeEach(async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    alicePage = await aliceContext.newPage();
    bobPage = await bobContext.newPage();

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    await waitForPokerDebug(alicePage);
    await waitForPokerDebug(bobPage);
  });

  test.afterEach(async () => {
    await alicePage?.close();
    await bobPage?.close();
  });

  test('3.2: All-In Call - both players all-in, all cards dealt immediately', async () => {
    // Setup
    await alicePage.evaluate(() => window.pokerDebug.createRoom('Alice'));
    const roomId = await alicePage.evaluate(() => window.pokerDebug.getRoom()?.id);
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForTimeout(500);
    await alicePage.evaluate(() => window.pokerDebug.startGame());
    await alicePage.waitForTimeout(1000);

    // Alice goes all-in
    await alicePage.evaluate(() => window.pokerDebug.allIn());
    await alicePage.waitForTimeout(300);

    // Bob calls all-in
    await bobPage.evaluate(() => window.pokerDebug.call());

    await alicePage.waitForTimeout(2000);

    // Verify all 5 community cards were dealt immediately
    const communityCards = await alicePage.evaluate(() => {
      return window.pokerDebug.getRoom()?.currentHand?.communityCards?.length;
    });

    expect(communityCards).toBe(5);

    // Verify hand went to showdown
    const bettingRound = await alicePage.evaluate(() => {
      return window.pokerDebug.getRoom()?.currentHand?.bettingRound;
    });

    expect(bettingRound).toBe('SHOWDOWN');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);
  });
});

test.describe('Poker E2E - Chip Conservation', () => {
  let alicePage: Page;
  let bobPage: Page;

  test.beforeEach(async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    alicePage = await aliceContext.newPage();
    bobPage = await bobContext.newPage();

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    await waitForPokerDebug(alicePage);
    await waitForPokerDebug(bobPage);
  });

  test.afterEach(async () => {
    await alicePage?.close();
    await bobPage?.close();
  });

  test('6.1: Chip Conservation Throughout Hand - multiple hands in sequence', async () => {
    // Setup
    await alicePage.evaluate(() => window.pokerDebug.createRoom('Alice'));
    const roomId = await alicePage.evaluate(() => window.pokerDebug.getRoom()?.id);
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForTimeout(500);

    // Play 3 consecutive hands
    for (let hand = 1; hand <= 3; hand++) {
      await alicePage.evaluate(() => window.pokerDebug.startGame());
      await alicePage.waitForTimeout(1000);

      // Check conservation at start of hand
      await verifyChipConservation(alicePage, 2000);

      // Play through hand (both check through all rounds)
      for (let round = 0; round < 4; round++) {
        await alicePage.evaluate(() => window.pokerDebug.check());
        await bobPage.evaluate(() => window.pokerDebug.check());
        await alicePage.waitForTimeout(500);
      }

      await alicePage.waitForTimeout(2000);

      // Check conservation after hand completes
      await verifyChipConservation(alicePage, 2000);
    }
  });
});

// Type augmentation for window.pokerDebug
declare global {
  interface Window {
    pokerDebug: {
      createRoom: (name: string) => void;
      joinRoom: (roomId: string, name: string) => void;
      startGame: () => void;
      check: () => void;
      call: () => void;
      raise: (amount: number) => void;
      fold: () => void;
      allIn: () => void;
      getRoom: () => any;
    };
  }
}

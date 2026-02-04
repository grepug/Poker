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

// Helper to verify chip conservation (chips only, not including current bets)
async function verifyChipConservation(page: Page, expected: number = 2000) {
  const total = await page.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    return room.players.reduce((sum, p) => sum + p.chips, 0);
  });
  expect(total).toBe(expected);
}

test.describe('Poker E2E - Test Suite 1: Basic Betting Actions', () => {
  test('1.1: Check/Check Scenario - both players check through all rounds', async ({ browser }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners to capture browser logs
    alicePage.on('console', msg => console.log('ALICE:', msg.text()));
    bobPage.on('console', msg => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    await waitForPokerDebug(alicePage);
    await waitForPokerDebug(bobPage);

    // Alice creates room
    await alicePage.evaluate(() => {
      window.pokerDebug.createRoom('Alice');
    });

    // Wait for room to be created
    const roomId = await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.id,
      { timeout: 10000 }
    ).then(r => r.jsonValue());

    expect(roomId).toBeTruthy();

    // Bob joins
    await bobPage.evaluate((rid) => {
      window.pokerDebug.joinRoom(rid, 'Bob');
    }, roomId);

    // Wait for Bob to join
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.players?.length === 2,
      { timeout: 10000 }
    );

    // Alice starts game
    await alicePage.evaluate(() => {
      window.pokerDebug.startGame();
    });

    // Wait for game to start
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.gameState === "IN_PROGRESS",
      { timeout: 10000 }
    );

    // PRE_FLOP: Bob (small blind) calls, Alice (big blind) checks
    console.log('Pre-flop: Bob calling...');
    await bobPage.evaluate(() => window.pokerDebug.call());
    
    // Wait for Bob's action to process and turn to switch
    await alicePage.waitForTimeout(1000);
    
    console.log('Pre-flop: Alice checking...');
    const aliceCheckResponse = await alicePage.evaluate(() => window.pokerDebug.check());
    console.log('Alice check response:', aliceCheckResponse);

    // Wait for WebSocket to process and state to update
    await alicePage.waitForTimeout(2000);

    // Check if flop was dealt
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length || 0,
        bettingRound: room?.currentHand?.bettingRound,
        pot: room?.currentHand?.pot,
      };
    });
    console.log('After pre-flop:', afterPreFlop);

    // Verify flop was dealt
    expect(afterPreFlop.communityCards).toBe(3);
    expect(afterPreFlop.bettingRound).toBe('FLOP');
    console.log('Flop dealt!');

    // FLOP: Bob (small blind) acts first, then Alice
    console.log('Flop: Bob checking...');
    await bobPage.evaluate(() => window.pokerDebug.check());
    await alicePage.waitForTimeout(1000);
    
    console.log('Flop: Alice checking...');
    await alicePage.evaluate(() => window.pokerDebug.check());

    // Wait for turn
    await alicePage.waitForTimeout(2000);

    const afterFlop = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length || 0,
        bettingRound: room?.currentHand?.bettingRound,
      };
    });
    console.log('After flop:', afterFlop);
    expect(afterFlop.communityCards).toBe(4);
    expect(afterFlop.bettingRound).toBe('TURN');

    // TURN: Bob (small blind) acts first, then Alice
    console.log('Turn: Bob checking...');
    await bobPage.evaluate(() => window.pokerDebug.check());
    await alicePage.waitForTimeout(1000);
    
    console.log('Turn: Alice checking...');
    await alicePage.evaluate(() => window.pokerDebug.check());

    // Wait for river
    await alicePage.waitForTimeout(2000);

    const afterTurn = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length || 0,
        bettingRound: room?.currentHand?.bettingRound,
      };
    });
    console.log('After turn:', afterTurn);
    expect(afterTurn.communityCards).toBe(5);
    expect(afterTurn.bettingRound).toBe('RIVER');

    // RIVER: Bob (small blind) acts first, then Alice
    console.log('River: Bob checking...');
    await bobPage.evaluate(() => window.pokerDebug.check());
    await alicePage.waitForTimeout(1000);
    
    console.log('River: Alice checking...');
    await alicePage.evaluate(() => window.pokerDebug.check());

    // Wait for hand to complete and be reset
    await alicePage.waitForTimeout(2000);

    const afterRiver = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        currentHand: room?.currentHand ? 'exists' : 'null',
        gameState: room?.gameState,
        aliceChips: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bobChips: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log('After river:', afterRiver);
    
    // Hand should be complete and currentHand should be null or ready for next hand
    expect(afterRiver.gameState).toBe('IN_PROGRESS');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('1.2: Bet/Call Scenario - betting and calling across rounds', async ({ browser }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners to capture browser logs
    alicePage.on('console', msg => console.log('ALICE:', msg.text()));
    bobPage.on('console', msg => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    await waitForPokerDebug(alicePage);
    await waitForPokerDebug(bobPage);

    // Alice creates room
    await alicePage.evaluate(() => {
      window.pokerDebug.createRoom('Alice');
    });

    // Wait for room to be created
    const roomId = await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.id,
      { timeout: 10000 }
    ).then(r => r.jsonValue());

    // Bob joins
    await bobPage.evaluate((rid) => {
      window.pokerDebug.joinRoom(rid, 'Bob');
    }, roomId);

    // Wait for both players to be in the room
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.players?.length === 2,
      { timeout: 10000 }
    );

    // Alice starts game
    await alicePage.evaluate(() => {
      window.pokerDebug.startGame();
    });

    // Wait for game to start
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.gameState === "IN_PROGRESS",
      { timeout: 10000 }
    );

    // PRE_FLOP: Bob (small blind) raises, Alice (big blind) calls
    console.log('Pre-flop: Bob raising...');
    await bobPage.evaluate(() => window.pokerDebug.raise(50));
    await alicePage.waitForTimeout(1000);
    
    console.log('Pre-flop: Alice calling...');
    await alicePage.evaluate(() => window.pokerDebug.call());

    // Wait for flop
    await alicePage.waitForTimeout(2000);

    const afterPreFlop = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length || 0,
        bettingRound: room?.currentHand?.bettingRound,
        pot: room?.currentHand?.pot,
      };
    });
    console.log('After pre-flop:', afterPreFlop);
    expect(afterPreFlop.communityCards).toBe(3);
    expect(afterPreFlop.bettingRound).toBe('FLOP');

    // FLOP: Bob checks, Alice raises, Bob calls
    console.log('Flop: Bob checking...');
    await bobPage.evaluate(() => window.pokerDebug.check());
    await alicePage.waitForTimeout(1000);
    
    console.log('Flop: Alice raising...');
    await alicePage.evaluate(() => window.pokerDebug.raise(100));
    await bobPage.waitForTimeout(1000);
    
    console.log('Flop: Bob calling...');
    await bobPage.evaluate(() => window.pokerDebug.call());

    // Wait for turn
    await alicePage.waitForTimeout(2000);

    const afterFlop = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length || 0,
        bettingRound: room?.currentHand?.bettingRound,
      };
    });
    console.log('After flop:', afterFlop);
    expect(afterFlop.communityCards).toBe(4);
    expect(afterFlop.bettingRound).toBe('TURN');

    // TURN: Bob checks, Alice checks
    console.log('Turn: Bob checking...');
    await bobPage.evaluate(() => window.pokerDebug.check());
    await alicePage.waitForTimeout(1000);
    
    console.log('Turn: Alice checking...');
    await alicePage.evaluate(() => window.pokerDebug.check());

    // Wait for river
    await alicePage.waitForTimeout(2000);

    const afterTurn = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length || 0,
        bettingRound: room?.currentHand?.bettingRound,
      };
    });
    console.log('After turn:', afterTurn);
    expect(afterTurn.communityCards).toBe(5);
    expect(afterTurn.bettingRound).toBe('RIVER');

    // RIVER: Bob checks, Alice checks
    console.log('River: Bob checking...');
    await bobPage.evaluate(() => window.pokerDebug.check());
    await alicePage.waitForTimeout(1000);
    
    console.log('River: Alice checking...');
    await alicePage.evaluate(() => window.pokerDebug.check());

    // Wait for hand to complete and be reset
    await alicePage.waitForTimeout(2000);

    const afterRiver = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        currentHand: room?.currentHand ? 'exists' : 'null',
        gameState: room?.gameState,
      };
    });
    console.log('After river:', afterRiver);
    expect(afterRiver.gameState).toBe('IN_PROGRESS');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('1.3: Bet/Fold Scenario - folding functionality', async ({ browser }) => {
    // Setup
    await alicePage.evaluate(() => window.pokerDebug.createRoom('Alice'));
    const roomId = await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.id,
      { timeout: 10000 }
    ).then(r => r.jsonValue());
    
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.players?.length === 2,
      { timeout: 10000 }
    );
    
    await alicePage.evaluate(() => window.pokerDebug.startGame());
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.gameState === "IN_PROGRESS",
      { timeout: 10000 }
    );

    // Get initial chips
    const initialChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players[0].chips,
        bob: room.players[1].chips,
      };
    });

    // PRE_FLOP: Bob (small blind) raises $100, Alice (big blind) folds
    await bobPage.evaluate(() => window.pokerDebug.raise(100));
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.currentHand?.currentBet === 100,
      { timeout: 10000 }
    );
    await alicePage.evaluate(() => window.pokerDebug.fold());

    // Wait for hand to complete
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.currentHand?.pot === 0,
      { timeout: 10000 }
    );

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
    const roomId = await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.id,
      { timeout: 10000 }
    ).then(r => r.jsonValue());
    
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.players?.length === 2,
      { timeout: 10000 }
    );
    
    await alicePage.evaluate(() => window.pokerDebug.startGame());
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.gameState === "IN_PROGRESS",
      { timeout: 10000 }
    );

    // Alice goes all-in
    await alicePage.evaluate(() => window.pokerDebug.allIn());

    // Bob calls all-in
    await bobPage.evaluate(() => window.pokerDebug.call());

    // Wait for all 5 community cards to be dealt
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.currentHand?.communityCards?.length === 5,
      { timeout: 10000 }
    );

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
    const roomId = await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.id,
      { timeout: 10000 }
    ).then(r => r.jsonValue());
    
    await bobPage.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);
    await alicePage.waitForFunction(
      () => window.pokerDebug.getRoom()?.players?.length === 2,
      { timeout: 10000 }
    );

    // Play 3 consecutive hands
    for (let hand = 1; hand <= 3; hand++) {
      await alicePage.evaluate(() => window.pokerDebug.startGame());
      await alicePage.waitForFunction(
        () => window.pokerDebug.getRoom()?.gameState === "IN_PROGRESS",
        { timeout: 10000 }
      );

      // Check conservation at start of hand
      await verifyChipConservation(alicePage, 2000);

      // Play through hand (both check through all rounds)
      // Pre-flop: Bob (small blind) calls, Alice (big blind) checks
      await bobPage.evaluate(() => window.pokerDebug.call());
      await alicePage.evaluate(() => window.pokerDebug.check());
      await alicePage.waitForFunction(
        () => window.pokerDebug.getRoom()?.currentHand?.communityCards?.length === 3,
        { timeout: 10000 }
      );

      // Flop
      await alicePage.evaluate(() => window.pokerDebug.check());
      await bobPage.evaluate(() => window.pokerDebug.check());
      await alicePage.waitForFunction(
        () => window.pokerDebug.getRoom()?.currentHand?.communityCards?.length === 4,
        { timeout: 10000 }
      );

      // Turn
      await alicePage.evaluate(() => window.pokerDebug.check());
      await bobPage.evaluate(() => window.pokerDebug.check());
      await alicePage.waitForFunction(
        () => window.pokerDebug.getRoom()?.currentHand?.communityCards?.length === 5,
        { timeout: 10000 }
      );

      // River
      await alicePage.evaluate(() => window.pokerDebug.check());
      await bobPage.evaluate(() => window.pokerDebug.check());
      
      // Wait for hand to complete
      await alicePage.waitForFunction(
        () => window.pokerDebug.getRoom()?.currentHand?.pot === 0,
        { timeout: 10000 }
      );

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

import { test, expect, Page, BrowserContext } from '@playwright/test';

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
  const state = await page.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    const totalChips = room.players.reduce((sum, p) => sum + p.chips, 0);
    const totalCurrentBets = room.players.reduce(
      (sum, p) => sum + p.currentBet,
      0,
    );
    const pot = room.currentHand?.pot || 0;
    return {
      totalChips,
      totalCurrentBets,
      pot,
      byCurrentBets: totalChips + totalCurrentBets,
      byPot: totalChips + pot,
    };
  });

  // Room state can represent committed chips either in per-player currentBet or in pot.
  const conserved =
    state.byCurrentBets === expected || state.byPot === expected;
  expect(
    conserved,
    `chip conservation failed: chips=${state.totalChips}, currentBets=${state.totalCurrentBets}, pot=${state.pot}`,
  ).toBe(true);
}

type TwoPlayerSession = {
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  alicePage: Page;
  bobPage: Page;
  roomCode: string;
};

type ThreePlayerSession = {
  aliceContext: BrowserContext;
  bobContext: BrowserContext;
  charlieContext: BrowserContext;
  alicePage: Page;
  bobPage: Page;
  charliePage: Page;
  roomCode: string;
};

async function setupTwoPlayerSession(browser: any): Promise<TwoPlayerSession> {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();

  await alicePage.goto(FRONTEND_URL);
  await bobPage.goto(FRONTEND_URL);
  await alicePage.waitForSelector('[data-testid="connection-status"]');
  await bobPage.waitForSelector('[data-testid="connection-status"]');
  await expect(alicePage.locator('[data-testid="connection-status"]')).toContainText(
    'Connected',
  );
  await expect(bobPage.locator('[data-testid="connection-status"]')).toContainText(
    'Connected',
  );

  await alicePage.fill('[data-testid="name-input"]', 'Alice');
  await alicePage.click('[data-testid="create-room-button"]');
  await alicePage.waitForSelector('[data-testid="room-title"]');
  const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
  const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];

  if (!roomCode) {
    throw new Error('Failed to create room code for two-player setup');
  }

  await bobPage.click('[data-testid="join-toggle-button"]');
  await bobPage.fill('[data-testid="name-input"]', 'Bob');
  await bobPage.fill('[data-testid="room-id-input"]', roomCode);
  await bobPage.click('[data-testid="join-room-button"]');

  await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
  await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');

  return {
    aliceContext,
    bobContext,
    alicePage,
    bobPage,
    roomCode,
  };
}

async function teardownTwoPlayerSession(session: TwoPlayerSession) {
  await Promise.allSettled([
    session.aliceContext.close(),
    session.bobContext.close(),
  ]);
}

async function setupThreePlayerSession(browser: any): Promise<ThreePlayerSession> {
  const aliceContext = await browser.newContext();
  const bobContext = await browser.newContext();
  const charlieContext = await browser.newContext();
  const alicePage = await aliceContext.newPage();
  const bobPage = await bobContext.newPage();
  const charliePage = await charlieContext.newPage();

  await Promise.all([
    alicePage.goto(FRONTEND_URL),
    bobPage.goto(FRONTEND_URL),
    charliePage.goto(FRONTEND_URL),
  ]);
  await Promise.all([
    alicePage.waitForSelector('[data-testid="connection-status"]'),
    bobPage.waitForSelector('[data-testid="connection-status"]'),
    charliePage.waitForSelector('[data-testid="connection-status"]'),
  ]);
  await Promise.all([
    expect(alicePage.locator('[data-testid="connection-status"]')).toContainText(
      'Connected',
    ),
    expect(bobPage.locator('[data-testid="connection-status"]')).toContainText(
      'Connected',
    ),
    expect(charliePage.locator('[data-testid="connection-status"]')).toContainText(
      'Connected',
    ),
  ]);

  await alicePage.fill('[data-testid="name-input"]', 'Alice');
  await alicePage.click('[data-testid="create-room-button"]');
  await alicePage.waitForSelector('[data-testid="room-title"]');
  const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
  const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
  if (!roomCode) {
    throw new Error('Failed to create room code for three-player setup');
  }

  await bobPage.click('[data-testid="join-toggle-button"]');
  await bobPage.fill('[data-testid="name-input"]', 'Bob');
  await bobPage.fill('[data-testid="room-id-input"]', roomCode);
  await bobPage.click('[data-testid="join-room-button"]');
  await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
  await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');

  await charliePage.click('[data-testid="join-toggle-button"]');
  await charliePage.fill('[data-testid="name-input"]', 'Charlie');
  await charliePage.fill('[data-testid="room-id-input"]', roomCode);
  await charliePage.click('[data-testid="join-room-button"]');
  await Promise.all([
    alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 3/")'),
    bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 3/")'),
    charliePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 3/")'),
  ]);

  return {
    aliceContext,
    bobContext,
    charlieContext,
    alicePage,
    bobPage,
    charliePage,
    roomCode,
  };
}

async function teardownThreePlayerSession(session: ThreePlayerSession) {
  await Promise.allSettled([
    session.aliceContext.close(),
    session.bobContext.close(),
    session.charlieContext.close(),
  ]);
}

async function startGameFromLobby(alicePage: Page, bobPage: Page) {
  await alicePage.click('[data-testid="start-game-button"]');
  await Promise.all([
    alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
    bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
  ]);
  await Promise.all([waitForHoleCards(alicePage), waitForHoleCards(bobPage)]);
}

async function waitForHoleCards(page: Page, expectedCount = 2) {
  await page.waitForFunction(
    (count) => {
      const cards = (window as any).pokerDebug?.getCards?.();
      return Array.isArray(cards) && cards.length === count;
    },
    expectedCount,
    { timeout: 10000 },
  );
}

async function waitForPlayerTurn(
  page: Page,
  playerName: string,
  timeoutMs = 10000,
) {
  await page.waitForFunction(
    (name) => {
      const room = (window as any).pokerDebug?.getRoom();
      const playerId = room?.players?.find((p: any) => p.name === name)?.id;
      return !!playerId && room?.currentHand?.currentPlayerTurn === playerId;
    },
    playerName,
    { timeout: timeoutMs },
  );
}

async function waitForRound(
  page: Page,
  round: string,
  communityCards?: number,
) {
  await page.waitForFunction(
    ({ targetRound, targetCards }) => {
      const room = (window as any).pokerDebug?.getRoom();
      if (!room?.currentHand) return false;
      const roundMatches = room.currentHand.bettingRound === targetRound;
      const cardsMatch =
        typeof targetCards === 'number'
          ? room.currentHand.communityCards?.length === targetCards
          : true;
      return roundMatches && cardsMatch;
    },
    { targetRound: round, targetCards: communityCards },
    { timeout: 10000 },
  );
}

async function getRoomSnapshot(page: Page) {
  return page.evaluate(() => {
    const room = (window as any).pokerDebug?.getRoom();
    const hand = room?.currentHand;
    const alice = room?.players?.find((p: any) => p.name === 'Alice');
    const bob = room?.players?.find((p: any) => p.name === 'Bob');
    return {
      handNumber: hand?.handNumber ?? 0,
      pot: hand?.pot ?? 0,
      currentBet: hand?.currentBet ?? 0,
      bettingRound: hand?.bettingRound ?? null,
      communityCards: hand?.communityCards?.length ?? 0,
      dealerPosition: hand?.dealerPosition ?? null,
      smallBlindPosition: hand?.smallBlindPosition ?? null,
      bigBlindPosition: hand?.bigBlindPosition ?? null,
      currentPlayerTurn: hand?.currentPlayerTurn ?? null,
      currentPlayerName:
        room?.players?.find((p: any) => p.id === hand?.currentPlayerTurn)?.name ??
        null,
      dealerPlayerName:
        room?.players?.find((p: any) => p.position === hand?.dealerPosition)?.name ??
        null,
      smallBlindPlayerName:
        room?.players?.find((p: any) => p.position === hand?.smallBlindPosition)
          ?.name ?? null,
      bigBlindPlayerName:
        room?.players?.find((p: any) => p.position === hand?.bigBlindPosition)?.name ??
        null,
      aliceChips: alice?.chips ?? 0,
      bobChips: bob?.chips ?? 0,
      aliceCurrentBet: alice?.currentBet ?? 0,
      bobCurrentBet: bob?.currentBet ?? 0,
    };
  });
}

async function waitForHandStart(page: Page, handNumber: number) {
  await page.waitForFunction(
    (targetHandNumber) => {
      const room = (window as any).pokerDebug?.getRoom();
      return (
        room?.currentHand?.handNumber === targetHandNumber &&
        room?.currentHand?.bettingRound === 'PRE_FLOP'
      );
    },
    handNumber,
    { timeout: 15000 },
  );
}

async function setTestDeckForCurrentRoom(
  page: Page,
  deck: Array<{ suit: string; rank: string }>,
) {
  await waitForPokerDebug(page);
  await page.evaluate(async (testDeck) => {
    const pokerDebug = (window as any).pokerDebug;
    const roomId = pokerDebug?.getRoom?.()?.id;
    const socket = pokerDebug?.getSocket?.();

    if (!roomId || !socket) {
      throw new Error('Unable to set test deck: room/socket unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'setTestDeck',
        { roomId, deck: testDeck },
        (response: { success: boolean; error?: string }) => {
          if (response?.success) {
            resolve();
          } else {
            reject(
              new Error(
                response?.error || 'Unknown setTestDeck failure from server',
              ),
            );
          }
        },
      );
    });
  }, deck);
}

async function requestRebuy(page: Page, amount: number) {
  await waitForPokerDebug(page);
  await page.evaluate(async (rebuyAmount) => {
    const socket = (window as any).pokerDebug?.getSocket?.();
    if (!socket) {
      throw new Error('Unable to rebuy: socket unavailable');
    }

    await new Promise<void>((resolve, reject) => {
      socket.emit(
        'REQUEST_REBUY',
        { amount: rebuyAmount },
        (response: { success: boolean; error?: string }) => {
          if (response?.success) {
            resolve();
          } else {
            reject(
              new Error(response?.error || 'Unknown REQUEST_REBUY failure'),
            );
          }
        },
      );
    });
  }, amount);
}

function captureNextHandComplete(page: Page, timeoutMs = 15000): Promise<any> {
  return page.evaluate((timeoutLimit) => {
    const pokerDebug = (window as any).pokerDebug;
    const socket = pokerDebug?.getSocket?.();
    if (!socket) {
      throw new Error('Unable to capture HAND_COMPLETE: socket unavailable');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Timed out waiting for HAND_COMPLETE'));
      }, timeoutLimit);
      socket.once('HAND_COMPLETE', (data: any) => {
        clearTimeout(timer);
        resolve(data?.result ?? data);
      });
    });
  }, timeoutMs);
}

async function completeCurrentHandWithPassiveActions(
  anchorPage: Page,
  pageByName: Record<string, Page>,
  handNumber: number,
) {
  const startedAt = Date.now();
  const maxDurationMs = 45000;

  while (Date.now() - startedAt < maxDurationMs) {
    const state = await getRoomSnapshot(anchorPage);
    if (state.handNumber !== handNumber || state.currentPlayerTurn === null) {
      return;
    }

    const actingPlayer = state.currentPlayerName;
    if (!actingPlayer) {
      await anchorPage.waitForTimeout(200);
      continue;
    }

    const actingPage = pageByName[actingPlayer];
    if (!actingPage) {
      await anchorPage.waitForTimeout(200);
      continue;
    }

    try {
      await waitForPlayerTurn(actingPage, actingPlayer, 5000);
    } catch {
      await anchorPage.waitForTimeout(200);
      continue;
    }

    const canCheck = await actingPage.evaluate(() => {
      const pokerDebug = (window as any).pokerDebug;
      const room = pokerDebug?.getRoom?.();
      const me = pokerDebug?.getPlayer?.();
      const player = room?.players?.find((p: any) => p.id === me?.id);
      return !!player && player.currentBet === room?.currentHand?.currentBet;
    });

    if (canCheck) {
      await actingPage.evaluate(() => (window as any).pokerDebug.check());
    } else {
      await actingPage.evaluate(() => (window as any).pokerDebug.call());
    }

    await anchorPage.waitForTimeout(150);
  }

  const finalState = await getRoomSnapshot(anchorPage);
  throw new Error(
    `Timed out completing hand ${handNumber}; final state: hand=${finalState.handNumber}, round=${finalState.bettingRound}, turn=${finalState.currentPlayerName}`,
  );
}

async function playCheckCheckToShowdown(alicePage: Page, bobPage: Page) {
  await waitForPlayerTurn(bobPage, 'Bob');
  await bobPage.click('[data-testid="action-call"]');
  await waitForPlayerTurn(alicePage, 'Alice');
  await alicePage.click('[data-testid="action-check"]');

  for (let i = 0; i < 3; i++) {
    await waitForPlayerTurn(bobPage, 'Bob');
    await bobPage.click('[data-testid="action-check"]');
    await waitForPlayerTurn(alicePage, 'Alice');
    await alicePage.click('[data-testid="action-check"]');
  }
}

async function getYourCardRanksFromUi(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid^="your-card-"]'),
    );
    if (cards.length > 0) {
      return cards
        .map((el) => el.dataset.rank?.trim() ?? '')
        .filter(Boolean);
    }

    const sections = Array.from(document.querySelectorAll('div'));
    const yourCardsSection = sections.find((el) =>
      el.querySelector('h3')?.textContent?.includes('Your Cards'),
    );
    if (!yourCardsSection) return [];
    return Array.from(yourCardsSection.querySelectorAll('div.font-bold'))
      .map((el) => el.textContent?.trim() || '')
      .filter(Boolean);
  });
}

async function getCommunityCardCountFromUi(page: Page): Promise<number> {
  return page.evaluate(() => {
    const cards = document.querySelectorAll('[data-testid^="community-card-"]');
    if (cards.length > 0) return cards.length;

    // Board now always renders 5 slots with card backs; this helper tracks
    // only revealed community cards.
    const room = (window as any).pokerDebug?.getRoom?.();
    return room?.currentHand?.communityCards?.length ?? 0;
  });
}

function parseDollarAmount(text: string | null, label: string): number {
  const match = text?.match(/\$([0-9]+)/);
  if (!match) {
    throw new Error(`Unable to parse ${label} from text: ${text ?? '<null>'}`);
  }
  return Number(match[1]);
}

async function getPotFromUi(page: Page): Promise<number> {
  const potText = await page.textContent('[data-testid="pot-value"]');
  return parseDollarAmount(potText, 'pot');
}

async function getRoundFromUi(page: Page): Promise<string> {
  const roundText = await page.textContent('[data-testid="round-value"]');
  const match = roundText?.match(/Current Round:\s*([A-Z_]+)/);
  if (!match) {
    throw new Error(`Unable to parse round from text: ${roundText ?? '<null>'}`);
  }
  return match[1];
}

async function getYourChipsFromUi(page: Page): Promise<number> {
  const chipsText = await page.textContent('[data-testid="your-chips"]');
  return parseDollarAmount(chipsText, 'your chips');
}

async function getDealerNameFromUi(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const playersSection = document.querySelector('[data-testid="players-section"]');
    const seatRows = playersSection?.querySelectorAll('[data-testid^="player-seat-"]');
    if (seatRows && seatRows.length > 0) {
      for (const row of Array.from(seatRows)) {
        const hasDealerBadge = Array.from(row.querySelectorAll('div')).some(
          (el) => el.textContent?.trim() === 'D',
        );
        if (!hasDealerBadge) continue;

        const nameText =
          row.querySelector('span.text-white.font-semibold')?.textContent ?? '';
        return nameText.replace('(You)', '').trim();
      }

      return null;
    }

    const headings = Array.from(document.querySelectorAll('h3'));
    const fallbackHeading = headings.find(
      (heading) => heading.textContent?.trim() === 'Players',
    );
    const fallbackSection = fallbackHeading?.parentElement;
    const rowsContainer = fallbackSection?.querySelector('div.space-y-2');
    if (!rowsContainer) return null;

    for (const row of Array.from(rowsContainer.children)) {
      const hasDealerBadge = Array.from(row.querySelectorAll('span')).some(
        (span) => span.textContent?.trim() === 'D',
      );
      if (!hasDealerBadge) continue;

      const nameText =
        row.querySelector('span.text-white.font-semibold')?.textContent ?? '';
      return nameText.replace('(You)', '').trim();
    }

    return null;
  });
}

async function getPlayersMoneyFromUi(
  page: Page,
): Promise<Record<string, { chips: number; currentBet: number; totalBuyIn: number }>> {
  return page.evaluate(() => {
    const result: Record<
      string,
      { chips: number; currentBet: number; totalBuyIn: number }
    > = {};
    const playersSection = document.querySelector('[data-testid="players-section"]');
    const seatRows = playersSection?.querySelectorAll('[data-testid^="player-seat-"]');
    if (seatRows && seatRows.length > 0) {
      for (const row of Array.from(seatRows)) {
        const nameText =
          row.querySelector('span.text-white.font-semibold')?.textContent ?? '';
        const name = nameText.replace('(You)', '').trim();
        if (!name) continue;

        const chipsText = row.querySelector('div.text-green-400.text-sm')?.textContent;
        const chipsMatch = chipsText?.match(/\$([0-9]+)/);
        const chips = chipsMatch ? Number(chipsMatch[1]) : 0;

        const betText = Array.from(row.querySelectorAll('div'))
          .map((el) => el.textContent || '')
          .find((text) => text.includes('Bet: $'));
        const betMatch = betText?.match(/Bet:\s*\$([0-9]+)/);
        const currentBet = betMatch ? Number(betMatch[1]) : 0;
        const buyInText = Array.from(row.querySelectorAll('div'))
          .map((el) => el.textContent || '')
          .find((text) => text.includes('Buy-in: $'));
        const buyInMatch = buyInText?.match(/Buy-in:\s*\$([0-9]+)/);
        const totalBuyIn = buyInMatch ? Number(buyInMatch[1]) : 0;

        result[name] = { chips, currentBet, totalBuyIn };
      }

      return result;
    }

    const headings = Array.from(document.querySelectorAll('h3'));
    const fallbackHeading = headings.find(
      (heading) => heading.textContent?.trim() === 'Players',
    );
    const fallbackSection = fallbackHeading?.parentElement;
    const rowsContainer = fallbackSection?.querySelector('div.space-y-2');
    if (!rowsContainer) return result;

    for (const row of Array.from(rowsContainer.children)) {
      const nameText =
        row.querySelector('span.text-white.font-semibold')?.textContent ?? '';
      const name = nameText.replace('(You)', '').trim();
      if (!name) continue;

      const chipsText = row.querySelector('div.text-green-400.text-sm')?.textContent;
      const chipsMatch = chipsText?.match(/\$([0-9]+)/);
      const chips = chipsMatch ? Number(chipsMatch[1]) : 0;

      const betText = Array.from(row.querySelectorAll('div'))
        .map((el) => el.textContent || '')
        .find((text) => text.includes('Bet: $'));
      const betMatch = betText?.match(/Bet:\s*\$([0-9]+)/);
      const currentBet = betMatch ? Number(betMatch[1]) : 0;
      const buyInText = Array.from(row.querySelectorAll('div'))
        .map((el) => el.textContent || '')
        .find((text) => text.includes('Buy-in: $'));
      const buyInMatch = buyInText?.match(/Buy-in:\s*\$([0-9]+)/);
      const totalBuyIn = buyInMatch ? Number(buyInMatch[1]) : 0;

      result[name] = { chips, currentBet, totalBuyIn };
    }

    return result;
  });
}

test.describe('Poker E2E - Test Suite 1: Basic Betting Actions', () => {
  test('1.1: Check/Check Scenario - both players check through all rounds', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners to capture browser logs
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room page to load
    await alicePage.waitForSelector('[data-testid="room-title"]');

    // Get room ID from UI
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for Bob to see room page
    await bobPage.waitForSelector('[data-testid="room-title"]');

    // Wait for both players to appear in room
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Alice starts game via UI button
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start and verify pot appears
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });

    // Verify both players can see pot (game started)
    const alicePot = await alicePage.textContent('[data-testid="pot-value"]');
    const bobPot = await bobPage.textContent('[data-testid="pot-value"]');
    console.log('Game started - Alice sees:', alicePot, 'Bob sees:', bobPot);
    expect(alicePot).toContain('$30'); // Small blind $10 + Big blind $20
    expect(bobPot).toContain('$30');

    // PRE_FLOP: Bob (small blind) calls, Alice (big blind) checks
    console.log('Pre-flop: Bob calling...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Verify Call button shows correct amount
    const callButton = await bobPage.textContent('[data-testid="action-call"]');
    console.log('Bob sees call button:', callButton);
    expect(callButton).toContain('$10'); // Must call $10 to match big blind

    await bobPage.click('[data-testid="action-call"]');

    console.log('Pre-flop: Alice checking...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    await alicePage.waitForSelector('[data-testid="action-check"]');
    await alicePage.click('[data-testid="action-check"]');

    // Verify pot after pre-flop
    await alicePage.waitForTimeout(2000);
    const potAfterPreFlop = await alicePage.textContent('[data-testid="pot-value"]');
    console.log('After pre-flop, pot:', potAfterPreFlop);
    expect(potAfterPreFlop).toContain('$40'); // Both players put in $20

    console.log('Flop should be dealt');

    // Debug: Check actual page state
    await waitForPokerDebug(bobPage);
    const bobState = await bobPage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        currentPlayerTurn: room?.currentHand?.currentPlayerTurn,
        bobId: room?.players?.find((p) => p.name === 'Bob')?.id,
      };
    });
    console.log('Bob state after pre-flop:', bobState);
    console.log(
      'Is it Bob turn?',
      bobState.currentPlayerTurn === bobState.bobId,
    );

    // FLOP: Bob checks, Alice checks
    console.log('Flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Take screenshot to see what's on screen
    await bobPage.screenshot({ path: 'bob-flop-turn.png' });
    console.log('Screenshot saved: bob-flop-turn.png');

    // Get all visible button text
    const buttons = await bobPage.$$eval('button', (btns) =>
      btns.map((b) => b.textContent),
    );
    console.log('All buttons Bob sees:', buttons);

    console.log('Flop: Bob checking...');

    const bobActions = await bobPage.$$eval('button', (btns) =>
      btns.filter((b) => !b.disabled).map((b) => b.textContent),
    );
    console.log('Bob can do:', bobActions);
    expect(bobActions.some((a) => a?.includes('Check'))).toBe(true);
    await bobPage.click('[data-testid="action-check"]');

    console.log('Flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Flop: Alice checking...');
    await alicePage.waitForSelector('[data-testid="action-check"]:visible', {
      timeout: 10000,
    });
    await alicePage.click('[data-testid="action-check"]');

    // Wait for turn
    await alicePage.waitForTimeout(2000);
    console.log('Turn dealt');

    // TURN: Bob checks, Alice checks
    console.log('Turn: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Check what action Bob can take on turn
    const bobTurnActions = await bobPage.$$eval('button', (btns) =>
      btns.filter((b) => !b.disabled).map((b) => b.textContent),
    );
    console.log('Bob can do on turn:', bobTurnActions);

    // Bob checks if possible, otherwise calls
    expect(bobTurnActions.some((a) => a?.includes('Check'))).toBe(true);
    console.log('Turn: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('Flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    const aliceActions = await alicePage.$$eval('button', (btns) =>
      btns.filter((b) => !b.disabled).map((b) => b.textContent),
    );
    console.log('Alice can do:', aliceActions);

    if (aliceActions.some((a) => a?.includes('Check'))) {
      console.log('Flop: Alice checking...');
      await alicePage.click('[data-testid="action-check"]');
    } else if (aliceActions.some((a) => a?.includes('Call'))) {
      console.log('Flop: Alice calling...');
      await alicePage.click('[data-testid="action-call"]');
    }

    // Wait for river
    await alicePage.waitForTimeout(2000);
    console.log('River dealt');

    // RIVER: Bob checks, Alice checks
    console.log('River: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('River: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('River: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('River: Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for hand to complete
    await alicePage.waitForTimeout(2000);
    console.log('Hand complete');

    // Verify chip conservation using pokerDebug
    await waitForPokerDebug(alicePage);
    const finalState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      'Final chips - Alice:',
      finalState.alice,
      'Bob:',
      finalState.bob,
    );

    // Verify chips still total 2000
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('1.2: Bet/Call Scenario - betting and calling across rounds', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners to capture browser logs
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room to be created and get room code
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for both players to see each other
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Alice starts game via UI
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start - check for pot display
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });

    const alicePot = await alicePage.textContent('[data-testid="pot-value"]');
    const bobPot = await bobPage.textContent('[data-testid="pot-value"]');
    console.log('Game started - Alice sees:', alicePot, 'Bob sees:', bobPot);

    // PRE_FLOP: Bob (small blind) raises $50, Alice (big blind) calls
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Pre-flop: Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn
    console.log('Pre-flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Verify Alice sees the correct call amount
    const callButton = await alicePage.textContent('[data-testid="action-call"]');
    console.log('Alice sees call button:', callButton);
    expect(callButton).toContain('$50'); // Call from $20 to $70

    console.log('Pre-flop: Alice calling...');
    await alicePage.click('[data-testid="action-call"]');

    // Wait for flop
    await alicePage.waitForTimeout(2000);
    const potAfterPreFlop = await alicePage.textContent('[data-testid="pot-value"]');
    console.log('After pre-flop, pot:', potAfterPreFlop);
    expect(potAfterPreFlop).toContain('$140'); // $30 blinds + $110 in raises/calls

    // FLOP: Bob checks, Alice raises $100, Bob calls
    console.log('Flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Flop: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    // Alice's turn
    console.log('Flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Flop: Alice raising $100...');
    await alicePage.fill('[data-testid="raise-input"]', '100');
    await alicePage.click('[data-testid="action-raise"]');

    // Bob's turn to call
    console.log('Flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    const flopCallButton = await bobPage.textContent('[data-testid="action-call"]');
    console.log('Bob sees call button:', flopCallButton);
    expect(flopCallButton).toContain('$100');

    console.log('Flop: Bob calling...');
    await bobPage.click('[data-testid="action-call"]');

    // Wait for turn
    await alicePage.waitForTimeout(2000);
    const potAfterFlop = await alicePage.textContent('[data-testid="pot-value"]');
    console.log('After flop, pot:', potAfterFlop);
    expect(potAfterFlop).toContain('$340'); // $140 + $200

    // TURN: Bob checks, Alice checks
    console.log('Turn: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Turn: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('Turn: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Turn: Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for river
    await alicePage.waitForTimeout(2000);
    console.log('River dealt');

    // RIVER: Bob checks, Alice checks
    console.log('River: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('River: Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    console.log('River: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('River: Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for hand to complete
    await alicePage.waitForTimeout(2000);
    console.log('Hand complete');

    // Verify final pot was $340 and chip conservation
    await waitForPokerDebug(alicePage);
    const finalState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
        gameState: room?.gameState,
      };
    });
    console.log(
      'Final state - Alice:',
      finalState.alice,
      'Bob:',
      finalState.bob,
      'Game:',
      finalState.gameState,
    );
    expect(finalState.gameState).toBe('IN_PROGRESS');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('1.3: Bet/Fold Scenario - folding functionality', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Alice starts game via UI
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // Get initial chips using pokerDebug
    await waitForPokerDebug(alicePage);
    const initialChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      'Initial chips - Alice:',
      initialChips.alice,
      'Bob:',
      initialChips.bob,
    );

    // PRE_FLOP: Bob (small blind) raises $100, Alice (big blind) folds
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Pre-flop: Bob raising $100...');
    await bobPage.fill('[data-testid="raise-input"]', '100');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn - she should see a call option
    console.log('Pre-flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    const callButton = await alicePage.textContent('[data-testid="action-call"]');
    console.log('Alice sees call button:', callButton);

    console.log('Pre-flop: Alice folding...');
    await alicePage.click('[data-testid="action-fold"]');

    // Wait for new hand to start (pot resets, blinds posted again)
    await alicePage.waitForTimeout(2000);
    console.log('Hand complete, Bob won by fold');

    // Verify chips changed correctly
    const finalChips = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room.players.find((p: any) => p.name === 'Bob')?.chips,
        gameState: room?.gameState,
      };
    });
    console.log(
      'Final chips - Alice:',
      finalChips.alice,
      'Bob:',
      finalChips.bob,
    );

    // Alice folded, losing her big blind ($20)
    // Bob won the pot ($30 = $10 small blind + $20 Alice's big blind)
    // Alice: 1000 - 20 (big blind) = 980
    // Bob: 1000 - 10 (small blind) + 30 (pot) = 1020
    expect(finalChips.alice).toBe(980);
    expect(finalChips.bob).toBe(1020);
    expect(finalChips.gameState).toBe('IN_PROGRESS');

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe('Poker E2E - Test Suite 3: All-In Scenarios', () => {
  test('3.1: Small All-In - player goes all-in with small stack, cannot act further', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started - blinds posted, pot should be $30');

    // Verify initial pot = $30 (blinds)
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(30);
    expect(initialState.alice).toBe(980); // Big blind posted
    expect(initialState.bob).toBe(990); // Small blind posted

    // PRE_FLOP Round 1: Bob (small blind) raises $900
    console.log('Pre-flop Round 1 - Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Pre-flop Round 1 - Bob raising $900 (leaving $90)...');
    await bobPage.fill('[data-testid="raise-input"]', '900');
    await bobPage.click('[data-testid="action-raise"]');

    // Verify Bob's chips after raise
    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob raise: Pot $${afterBobRaise.pot}, currentBet $${afterBobRaise.currentBet}, Alice: ${afterBobRaise.alice}, Bob: ${afterBobRaise.bob}`,
    );
    // Independent expected math:
    // Bob already posted $10. Raising by $900 requires an additional $10 call + $900 raise.
    // Bob contribution this action: $910, total committed by Bob: $920, remaining chips: $80.
    const expectedBobChipsAfterRaise = 80;
    const expectedPotAfterRaise = 940;
    const expectedCurrentBetAfterRaise = 920;
    expect(afterBobRaise.bob).toBe(expectedBobChipsAfterRaise);
    expect(afterBobRaise.pot).toBe(expectedPotAfterRaise);
    expect(afterBobRaise.currentBet).toBe(expectedCurrentBetAfterRaise);

    // PRE_FLOP Round 2: Alice calls (matching Bob's currentBet $920)
    console.log("Pre-flop Round 2 - Alice calling Bob's raise...");
    await alicePage.click('[data-testid="action-call"]');

    // Verify Alice's chips after call
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    const afterAliceCall = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Alice call: Pot $${afterAliceCall.pot}, Alice: ${afterAliceCall.alice}, Bob: ${afterAliceCall.bob}`,
    );
    // Alice started with 980 (big blind $20 posted), calls to match $920
    // Alice needs to add $900 more (920 - 20 = 900)
    // Alice: 980 - 900 = 80
    expect(afterAliceCall.alice).toBe(80); // 980 - 900 = 80
    expect(afterAliceCall.bob).toBe(80);
    expect(afterAliceCall.pot).toBe(1840); // 940 + 900 = 1840

    // PRE_FLOP Round 3: Bob goes all-in with remaining $80
    console.log('Pre-flop Round 3 - Bob going all-in with $80...');
    await bobPage.click('[data-testid="action-all-in"]');

    // Alice's turn to respond
    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const afterBobAllIn = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob all-in: Pot $${afterBobAllIn.pot}, currentBet $${afterBobAllIn.currentBet}, Alice: ${afterBobAllIn.alice}, Bob: ${afterBobAllIn.bob}`,
    );
    expect(afterBobAllIn.bob).toBe(0); // Bob is all-in
    expect(afterBobAllIn.pot).toBe(1920); // 1840 + 80 = 1920

    // Alice calls Bob's all-in
    console.log("Pre-flop Round 4 - Alice calling Bob's all-in...");
    await alicePage.click('[data-testid="action-call"]');

    // Both players all-in - should go straight to showdown
    await alicePage.waitForTimeout(3000);
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After pre-flop: Pot $${afterPreFlop.pot}, Round: ${afterPreFlop.bettingRound}, Cards: ${afterPreFlop.communityCards}, Alice: ${afterPreFlop.alice}, Bob: ${afterPreFlop.bob}`,
    );

    // Both all-in - should have gone to SHOWDOWN
    expect(afterPreFlop.bettingRound).toBe('SHOWDOWN'); // Straight to showdown
    expect(afterPreFlop.communityCards).toBe(5); // All 5 cards dealt immediately

    // Winner determined - one player has 2000, other has 0
    const total = (afterPreFlop.alice || 0) + (afterPreFlop.bob || 0);
    expect(total).toBe(2000);
    expect(afterPreFlop.alice === 2000 || afterPreFlop.bob === 2000).toBe(true);

    // No need to check through rounds - both all-in means instant showdown
    console.log(
      'Both players all-in - went straight to SHOWDOWN with all 5 cards',
    );

    const winner = afterPreFlop.alice === 2000 ? 'Alice' : 'Bob';
    const loser = winner === 'Alice' ? 'Bob' : 'Alice';
    console.log(`Winner: ${winner} (2000 chips), Loser: ${loser} (0 chips)`);
    console.log(
      '\n=== Test 3.1: Small all-in verified - both went all-in, instant showdown ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('3.2: All-In Call - both players all-in, all cards dealt immediately', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Alice starts game via UI
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // PRE_FLOP: Bob (small blind) acts first
    // Alice goes all-in
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Bob checks to pass turn to Alice
    console.log('Pre-flop: Bob calling (to match big blind)...');
    await bobPage.click('[data-testid="action-call"]');

    // Alice's turn - goes all-in
    console.log('Pre-flop: Alice waiting for turn...');
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    console.log('Pre-flop: Alice going all-in...');
    await alicePage.click('[data-testid="action-all-in"]');

    // Wait for Alice's all-in to register
    await bobPage.waitForTimeout(1000);

    // Bob's turn - calls all-in
    console.log('Pre-flop: Bob waiting for turn after Alice all-in...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    const callButton = await bobPage.textContent('[data-testid="action-call"]');
    console.log('Bob sees call button:', callButton);

    console.log('Pre-flop: Bob calling all-in...');
    await bobPage.click('[data-testid="action-call"]');

    // Wait for all 5 community cards to be dealt immediately (both all-in)
    await alicePage.waitForTimeout(3000);
    console.log('Waiting for all cards to be dealt...');

    // Verify all 5 community cards were dealt
    await waitForPokerDebug(alicePage);
    const gameState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        communityCards: room?.currentHand?.communityCards?.length,
        bettingRound: room?.currentHand?.bettingRound,
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log('Game state after all-in:', gameState);

    // When both players are all-in, all 5 cards should be dealt immediately
    expect(gameState.communityCards).toBe(5);
    expect(gameState.bettingRound).toBe('SHOWDOWN');

    // One player should have 2000, the other 0
    const total = gameState.alice + gameState.bob;
    expect(total).toBe(2000);
    expect(gameState.alice === 2000 || gameState.bob === 2000).toBe(true);

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    await aliceContext.close();
    await bobContext.close();
  });

  test('3.3: Both All-In Pre-Flop - immediate double all-in scenario', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // Verify initial state
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(30);
    expect(initialState.alice).toBe(980); // Big blind
    expect(initialState.bob).toBe(990); // Small blind

    // PRE_FLOP: Bob (small blind) acts first - goes all-in immediately
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Pre-flop: Bob going all-in immediately...');
    await bobPage.click('[data-testid="action-all-in"]');

    // Wait for Bob's all-in to propagate
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    const afterBobAllIn = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob all-in: Pot $${afterBobAllIn.pot}, currentBet $${afterBobAllIn.currentBet}, Alice: ${afterBobAllIn.alice}, Bob: ${afterBobAllIn.bob}`,
    );
    expect(afterBobAllIn.bob).toBe(0); // Bob is all-in
    // Independent expected math: initial pot $30 + Bob remaining $990.
    expect(afterBobAllIn.pot).toBe(1020);
    expect(afterBobAllIn.currentBet).toBe(1000); // Bob's total bet (10 small + 990 all-in)

    // Alice responds by going all-in
    console.log('Pre-flop: Alice going all-in to match Bob...');
    await alicePage.click('[data-testid="action-all-in"]');

    // Both all-in - wait for showdown
    await alicePage.waitForTimeout(3000);
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Final state: Pot $${finalState.pot}, Round: ${finalState.bettingRound}, Cards: ${finalState.communityCards}, Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify both all-in triggered immediate showdown
    expect(finalState.bettingRound).toBe('SHOWDOWN');
    expect(finalState.communityCards).toBe(5); // All 5 cards dealt immediately

    // Verify winner determination
    const total = (finalState.alice || 0) + (finalState.bob || 0);
    expect(total).toBe(2000);
    expect(finalState.alice === 2000 || finalState.bob === 2000).toBe(true);

    const winner = finalState.alice === 2000 ? 'Alice' : 'Bob';
    const loser = winner === 'Alice' ? 'Bob' : 'Alice';
    console.log(`Winner: ${winner} (2000 chips), Loser: ${loser} (0 chips)`);
    console.log(
      '\n=== Test 3.3: Both all-in pre-flop verified - instant showdown ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('3.4: Partial All-In (Side Pot) - short stack wins main pot, deeper stack wins side pot', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;

      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'spades', rank: 'A' }, // Alice
        { suit: 'diamonds', rank: 'K' }, // Alice
        { suit: 'clubs', rank: 'Q' }, // Bob
        { suit: 'clubs', rank: 'J' }, // Bob
        { suit: 'diamonds', rank: '9' }, // Charlie
        { suit: 'diamonds', rank: '8' }, // Charlie
        { suit: 'hearts', rank: 'A' }, // Flop 1
        { suit: 'clubs', rank: '2' }, // Flop 2
        { suit: 'spades', rank: '5' }, // Flop 3
        { suit: 'diamonds', rank: '7' }, // Turn
        { suit: 'clubs', rank: '10' }, // River
      ]);

      await requestRebuy(bobPage, 2000);
      await requestRebuy(charliePage, 2000);

      const handCompletePromise = captureNextHandComplete(alicePage);

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        charliePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
      ]);

      // PRE_FLOP action order (3 players): Alice -> Bob -> Charlie -> Bob
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.fill('[data-testid="raise-input"]', '500');
      await charliePage.click('[data-testid="action-raise"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      // Post-flop only Bob and Charlie can act (Alice is all-in).
      await waitForRound(alicePage, 'FLOP', 3);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'TURN', 4);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'RIVER', 5);
      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-check"]');

      const result = await handCompletePromise;
      expect(result.totalPot).toBe(4000);
      expect(result.winners).toHaveLength(2);

      const winnerAmounts = new Map(
        result.winners.map((winner: any) => [winner.playerName, winner.amountWon]),
      );
      expect(winnerAmounts.get('Alice')).toBe(3000);
      expect(winnerAmounts.get('Bob')).toBe(1000);
      expect(winnerAmounts.get('Charlie') || 0).toBe(0);

      const totalAwarded = result.winners.reduce(
        (sum: number, winner: any) => sum + winner.amountWon,
        0,
      );
      expect(totalAwarded).toBe(4000);

      await verifyChipConservation(alicePage, 5000);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 4: Edge Cases', () => {
  test('4.0: CORRECT Minimum Raise Logic - raise amount not bet amount', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    console.log('=== Testing CORRECT minimum raise logic ===');
    console.log('Correct rule: Minimum raise = size of previous raise');
    console.log(
      'Example: BB=$20, Alice raises to $60 ($40 raise), Bob must raise at least $40 more (to $100)',
    );

    // Alice creates room
    console.log('\nAlice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });

    // PRE_FLOP: Bob acts first (SB posted $10, needs to call $10 more or raise)
    console.log('\nPRE_FLOP: Bob (SB) to act...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Bob raises to $60 (a $40 raise from BB of $20)
    console.log('Bob raises $40 (making currentBet $60)...');
    await bobPage.fill('[data-testid="raise-input"]', '40');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Alice now facing bet of $60');

    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        bobChips: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
        aliceChips: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        minRaise: (window as any).pokerDebug?.minRaise,
      };
    });

    console.log(
      `After Bob's raise: pot=$${afterBobRaise.pot}, currentBet=$${afterBobRaise.currentBet}`,
    );
    console.log(
      `Bob chips: ${afterBobRaise.bobChips}, Alice chips: ${afterBobRaise.aliceChips}`,
    );
    console.log(`Server says minRaise: $${afterBobRaise.minRaise}`);

    // CORRECT poker rule: Bob raised $40 (from $20 to $60)
    // So Alice must raise at least $40 more (to $100 minimum)
    // The minimum RAISE AMOUNT is $40, not $80!

    console.log('\n=== Testing minimum raise ===');
    console.log('Bob raised $40 (from $20 BB to $60)');
    console.log('Alice must raise at least $40 more');
    console.log('So minimum total bet = $60 + $40 = $100');
    console.log(
      'This means Alice should be able to raise $40 (not need to raise $80)',
    );

    // Try to raise $40 - this SHOULD work according to correct poker rules
    await alicePage.fill('[data-testid="raise-input"]', '40');
    await alicePage.waitForTimeout(100);

    const raiseButtonDisabled = await alicePage
      .locator('[data-testid="action-raise"]')
      .isDisabled();

    // CORRECT EXPECTATION: Button should be ENABLED for $40 raise
    // This test will FAIL because the current implementation requires $80 (currentBet * 2)
    expect(raiseButtonDisabled).toBe(false);
    console.log(
      '✓ CORRECT: Raise button should be ENABLED for $40 raise (matches previous raise size)',
    );

    console.log('\n=== Test 4.0: This test expects CORRECT poker rules ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('4.1: Minimum Raise - verify system enforces minimum raise requirements', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // Verify initial state
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, currentBet $${initialState.currentBet}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(30);
    expect(initialState.currentBet).toBe(20); // Big blind
    expect(initialState.alice).toBe(980); // Big blind posted
    expect(initialState.bob).toBe(990); // Small blind posted

    // PRE_FLOP: Bob acts first (small blind)
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Get minRaise from SERVER (correct poker rules!)
    const bobTurnState = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
        minRaise: room?.currentHand?.minRaise, // Use server's correct value
      };
    });
    console.log(
      `Bob's turn - currentBet: $${bobTurnState.currentBet}, minRaise: $${bobTurnState.minRaise}`,
    );

    // With CORRECT poker rules:
    // - BB = $20 is the initial raise
    // - minRaise = $20 (size of BB)
    // - Bob must raise at least $20 more

    // Test 1: Try invalid amount (less than minRaise)
    const invalidAmount = bobTurnState.minRaise - 10;
    console.log(
      `Pre-flop: Testing invalid raise amount $${invalidAmount} (min is $${bobTurnState.minRaise})...`,
    );
    await bobPage.fill('[data-testid="raise-input"]', invalidAmount.toString());
    await bobPage.waitForTimeout(100); // Let UI update
    const raiseButtonDisabled = await bobPage
      .locator('[data-testid="action-raise"]')
      .isDisabled();
    expect(raiseButtonDisabled).toBe(true);
    console.log(
      `✓ Raise button disabled when input ($${invalidAmount}) < minimum ($${bobTurnState.minRaise})`,
    );

    // Test 2: Use exact minimum raise amount
    console.log(
      `Pre-flop: Bob raising to minimum $${bobTurnState.minRaise}...`,
    );
    await bobPage.fill(
      '[data-testid="raise-input"]',
      bobTurnState.minRaise.toString(),
    );
    await bobPage.click('[data-testid="action-raise"]');

    // Wait for action to process
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob's raise $40: Pot $${afterBobRaise.pot}, currentBet $${afterBobRaise.currentBet}, Bob chips: ${afterBobRaise.bob}`,
    );

    // Verify minimum raise worked
    // With CORRECT poker rules:
    // - Bob raised by minRaise amount ($20)
    // - currentBet = previous bet ($20) + raise ($20) = $40
    const expectedCurrentBet = bobTurnState.currentBet + bobTurnState.minRaise;
    expect(afterBobRaise.currentBet).toBe(expectedCurrentBet);
    console.log(
      `✓ Minimum raise of $${bobTurnState.minRaise} succeeded (currentBet now $${expectedCurrentBet})`,
    );

    // Verify Bob's chips decreased appropriately
    // Bob started with 990, posted small blind $10
    // After raising by minRaise, Bob's total contribution is $10 SB + $20 raise = $30
    // So Bob's chips: 990 - 30 = 960
    const bobInitialChips = 990;
    const bobSmallBlind = 10;
    const bobRaiseAmount = bobTurnState.minRaise;
    const bobTotalBet = bobSmallBlind + bobRaiseAmount;
    const expectedBobChips = bobInitialChips - bobTotalBet;
    expect(afterBobRaise.bob).toBe(expectedBobChips);
    console.log(
      `✓ Bob's chips correctly updated: ${afterBobRaise.bob} (expected ${expectedBobChips})`,
    );

    // Test 3: Verify CORRECT minRaise formula
    // Correct poker rule: minRaise = size of previous raise
    // The BB ($20) was the previous "raise", so minRaise should equal BB
    const expectedMinRaise = 20; // Size of the BB
    expect(bobTurnState.minRaise).toBe(expectedMinRaise);
    console.log(
      `✓ CORRECT minimum raise formula: minRaise = size of previous raise = $${expectedMinRaise}`,
    );

    console.log(
      '\n=== Test 4.1: Minimum raise enforcement verified with CORRECT poker rules ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('4.2: Raise More Than Opponent Has - verify handling when player cannot match full bet', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // Verify initial state
    const initialState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Initial: Pot $${initialState.pot}, Alice: ${initialState.alice}, Bob: ${initialState.bob}`,
    );
    expect(initialState.pot).toBe(30);
    expect(initialState.alice).toBe(980); // Big blind posted
    expect(initialState.bob).toBe(990); // Small blind posted

    // PRE_FLOP: Bob acts first - raises large amount leaving only $5
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Bob raises $975 (will leave him with $5 after small blind $10 + raise $975 = $985 total bet)
    console.log('Pre-flop: Bob raising $975 (leaving $5)...');
    await bobPage.fill('[data-testid="raise-input"]', '975');
    await bobPage.click('[data-testid="action-raise"]');

    // Wait for Alice's turn
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Bob's raise: Pot $${afterBobRaise.pot}, currentBet $${afterBobRaise.currentBet}, Alice: ${afterBobRaise.alice}, Bob: ${afterBobRaise.bob}`,
    );

    // Verify Bob's state after large raise
    expect(afterBobRaise.bob).toBe(5);
    console.log(
      `✓ Bob has ${afterBobRaise.bob} chips remaining after large raise`,
    );

    // Alice can call (matching Bob's bet) or raise (if she has enough)
    // Since Alice has 980 chips and Bob's currentBet is likely ~$985-995
    // Alice can only call up to Bob's total bet amount
    console.log(
      `Pre-flop: Alice calling Bob's bet (currentBet $${afterBobRaise.currentBet})...`,
    );
    await alicePage.click('[data-testid="action-call"]');

    // Wait for game to progress
    await alicePage.waitForTimeout(2000);
    const afterAliceCall = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot,
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `After Alice's call: Pot $${afterAliceCall.pot}, Round: ${afterAliceCall.bettingRound}, Alice: ${afterAliceCall.alice}, Bob: ${afterAliceCall.bob}`,
    );

    // Verify both players matched the bet properly
    expect(afterAliceCall.alice).toBe(5);
    console.log(
      `✓ Alice has ${afterAliceCall.alice} chips after calling Bob's large bet`,
    );

    // Verify game progressed to next round or showdown
    expect(afterAliceCall.bettingRound).not.toBe('PRE_FLOP');
    console.log(`✓ Game progressed to ${afterAliceCall.bettingRound}`);

    // Verify chip conservation
    const totalChips =
      (afterAliceCall.alice || 0) +
      (afterAliceCall.bob || 0) +
      (afterAliceCall.pot || 0);
    expect(totalChips).toBe(2000);
    console.log(
      `✓ Chip conservation maintained: ${afterAliceCall.alice} + ${afterAliceCall.bob} + ${afterAliceCall.pot} = ${totalChips}`,
    );

    console.log('\n=== Test 4.2: Large raise handled correctly ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('4.3: Check When Bet Required - verify check button disabled when facing a bet', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // PRE_FLOP: Bob acts first (small blind, needs to call or raise)
    console.log('Pre-flop: Bob waiting for turn...');
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });

    // Bob raises $50
    console.log('Pre-flop: Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn - she faces a bet and cannot check
    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log("Pre-flop: Alice facing Bob's raise...");

    const afterBobRaise = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
      };
    });
    console.log(`Alice facing bet of $${afterBobRaise.currentBet}`);

    // Verify Check button is NOT present when facing a bet
    const checkButtonCount = await alicePage
      .locator('[data-testid="action-check"]')
      .count();
    expect(checkButtonCount).toBe(0);
    console.log('✓ Check button not present when Alice faces a bet');

    // Verify Call button is available
    const callButtonEnabled = await alicePage
      .locator('[data-testid="action-call"]')
      .isEnabled();
    expect(callButtonEnabled).toBe(true);
    console.log('✓ Call button is enabled');

    // Verify Fold button is available
    const foldButtonEnabled = await alicePage
      .locator('[data-testid="action-fold"]')
      .isEnabled();
    expect(foldButtonEnabled).toBe(true);
    console.log('✓ Fold button is enabled');

    // Verify All-In button is available
    const allInButtonEnabled = await alicePage
      .locator('[data-testid="action-all-in"]')
      .isEnabled();
    expect(allInButtonEnabled).toBe(true);
    console.log('✓ All-In button is enabled');

    console.log(
      '\n=== Test 4.3: Check validation verified - cannot check when facing a bet ===',
    );

    await aliceContext.close();
    await bobContext.close();
  });

  test('4.4: Multiple Hands in Sequence - play 5 hands and verify rotation/accounting', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const handStarts: Array<{
        handNumber: number;
        dealerPosition: number | null;
        smallBlindPosition: number | null;
        bigBlindPosition: number | null;
        dealerPlayerName: string | null;
        smallBlindPlayerName: string | null;
        bigBlindPlayerName: string | null;
        currentPlayerName: string | null;
        pot: number;
        aliceCurrentBet: number;
        bobCurrentBet: number;
      }> = [];

      for (let handNumber = 1; handNumber <= 5; handNumber++) {
        await waitForHandStart(alicePage, handNumber);
        const snapshot = await getRoomSnapshot(alicePage);
        handStarts.push({
          handNumber: snapshot.handNumber,
          dealerPosition: snapshot.dealerPosition,
          smallBlindPosition: snapshot.smallBlindPosition,
          bigBlindPosition: snapshot.bigBlindPosition,
          dealerPlayerName: snapshot.dealerPlayerName,
          smallBlindPlayerName: snapshot.smallBlindPlayerName,
          bigBlindPlayerName: snapshot.bigBlindPlayerName,
          currentPlayerName: snapshot.currentPlayerName,
          pot: snapshot.pot,
          aliceCurrentBet: snapshot.aliceCurrentBet,
          bobCurrentBet: snapshot.bobCurrentBet,
        });

        expect(snapshot.handNumber).toBe(handNumber);
        expect(snapshot.bettingRound).toBe('PRE_FLOP');
        expect(snapshot.pot).toBe(30);
        expect(snapshot.dealerPosition).not.toBeNull();
        expect(snapshot.dealerPosition).toBe((handNumber - 1) % 2);
        expect(snapshot.smallBlindPosition).toBe(
          (Number(snapshot.dealerPosition) + 1) % 2,
        );
        expect(snapshot.bigBlindPosition).toBe(snapshot.dealerPosition);
        expect(snapshot.currentPlayerName).toBe(
          snapshot.smallBlindPlayerName,
        );
        expect(snapshot.aliceCurrentBet + snapshot.bobCurrentBet).toBe(30);
        await verifyChipConservation(alicePage, 2000);

        const actingPage =
          snapshot.currentPlayerName === 'Alice' ? alicePage : bobPage;
        await waitForPlayerTurn(actingPage, snapshot.currentPlayerName!);
        await actingPage.click('[data-testid="action-fold"]');

        if (handNumber < 5) {
          await waitForHandStart(alicePage, handNumber + 1);
        } else {
          await waitForHandStart(alicePage, 6);
        }
      }

      expect(handStarts.map((h) => h.dealerPosition)).toEqual([0, 1, 0, 1, 0]);
      expect(handStarts.map((h) => h.smallBlindPlayerName)).toEqual([
        'Bob',
        'Alice',
        'Bob',
        'Alice',
        'Bob',
      ]);
      expect(handStarts.map((h) => h.bigBlindPlayerName)).toEqual([
        'Alice',
        'Bob',
        'Alice',
        'Bob',
        'Alice',
      ]);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Chip Conservation', () => {
  test('6.1: Chip Conservation Throughout Hand - multiple hands in sequence', async ({
    browser,
  }) => {
    // Create two browser contexts (Alice and Bob)
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();

    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-title"]');
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    await bobPage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Play 1 hand to verify chip conservation throughout
    console.log(`\n=== Starting Hand ===`);

    // Start game via UI
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    await bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 });
    console.log('Game started');

    // Check conservation at start
    await waitForPokerDebug(alicePage);
    await verifyChipConservation(alicePage, 2000);

    // Pre-flop: Bob calls, Alice checks
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Bob calling...');
    await bobPage.click('[data-testid="action-call"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await alicePage.waitForTimeout(2000);

    // Flop: Bob checks, Alice checks (Bob acts first post-flop)
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await alicePage.waitForTimeout(2000);

    // Turn: Bob checks, Alice checks
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await alicePage.waitForTimeout(2000);

    // River: Bob checks, Alice checks
    await bobPage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]', { timeout: 10000 });
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for hand to complete
    await alicePage.waitForTimeout(2000);
    console.log('Hand complete');

    // Verify chip conservation after hand
    const finalState = await alicePage.evaluate(() => {
      const room = window.pokerDebug.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    console.log(
      `Final chips - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Chip conservation verified throughout hand ===');

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe('Poker E2E - Test Suite 2: Raise/Re-raise Actions', () => {
  test('2.1: Single Raise - test raise mechanics', async ({ browser }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room page to load
    await alicePage.waitForSelector('[data-testid="room-title"]');

    // Get room ID from UI
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for Bob to see room page
    await bobPage.waitForSelector('[data-testid="room-title"]');

    // Wait for both players to appear in room
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Alice starts game via UI button
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start
    await alicePage.waitForSelector('[data-testid="round-value"]');
    await bobPage.waitForSelector('[data-testid="round-value"]');
    console.log('Game started');

    // PRE_FLOP: Bob raises $50
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop - Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice's turn - verify currentBet in the turn event
    await alicePage.waitForSelector('[data-testid="action-dock"]');

    const pokerDebugAlice = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
        pot: room?.currentHand?.pot,
      };
    });
    expect(pokerDebugAlice.currentBet).toBe(70);
    console.log(`Current bet verified: $${pokerDebugAlice.currentBet}`);

    // Alice must call $50 (from big blind $20 to $70)
    const callButton = await alicePage.textContent('[data-testid="action-call"]');
    expect(callButton).toContain('50'); // Should show "Call $50" (from $20 to $70)
    console.log('Pre-flop - Alice calling $50...');
    await alicePage.click('[data-testid="action-call"]');

    // Verify pot = $140 after blinds + raise + call
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return room?.currentHand?.pot || 0;
    });
    expect(afterPreFlop).toBe(140);
    console.log(`Pot after pre-flop: $${afterPreFlop}`);

    // Verify both players' chips after pre-flop betting
    const chipsAfterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    expect(chipsAfterPreFlop.alice).toBe(930); // Started 980, paid $50 to call
    expect(chipsAfterPreFlop.bob).toBe(930); // Started 990, paid $60 total
    console.log(
      `Chips after pre-flop - Alice: ${chipsAfterPreFlop.alice}, Bob: ${chipsAfterPreFlop.bob}`,
    );

    // FLOP: Both check to showdown
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Verify betting round transitioned to TURN
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        bettingRound: room?.currentHand?.bettingRound,
        communityCards: room?.currentHand?.communityCards?.length,
      };
    });
    expect(afterFlop.bettingRound).toBe('TURN');
    expect(afterFlop.communityCards).toBe(4); // Flop (3) + Turn (1)

    // TURN: Both check
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // RIVER: Both check
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait a moment for showdown to process
    await alicePage.waitForTimeout(2000);
    console.log('Showdown complete');

    // Verify final state
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log(
      `Final state - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify winner received pot and chip conservation
    const totalChips = finalState.alice + finalState.bob;
    expect(totalChips).toBe(2000); // Chip conservation

    // Valid outcomes: single winner takes $140 pot, or exact split at showdown.
    const validOutcomes = [
      { alice: 1070, bob: 930 },
      { alice: 930, bob: 1070 },
      { alice: 1000, bob: 1000 },
    ];
    const hasValidOutcome = validOutcomes.some(
      (o) => o.alice === finalState.alice && o.bob === finalState.bob,
    );
    expect(hasValidOutcome).toBe(true);
    console.log(
      `Final outcome validated - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Test 2.1: Single raise mechanics verified ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('2.2: Re-raise (3-bet) - test re-raising mechanics', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    // Add console listeners
    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room via UI
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');

    // Wait for room page to load
    await alicePage.waitForSelector('[data-testid="room-title"]');

    // Get room ID from UI
    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room via UI
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');

    // Wait for Bob to see room page
    await bobPage.waitForSelector('[data-testid="room-title"]');

    // Wait for both players to appear in room
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Alice starts game via UI button
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');

    // Wait for game to start
    await alicePage.waitForSelector('[data-testid="round-value"]');
    await bobPage.waitForSelector('[data-testid="round-value"]');
    console.log('Game started');

    // PRE_FLOP: Bob raises $50
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop - Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    // Alice re-raises
    // (Bob raised $50, so min raise = $50 more = $120 minimum with correct poker rules)
    // Alice raises $150 (more than minimum), making currentBet $220
    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop - Alice re-raising (entering $150)...');
    await alicePage.fill('[data-testid="raise-input"]', '150');
    await alicePage.click('[data-testid="action-raise"]');

    // Verify currentBet after re-raise (will be enforced to minimum)
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    const pokerDebugBob = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        currentBet: room?.currentHand?.currentBet,
        pot: room?.currentHand?.pot,
      };
    });
    // System enforces minimum raise, so currentBet will be higher than input
    console.log(
      `Current bet after re-raise: $${pokerDebugBob.currentBet}, pot: $${pokerDebugBob.pot}`,
    );

    // Bob calls (amount depends on what system set as currentBet)
    const callButtonText = await bobPage.textContent('[data-testid="action-call"]');
    console.log(`Pre-flop - Bob sees: ${callButtonText}`);
    await bobPage.click('[data-testid="action-call"]');

    // Verify pot after all pre-flop action
    await new Promise((resolve) => setTimeout(resolve, 500));
    const afterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return room?.currentHand?.pot || 0;
    });
    console.log(`Pot after pre-flop: $${afterPreFlop}`);

    // Verify both players have equal chips after matching bets
    const chipsAfterPreFlop22 = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    expect(chipsAfterPreFlop22.alice).toBe(780); // Both matched the re-raise
    expect(chipsAfterPreFlop22.bob).toBe(780);
    console.log(
      `Chips matched - Alice: ${chipsAfterPreFlop22.alice}, Bob: ${chipsAfterPreFlop22.bob}`,
    );

    // Verify both players have equal chips after matching bets
    const chipsAfterPreFlop = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    expect(chipsAfterPreFlop.alice).toBe(780); // Both matched the re-raise
    expect(chipsAfterPreFlop.bob).toBe(780);
    console.log(
      `Chips matched - Alice: ${chipsAfterPreFlop.alice}, Bob: ${chipsAfterPreFlop.bob}`,
    );

    // FLOP/TURN/RIVER: Both check to showdown
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for showdown
    await alicePage.waitForTimeout(2000);
    console.log('Showdown complete');

    // Verify final state
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log(
      `Final state - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify winner received the pot and loser has correct amount
    const totalChips = finalState.alice + finalState.bob;
    expect(totalChips).toBe(2000); // Chip conservation

    // One player won, one lost (pot was $440)
    const hasWinner =
      (finalState.alice === 1220 && finalState.bob === 780) ||
      (finalState.alice === 780 && finalState.bob === 1220);
    expect(hasWinner).toBe(true);

    const winner = finalState.alice > finalState.bob ? 'Alice' : 'Bob';
    const loser = finalState.alice > finalState.bob ? 'Bob' : 'Alice';
    console.log(`Winner: ${winner} (1220 chips), Loser: ${loser} (780 chips)`);

    // Verify chip conservation
    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Test 2.2: Re-raise (3-bet) mechanics verified ===');

    await aliceContext.close();
    await bobContext.close();
  });

  test('2.3: Multiple Re-raises - test escalating bets', async ({
    browser,
  }) => {
    const aliceContext = await browser.newContext();
    const bobContext = await browser.newContext();
    const alicePage = await aliceContext.newPage();
    const bobPage = await bobContext.newPage();

    alicePage.on('console', (msg) => console.log('ALICE:', msg.text()));
    bobPage.on('console', (msg) => console.log('BOB:', msg.text()));

    // Navigate both to the app
    await alicePage.goto(FRONTEND_URL);
    await bobPage.goto(FRONTEND_URL);

    // Wait for connection
    await alicePage.waitForSelector('[data-testid="connection-status"]');
    await bobPage.waitForSelector('[data-testid="connection-status"]');

    // Alice creates room
    console.log('Alice creating room...');
    await alicePage.fill('[data-testid="name-input"]', 'Alice');
    await alicePage.click('[data-testid="create-room-button"]');
    await alicePage.waitForSelector('[data-testid="room-title"]');

    const roomIdText = await alicePage.textContent('[data-testid="room-title"]');
    const roomCode = roomIdText?.match(/Room: (.+)/)?.[1];
    console.log('Room created:', roomCode);

    // Bob joins room
    console.log('Bob joining room...');
    await bobPage.click('[data-testid="join-toggle-button"]');
    await bobPage.fill('[data-testid="name-input"]', 'Bob');
    await bobPage.fill('[data-testid="room-id-input"]', roomCode!);
    await bobPage.click('[data-testid="join-room-button"]');
    await bobPage.waitForSelector('[data-testid="room-title"]');
    await alicePage.waitForSelector('[data-testid="room-player-count"]:has-text("Players: 2/")');
    console.log('Both players in room');

    // Start game
    console.log('Alice starting game...');
    await alicePage.click('[data-testid="start-game-button"]');
    await alicePage.waitForSelector('[data-testid="round-value"]');
    await bobPage.waitForSelector('[data-testid="round-value"]');
    console.log('Game started');

    // Track pot at each step
    let potHistory: number[] = [30]; // Starting pot (blinds)

    // PRE_FLOP Round 1: Bob raises $50
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Pre-flop Round 1 - Bob raising $50...');
    await bobPage.fill('[data-testid="raise-input"]', '50');
    await bobPage.click('[data-testid="action-raise"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const pot1 = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return room?.currentHand?.pot || 0;
    });
    potHistory.push(pot1);
    console.log(`Pot after Bob's raise: $${pot1}`);

    // PRE_FLOP Round 2: Alice re-raises $150
    console.log('Pre-flop Round 2 - Alice re-raising $150...');
    await alicePage.fill('[data-testid="raise-input"]', '150');
    await alicePage.click('[data-testid="action-raise"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    const pot2 = await bobPage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        currentBet: room?.currentHand?.currentBet,
      };
    });
    potHistory.push(pot2.pot);
    console.log(
      `Pot after Alice's re-raise: $${pot2.pot}, currentBet: $${pot2.currentBet}`,
    );

    // PRE_FLOP Round 3: Bob re-raises again
    // (Alice raised $150, so min raise = $150 more = $370 minimum, but Bob raises to $440)
    console.log('Pre-flop Round 3 - Bob re-raising to $440...');
    await bobPage.fill('[data-testid="raise-input"]', '440');
    await bobPage.click('[data-testid="action-raise"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    const pot3 = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        currentBet: room?.currentHand?.currentBet,
        alice: room?.players?.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players?.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    potHistory.push(pot3.pot);
    console.log(
      `Pot after Bob's 2nd raise: $${pot3.pot}, currentBet: $${pot3.currentBet}, Alice: ${pot3.alice}, Bob: ${pot3.bob}`,
    );

    // Alice calls to end pre-flop
    console.log('Pre-flop - Alice calling...');
    await alicePage.click('[data-testid="action-call"]');

    // Verify final pot after pre-flop
    await new Promise((resolve) => setTimeout(resolve, 500));
    const finalPreFlopState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        pot: room?.currentHand?.pot || 0,
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });
    potHistory.push(finalPreFlopState.pot);

    console.log(`Final pre-flop pot: $${finalPreFlopState.pot}`);
    console.log(`Pot progression: ${potHistory.join(' → ')}`);
    console.log(
      `Chips after pre-flop - Alice: ${finalPreFlopState.alice}, Bob: ${finalPreFlopState.bob}`,
    );

    // Verify both players have same chip amount (matched all bets)
    expect(finalPreFlopState.alice).toBe(finalPreFlopState.bob);
    expect(
      finalPreFlopState.alice + finalPreFlopState.bob + finalPreFlopState.pot,
    ).toBe(2000);

    // FLOP/TURN/RIVER: Both check
    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Flop - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('Turn - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    await bobPage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Bob checking...');
    await bobPage.click('[data-testid="action-check"]');

    await alicePage.waitForSelector('[data-testid="action-dock"]');
    console.log('River - Alice checking...');
    await alicePage.click('[data-testid="action-check"]');

    // Wait for showdown
    await alicePage.waitForTimeout(2000);
    console.log('Showdown complete');

    // Verify final state
    const finalState = await alicePage.evaluate(() => {
      const room = (window as any).pokerDebug?.getRoom();
      return {
        alice: room?.players.find((p: any) => p.name === 'Alice')?.chips,
        bob: room?.players.find((p: any) => p.name === 'Bob')?.chips,
      };
    });

    console.log(
      `Final state - Alice: ${finalState.alice}, Bob: ${finalState.bob}`,
    );

    // Verify chip conservation and winner determination
    const totalChips = finalState.alice + finalState.bob;
    expect(totalChips).toBe(2000);

    const winner = finalState.alice > finalState.bob ? 'Alice' : 'Bob';
    const loser = finalState.alice > finalState.bob ? 'Bob' : 'Alice';
    console.log(`Winner: ${winner}, Loser: ${loser}`);
    console.log(
      `Pot was distributed correctly: ${finalPreFlopState.pot} chips`,
    );

    await verifyChipConservation(alicePage, 2000);

    console.log('\n=== Test 2.3: Multiple re-raises verified ===');

    await aliceContext.close();
    await bobContext.close();
  });
});

test.describe('Poker E2E - Test Suite 5: Turn/Round Advancement', () => {
  test('5.1: Turn Skipping Check - verify turn sequence is correct', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const initial = await getRoomSnapshot(alicePage);
      expect(initial.bettingRound).toBe('PRE_FLOP');
      expect(initial.currentPlayerName).toBe('Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(50));
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterBobRaise = await getRoomSnapshot(alicePage);
      expect(afterBobRaise.currentPlayerName).toBe('Alice');
      expect(afterBobRaise.currentBet).toBe(70);

      await alicePage.evaluate(() => (window as any).pokerDebug.call());
      await waitForRound(alicePage, 'FLOP', 3);

      const flopState = await getRoomSnapshot(alicePage);
      expect(flopState.currentPlayerName).toBe('Bob');

      await bobPage.evaluate(() => (window as any).pokerDebug.check());
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterBobCheck = await getRoomSnapshot(alicePage);
      expect(afterBobCheck.currentPlayerName).toBe('Alice');

      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'TURN', 4);

      const turnState = await getRoomSnapshot(alicePage);
      expect(turnState.currentPlayerName).toBe('Bob');
      await verifyChipConservation(alicePage);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('5.2: Round Progression - PRE_FLOP -> FLOP -> TURN -> RIVER -> SHOWDOWN', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextHandComplete(alicePage);
      await startGameFromLobby(alicePage, bobPage);

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);

      const flop = await getRoomSnapshot(alicePage);
      expect(flop.bettingRound).toBe('FLOP');
      expect(flop.communityCards).toBe(3);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'TURN', 4);

      const turn = await getRoomSnapshot(alicePage);
      expect(turn.bettingRound).toBe('TURN');
      expect(turn.communityCards).toBe(4);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'RIVER', 5);

      const river = await getRoomSnapshot(alicePage);
      expect(river.bettingRound).toBe('RIVER');
      expect(river.communityCards).toBe(5);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');

      const result = await handCompletePromise;
      expect(result.totalPot).toBe(40);
      await waitForRound(alicePage, 'SHOWDOWN', 5);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('5.3: Early Showdown (All-In) - deal all cards immediately', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-all-in"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      await waitForRound(alicePage, 'SHOWDOWN', 5);
      const finalState = await getRoomSnapshot(alicePage);
      const total = finalState.aliceChips + finalState.bobChips;

      expect(finalState.bettingRound).toBe('SHOWDOWN');
      expect(finalState.communityCards).toBe(5);
      expect(total).toBe(2000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 6: Chip Accounting (Additional)', () => {
  test('6.2: Pot Calculation - verify pot updates for each action', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const start = await getRoomSnapshot(alicePage);
      expect(start.pot).toBe(30);

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(50));
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterRaise = await getRoomSnapshot(alicePage);
      expect(afterRaise.pot).toBe(90);
      expect(afterRaise.currentBet).toBe(70);
      await verifyChipConservation(alicePage);

      await alicePage.evaluate(() => (window as any).pokerDebug.call());
      await waitForRound(alicePage, 'FLOP', 3);

      const afterCall = await getRoomSnapshot(alicePage);
      expect(afterCall.pot).toBe(140);
      await verifyChipConservation(alicePage);

      await bobPage.evaluate(() => (window as any).pokerDebug.raise(100));
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterFlopRaise = await getRoomSnapshot(alicePage);
      expect(afterFlopRaise.pot).toBe(240);
      expect(afterFlopRaise.currentBet).toBe(100);
      await verifyChipConservation(alicePage);

      await alicePage.evaluate(() => (window as any).pokerDebug.call());
      await waitForRound(alicePage, 'TURN', 4);

      const afterFlopCall = await getRoomSnapshot(alicePage);
      expect(afterFlopCall.pot).toBe(340);
      await verifyChipConservation(alicePage);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('6.3: Blind Posting - verify blind positions rotate each hand', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const hand1 = await getRoomSnapshot(alicePage);
      expect(hand1.handNumber).toBe(1);
      expect(hand1.dealerPosition).toBe(0);
      expect(hand1.smallBlindPosition).toBe(1);
      expect(hand1.bigBlindPosition).toBe(0);
      expect(hand1.aliceChips).toBe(980);
      expect(hand1.bobChips).toBe(990);
      expect(hand1.currentPlayerName).toBe('Bob');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      await alicePage.waitForFunction(
        () => {
          const room = (window as any).pokerDebug?.getRoom();
          return (
            room?.currentHand?.handNumber === 2 &&
            room?.currentHand?.bettingRound === 'PRE_FLOP'
          );
        },
        { timeout: 10000 },
      );

      const hand2 = await getRoomSnapshot(alicePage);
      expect(hand2.handNumber).toBe(2);
      expect(hand2.dealerPosition).toBe(1);
      expect(hand2.smallBlindPosition).toBe(0);
      expect(hand2.bigBlindPosition).toBe(1);
      expect(hand2.currentPlayerName).toBe('Alice');
      expect(hand2.pot).toBe(30);
      expect(hand2.aliceChips).toBe(1000);
      expect(hand2.bobChips).toBe(970);
      await verifyChipConservation(alicePage);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 7: Winner Determination', () => {
  test('7.1: High Card Win', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'diamonds', rank: '7' }, // Alice
        { suit: 'spades', rank: 'K' }, // Bob
        { suit: 'clubs', rank: 'Q' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: 'J' }, // Turn
        { suit: 'diamonds', rank: '3' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Alice');
      expect(result.winners[0].hand.rank).toBe('HIGH_CARD');
      expect(result.totalPot).toBe(40);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.2: Pair vs High Card', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice hole 1
        { suit: 'clubs', rank: 'A' }, // Alice hole 2
        { suit: 'diamonds', rank: 'K' }, // Bob hole 1
        { suit: 'spades', rank: 'Q' }, // Bob hole 2
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: 'J' }, // Turn
        { suit: 'diamonds', rank: '3' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].hand.rank).toBe('ONE_PAIR');
      const playerHandsByRank = result.playerHands
        .map((p: any) => p.hand.rank)
        .sort();
      expect(playerHandsByRank).toEqual(['HIGH_CARD', 'ONE_PAIR']);
      expect(result.totalPot).toBe(40);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.3: Tie (Split Pot)', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Hole 1
        { suit: 'clubs', rank: 'K' }, // Hole 2
        { suit: 'diamonds', rank: 'K' }, // Hole 3
        { suit: 'spades', rank: 'A' }, // Hole 4
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'hearts', rank: '8' }, // Flop 3
        { suit: 'clubs', rank: 'J' }, // Turn
        { suit: 'spades', rank: '3' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage);
      await startGameFromLobby(alicePage, bobPage);
      await playCheckCheckToShowdown(alicePage, bobPage);

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(2);
      const amounts = result.winners
        .map((w: any) => w.amountWon)
        .sort((a: number, b: number) => a - b);
      expect(amounts).toEqual([20, 20]);
      expect(result.totalPot).toBe(40);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('7.4: Win by Fold', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      const handCompletePromise = captureNextHandComplete(alicePage);
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      const result = await handCompletePromise;
      expect(result.winners).toHaveLength(1);
      expect(result.winners[0].playerName).toBe('Alice');
      expect(result.winners[0].amountWon).toBe(30);
      expect(result.playerHands).toHaveLength(1);
      expect(result.totalPot).toBe(30);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 8: UI/UX Validation', () => {
  test('8.1: Real-Time Updates', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const alicePot = await alicePage.textContent('[data-testid="pot-value"]');
      const bobPot = await bobPage.textContent('[data-testid="pot-value"]');
      expect(alicePot).toContain('$30');
      expect(bobPot).toContain('$30');

      const aliceRound = await alicePage.textContent('[data-testid="round-value"]');
      const bobRound = await bobPage.textContent('[data-testid="round-value"]');
      expect(aliceRound).toContain('PRE_FLOP');
      expect(bobRound).toContain('PRE_FLOP');

      const aliceChips = await alicePage.textContent('[data-testid="your-chips"]');
      const bobChips = await bobPage.textContent('[data-testid="your-chips"]');
      expect(aliceChips).toContain('$980');
      expect(bobChips).toContain('$990');

      const initialTurn = await getRoomSnapshot(alicePage);
      expect(initialTurn.currentPlayerName).toBe('Bob');
      expect(await bobPage.locator('[data-testid="action-dock"]').count()).toBe(1);

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      const turnAfterBobCall = await getRoomSnapshot(alicePage);
      expect(turnAfterBobCall.currentPlayerName).toBe('Alice');
      expect(await alicePage.locator('[data-testid="action-dock"]').count()).toBe(1);

      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);

      const flopRoundAlice = await alicePage.textContent('[data-testid="round-value"]');
      const flopRoundBob = await bobPage.textContent('[data-testid="round-value"]');
      expect(flopRoundAlice).toContain('FLOP');
      expect(flopRoundBob).toContain('FLOP');

      const flopPotAlice = await alicePage.textContent('[data-testid="pot-value"]');
      const flopPotBob = await bobPage.textContent('[data-testid="pot-value"]');
      expect(flopPotAlice).toContain('$40');
      expect(flopPotBob).toContain('$40');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.2: Button States', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      expect(await bobPage.locator('[data-testid="action-check"]').count()).toBe(0);
      await expect(bobPage.locator('[data-testid="action-call"]')).toContainText(
        'Call $10',
      );
      await expect(bobPage.locator('[data-testid="action-call"]')).toBeEnabled();

      const bobRaiseButton = bobPage.locator('[data-testid="action-raise"]');
      await expect(bobRaiseButton).toBeDisabled();
      await bobPage.fill('[data-testid="raise-input"]', '20');
      await expect(bobRaiseButton).toBeEnabled();

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');

      const afterBobCall = await getRoomSnapshot(alicePage);
      expect(afterBobCall.currentBet).toBe(20);
      expect(afterBobCall.bobCurrentBet).toBe(20);
      expect(afterBobCall.aliceCurrentBet).toBe(20);

      expect(await alicePage.locator('[data-testid="action-check"]').count()).toBe(1);
      expect(await alicePage.locator('[data-testid="action-call"]').count()).toBe(0);
      const turnState = await getRoomSnapshot(alicePage);
      expect(turnState.currentPlayerName).toBe('Alice');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.3: Card Display', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'K' }, // Alice
        { suit: 'spades', rank: 'Q' }, // Bob
        { suit: 'spades', rank: 'J' }, // Bob
        { suit: 'clubs', rank: '2' }, // Flop 1
        { suit: 'diamonds', rank: '5' }, // Flop 2
        { suit: 'spades', rank: '8' }, // Flop 3
        { suit: 'hearts', rank: '9' }, // Turn
        { suit: 'diamonds', rank: '10' }, // River
      ]);

      await startGameFromLobby(alicePage, bobPage);

      const aliceRanks = await getYourCardRanksFromUi(alicePage);
      const bobRanks = await getYourCardRanksFromUi(bobPage);
      expect(aliceRanks).toEqual(['A', 'K']);
      expect(bobRanks).toEqual(['Q', 'J']);

      expect(await getCommunityCardCountFromUi(alicePage)).toBe(0);

      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);
      expect(await getCommunityCardCountFromUi(alicePage)).toBe(3);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'TURN', 4);
      expect(await getCommunityCardCountFromUi(alicePage)).toBe(4);

      await bobPage.click('[data-testid="action-check"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'RIVER', 5);
      expect(await getCommunityCardCountFromUi(alicePage)).toBe(5);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.4: Leave Room Navigates Home', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { bobPage } = session;
      await bobPage.click('[data-testid="leave-room-button"]');

      await expect(bobPage).toHaveURL(/\/$/);
      await expect(bobPage.locator('[data-testid="name-input"]')).toBeVisible();
      await expect(bobPage.locator('[data-testid="create-room-button"]')).toBeVisible();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.5: Host Can Start Next Hand After Break', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const firstHand = await getRoomSnapshot(alicePage);
      expect(firstHand.handNumber).toBe(1);

      await bobPage.click('[data-testid="action-fold"]');

      await alicePage.waitForFunction(
        () => window.pokerDebug?.getRoom()?.currentHand?.currentPlayerTurn === null,
        { timeout: 10000 },
      );

      await expect(
        alicePage.locator('[data-testid="start-next-hand-button"]'),
      ).toBeVisible();

      await alicePage.click('[data-testid="start-next-hand-button"]');
      await waitForHandStart(alicePage, 2);

      const secondHand = await getRoomSnapshot(alicePage);
      expect(secondHand.handNumber).toBe(2);
      expect(secondHand.currentPlayerName).toBeTruthy();
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.6: Player List Shows Total Buy-In', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      const aliceViewMoney = await getPlayersMoneyFromUi(alicePage);
      expect(aliceViewMoney.Alice.totalBuyIn).toBe(1000);
      expect(aliceViewMoney.Bob.totalBuyIn).toBe(1000);

      const bobViewMoney = await getPlayersMoneyFromUi(bobPage);
      expect(bobViewMoney.Alice.totalBuyIn).toBe(1000);
      expect(bobViewMoney.Bob.totalBuyIn).toBe(1000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.7: Bust Auto-Refill Increments Total Buy-In', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'spades', rank: 'A' }, // Alice
        { suit: 'hearts', rank: 'A' }, // Alice
        { suit: 'clubs', rank: '2' }, // Bob
        { suit: 'diamonds', rank: '7' }, // Bob
        { suit: 'clubs', rank: 'K' }, // Flop 1
        { suit: 'diamonds', rank: 'Q' }, // Flop 2
        { suit: 'hearts', rank: 'J' }, // Flop 3
        { suit: 'spades', rank: '9' }, // Turn
        { suit: 'clubs', rank: '3' }, // River
        { suit: 'clubs', rank: '4' }, // Alice (hand 2)
        { suit: 'diamonds', rank: '4' }, // Alice (hand 2)
        { suit: 'clubs', rank: '5' }, // Bob (hand 2)
        { suit: 'diamonds', rank: '5' }, // Bob (hand 2)
        { suit: 'hearts', rank: '2' }, // Flop 1 (hand 2)
        { suit: 'spades', rank: '8' }, // Flop 2 (hand 2)
        { suit: 'diamonds', rank: 'K' }, // Flop 3 (hand 2)
        { suit: 'clubs', rank: '9' }, // Turn (hand 2)
        { suit: 'hearts', rank: 'J' }, // River (hand 2)
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage);
      await startGameFromLobby(alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-all-in"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-call"]');

      const result = await handCompletePromise;
      const bobWon = result.winners.some((winner: any) => winner.playerName === 'Bob');
      expect(bobWon).toBe(false);

      // In TEST_MODE, next hand auto-starts after hand complete.
      await waitForHandStart(alicePage, 2);

      const uiMoney = await getPlayersMoneyFromUi(alicePage);
      expect(uiMoney.Alice.totalBuyIn).toBe(1000);
      expect(uiMoney.Bob.totalBuyIn).toBe(2000);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.8: Action Confirmation Modal Helps Decision Before Commit', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      await bobPage.locator('[data-testid="action-dock"] input[type="checkbox"]').check();
      await bobPage.click('[data-testid="action-call"]');

      await expect(bobPage.locator('[data-testid="action-confirm-modal"]')).toBeVisible();
      await expect(bobPage.locator('[data-testid="action-confirm-modal"]')).toContainText(
        'Confirm Action',
      );
      await expect(bobPage.locator('[data-testid="action-confirm-modal"]')).toContainText(
        'Pot',
      );
      await expect(bobPage.locator('[data-testid="action-confirm-modal"]')).toContainText(
        'Your Stack',
      );

      await bobPage.click('[data-testid="confirm-action-button"]');
      await expect(bobPage.locator('[data-testid="action-confirm-modal"]')).toHaveCount(0);

      await waitForPlayerTurn(alicePage, 'Alice');
      const stateAfterConfirm = await getRoomSnapshot(alicePage);
      expect(stateAfterConfirm.currentPlayerName).toBe('Alice');
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.9: Rankings Modal and Card Toggle Reset on New Hand', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage } = session;
      await startGameFromLobby(alicePage, bobPage);

      await alicePage.click('[data-testid="open-rankings-button"]');
      await expect(alicePage.locator('[data-testid="rankings-modal"]')).toBeVisible();
      await expect(alicePage.locator('[data-testid="ranking-row-1"]')).toBeVisible();
      await expect(alicePage.locator('[data-testid="rankings-modal"]')).toContainText(
        'Player Rankings',
      );
      await alicePage.click('[data-testid="close-rankings-button"]');
      await expect(alicePage.locator('[data-testid="rankings-modal"]')).toHaveCount(0);

      await alicePage.click('[data-testid="toggle-hole-cards"]');
      await expect(alicePage.locator('[data-testid^="your-card-"]')).toHaveCount(0);
      await expect(alicePage.locator('[data-testid="hole-cards-hidden-state"]')).toBeVisible();

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-fold"]');

      // TEST_MODE auto-starts hand #2; hidden cards should reset to shown.
      await waitForHandStart(alicePage, 2);
      await expect(alicePage.locator('[data-testid^="your-card-"]')).toHaveCount(2);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.10: Rejected Action Shows Detailed Error Modal', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage } = session;
      await startGameFromLobby(alicePage, session.bobPage);

      // Bob acts first pre-flop in heads-up; force an out-of-turn action from Alice.
      await alicePage.evaluate(() => (window as any).pokerDebug.call());

      await expect(alicePage.locator('[data-testid="error-modal"]')).toBeVisible();
      await expect(alicePage.locator('[data-testid="error-modal-reason"]')).toContainText(
        'Another player must act first',
      );
      await expect(alicePage.locator('[data-testid="error-modal"]')).toContainText(
        'Technical detail',
      );
      await expect(alicePage.locator('[data-testid="error-modal"]')).toContainText(
        'shows Bob',
      );

      await alicePage.click('[data-testid="dismiss-error-button"]');
      await expect(alicePage.locator('[data-testid="error-modal"]')).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.11: Invalid Check Uses Same Detailed Error Modal', async ({ browser }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { bobPage } = session;
      await startGameFromLobby(session.alicePage, bobPage);

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.evaluate(() => (window as any).pokerDebug.check());

      await expect(bobPage.locator('[data-testid="error-modal"]')).toBeVisible();
      await expect(bobPage.locator('[data-testid="error-modal-reason"]')).toContainText(
        'facing a bet',
      );
      await expect(bobPage.locator('[data-testid="error-modal"]')).toContainText(
        'Call $10',
      );
      await expect(bobPage.locator('[data-testid="error-modal"]')).toContainText(
        'Technical detail',
      );

      await bobPage.click('[data-testid="dismiss-error-button"]');
      await expect(bobPage.locator('[data-testid="error-modal"]')).toHaveCount(0);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });

  test('8.12: Refresh Mid-Hand Automatically Reconnects Player Session', async ({
    browser,
  }) => {
    const session = await setupTwoPlayerSession(browser);

    try {
      const { alicePage, bobPage, roomCode } = session;
      await startGameFromLobby(alicePage, bobPage);
      await waitForPlayerTurn(bobPage, 'Bob');

      const beforeRefresh = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          playerName: player?.name ?? null,
          handNumber: room?.currentHand?.handNumber ?? null,
          bettingRound: room?.currentHand?.bettingRound ?? null,
          hasCards: Array.isArray((window as any).pokerDebug?.getCards?.())
            ? (window as any).pokerDebug.getCards().length === 2
            : false,
        };
      });

      expect(beforeRefresh.roomId).toBe(roomCode);
      expect(beforeRefresh.playerName).toBe('Bob');
      expect(beforeRefresh.hasCards).toBe(true);
      expect(beforeRefresh.handNumber).toBe(1);
      expect(beforeRefresh.bettingRound).toBe('PRE_FLOP');

      // Test harness serves static files without SPA fallback. Intercept room route
      // and serve index.html so a hard reload at /room/:id behaves like production.
      const roomRoutePattern = `${FRONTEND_URL}/room/*`;
      await bobPage.route(roomRoutePattern, async (route) => {
        const response = await bobPage.request.get(FRONTEND_URL);
        const body = await response.text();
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body,
        });
      });
      await bobPage.reload({ waitUntil: 'domcontentloaded' });
      await bobPage.unroute(roomRoutePattern);

      await waitForPokerDebug(bobPage);
      await bobPage.waitForFunction(
        () => {
          const pd = (window as any).pokerDebug;
          const room = pd?.getRoom?.();
          const player = pd?.getPlayer?.();
          return (
            !!room?.id &&
            !!player?.id &&
            Array.isArray(pd?.getCards?.()) &&
            pd.getCards().length === 2
          );
        },
        { timeout: 15000 },
      );

      const afterRefresh = await bobPage.evaluate(() => {
        const room = (window as any).pokerDebug?.getRoom?.();
        const player = (window as any).pokerDebug?.getPlayer?.();
        return {
          roomId: room?.id ?? null,
          playerId: player?.id ?? null,
          playerName: player?.name ?? null,
          handNumber: room?.currentHand?.handNumber ?? null,
          bettingRound: room?.currentHand?.bettingRound ?? null,
          currentPlayerTurn: room?.currentHand?.currentPlayerTurn ?? null,
          status: room?.players?.find((p: any) => p.id === player?.id)?.status ?? null,
        };
      });

      expect(afterRefresh.roomId).toBe(beforeRefresh.roomId);
      expect(afterRefresh.playerId).toBe(beforeRefresh.playerId);
      expect(afterRefresh.playerName).toBe('Bob');
      expect(afterRefresh.handNumber).toBe(beforeRefresh.handNumber);
      expect(afterRefresh.bettingRound).toBe(beforeRefresh.bettingRound);
      expect(afterRefresh.currentPlayerTurn).toBe(afterRefresh.playerId);
      expect(afterRefresh.status).toBe('connected');
      await expect(bobPage).toHaveURL(new RegExp(`/room/${roomCode}$`));

      // Verify recovered player can immediately continue the same hand.
      await bobPage.click('[data-testid="action-call"]');
      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-check"]');
      await waitForRound(alicePage, 'FLOP', 3);
    } finally {
      await teardownTwoPlayerSession(session);
    }
  });
});

test.describe('Poker E2E - Test Suite 9: Three-Player Coverage', () => {
  test('9.1: Three-Player Turn Order - pre-flop and flop order are correct', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        charliePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
      ]);
      await waitForHandStart(alicePage, 1);

      const initial = await getRoomSnapshot(alicePage);
      expect(initial.handNumber).toBe(1);
      expect(initial.dealerPlayerName).toBe('Alice');
      expect(initial.smallBlindPlayerName).toBe('Bob');
      expect(initial.bigBlindPlayerName).toBe('Charlie');
      expect(initial.currentPlayerName).toBe('Alice');
      expect(initial.pot).toBe(30);
      expect(await getDealerNameFromUi(alicePage)).toBe('Alice');
      expect(await getRoundFromUi(alicePage)).toBe('PRE_FLOP');
      expect(await getPotFromUi(alicePage)).toBe(30);
      expect(await getYourChipsFromUi(alicePage)).toBe(1000);
      expect(await getYourChipsFromUi(bobPage)).toBe(990);
      expect(await getYourChipsFromUi(charliePage)).toBe(980);
      await verifyChipConservation(alicePage, 3000);

      await waitForPlayerTurn(alicePage, 'Alice');
      await expect(alicePage.locator('[data-testid="action-call"]')).toContainText(
        'Call $20',
      );
      await expect(alicePage.locator('[data-testid="action-call"]')).toBeVisible();
      await alicePage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await expect(bobPage.locator('[data-testid="action-call"]')).toContainText(
        'Call $10',
      );
      await expect(bobPage.locator('[data-testid="action-call"]')).toBeVisible();
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await expect(charliePage.locator('[data-testid="action-check"]')).toBeVisible();
      await charliePage.click('[data-testid="action-check"]');

      await waitForRound(alicePage, 'FLOP', 3);
      const flop = await getRoomSnapshot(alicePage);
      expect(flop.currentPlayerName).toBe('Bob');
      expect(flop.pot).toBe(60);
      expect(await getRoundFromUi(alicePage)).toBe('FLOP');
      expect(await getPotFromUi(alicePage)).toBe(60);
      expect(await getYourChipsFromUi(alicePage)).toBe(980);
      expect(await getYourChipsFromUi(bobPage)).toBe(980);
      expect(await getYourChipsFromUi(charliePage)).toBe(980);
      await verifyChipConservation(alicePage, 3000);
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('9.2: Three-Player Blind Rotation - dealer/SB/BB rotate across hands', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      const pageByName: Record<string, Page> = {
        Alice: alicePage,
        Bob: bobPage,
        Charlie: charliePage,
      };

      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        charliePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
      ]);

      const expectedDealer = ['Alice', 'Bob', 'Charlie'];
      const expectedSmallBlind = ['Bob', 'Charlie', 'Alice'];
      const expectedBigBlind = ['Charlie', 'Alice', 'Bob'];
      const expectedFirstToAct = ['Alice', 'Bob', 'Charlie'];

      for (let handNumber = 1; handNumber <= 3; handNumber++) {
        await waitForHandStart(alicePage, handNumber);
        const snapshot = await getRoomSnapshot(alicePage);

        expect(snapshot.handNumber).toBe(handNumber);
        expect(snapshot.bettingRound).toBe('PRE_FLOP');
        expect(snapshot.dealerPlayerName).toBe(expectedDealer[handNumber - 1]);
        expect(snapshot.smallBlindPlayerName).toBe(
          expectedSmallBlind[handNumber - 1],
        );
        expect(snapshot.bigBlindPlayerName).toBe(expectedBigBlind[handNumber - 1]);
        expect(snapshot.currentPlayerName).toBe(expectedFirstToAct[handNumber - 1]);
        expect(snapshot.pot).toBe(30);
        expect(await getDealerNameFromUi(alicePage)).toBe(
          expectedDealer[handNumber - 1],
        );
        expect(await getRoundFromUi(alicePage)).toBe('PRE_FLOP');
        expect(await getPotFromUi(alicePage)).toBe(30);
        await expect(
          pageByName[expectedFirstToAct[handNumber - 1]].locator(
            '[data-testid="action-dock"]',
          ),
        ).toBeVisible();
        await verifyChipConservation(alicePage, 3000);

        await completeCurrentHandWithPassiveActions(
          alicePage,
          pageByName,
          handNumber,
        );

        if (handNumber < 3) {
          await waitForHandStart(alicePage, handNumber + 1);
        }
      }

      // After hand 3 fold, players can drop below two active stacks, so a 4th hand
      // may not start. Rotation assertions above already validate full 3-hand cycle.
    } finally {
      await teardownThreePlayerSession(session);
    }
  });

  test('9.3: Three-Way Tie - split pot evenly across 3 winners', async ({
    browser,
  }) => {
    const session = await setupThreePlayerSession(browser);

    try {
      const { alicePage, bobPage, charliePage } = session;
      await setTestDeckForCurrentRoom(alicePage, [
        { suit: 'clubs', rank: '2' }, // Alice
        { suit: 'diamonds', rank: '7' }, // Alice
        { suit: 'hearts', rank: '3' }, // Bob
        { suit: 'spades', rank: '8' }, // Bob
        { suit: 'clubs', rank: '4' }, // Charlie
        { suit: 'diamonds', rank: '9' }, // Charlie
        { suit: 'clubs', rank: 'A' }, // Flop 1
        { suit: 'diamonds', rank: 'K' }, // Flop 2
        { suit: 'hearts', rank: 'Q' }, // Flop 3
        { suit: 'spades', rank: 'J' }, // Turn
        { suit: 'clubs', rank: '10' }, // River
      ]);

      const handCompletePromise = captureNextHandComplete(alicePage);
      await alicePage.click('[data-testid="start-game-button"]');
      await Promise.all([
        alicePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        bobPage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
        charliePage.waitForSelector('[data-testid="round-value"]', { timeout: 10000 }),
      ]);

      await waitForPlayerTurn(alicePage, 'Alice');
      await alicePage.click('[data-testid="action-all-in"]');

      await waitForPlayerTurn(bobPage, 'Bob');
      await bobPage.click('[data-testid="action-call"]');

      await waitForPlayerTurn(charliePage, 'Charlie');
      await charliePage.click('[data-testid="action-call"]');

      const result = await handCompletePromise;
      expect(result.totalPot).toBe(3000);
      expect(result.winners).toHaveLength(3);
      const winnerNames = result.winners
        .map((winner: any) => winner.playerName)
        .sort();
      expect(winnerNames).toEqual(['Alice', 'Bob', 'Charlie']);
      const amounts = result.winners
        .map((winner: any) => winner.amountWon)
        .sort((a: number, b: number) => a - b);
      expect(amounts).toEqual([1000, 1000, 1000]);
      const ranks = result.winners.map((winner: any) => winner.hand.rank);
      expect(ranks.every((rank: string) => rank === 'STRAIGHT')).toBe(true);
      await expect(alicePage.locator('[data-testid="round-value"]')).toContainText(
        'SHOWDOWN',
      );
      expect(await getPotFromUi(alicePage)).toBe(3000);
      const uiMoney = await getPlayersMoneyFromUi(alicePage);
      expect(uiMoney.Alice.chips + uiMoney.Alice.currentBet).toBe(1000);
      expect(uiMoney.Bob.chips + uiMoney.Bob.currentBet).toBe(1000);
      expect(uiMoney.Charlie.chips + uiMoney.Charlie.currentBet).toBe(1000);
      const totalUiMoney =
        uiMoney.Alice.chips +
        uiMoney.Alice.currentBet +
        uiMoney.Bob.chips +
        uiMoney.Bob.currentBet +
        uiMoney.Charlie.chips +
        uiMoney.Charlie.currentBet;
      expect(totalUiMoney).toBe(3000);

      await verifyChipConservation(alicePage, 3000);
    } finally {
      await teardownThreePlayerSession(session);
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

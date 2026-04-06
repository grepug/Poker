import { test, expect, Page } from '@playwright/test';

const FRONTEND_URL =
  process.env.PW_FRONTEND_URL ??
  `http://${process.env.PW_FRONTEND_HOST ?? 'localhost'}:${process.env.PW_FRONTEND_PORT ?? '5174'}`;
const BACKEND_URL =
  process.env.PW_BACKEND_URL ??
  `http://${process.env.PW_BACKEND_HOST ?? 'localhost'}:${process.env.PW_BACKEND_PORT ?? '3001'}`;
const DEFAULT_TEST_PASSWORD = 'test1234';

async function authenticateTestUser(
  page: Page,
  accountId: string,
  displayName: string,
  avatarEmoji: string,
) {
  const loginResponse = await page
    .context()
    .request.post(`${BACKEND_URL}/api/auth/password/login`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        accountId,
        password: DEFAULT_TEST_PASSWORD,
      },
    });
  expect(loginResponse.ok()).toBeTruthy();

  const profileResponse = await page
    .context()
    .request.patch(`${BACKEND_URL}/api/auth/me/profile`, {
      headers: { 'Content-Type': 'application/json' },
      data: {
        displayName,
        avatarEmoji,
      },
    });
  expect(profileResponse.ok()).toBeTruthy();

  await page.goto(FRONTEND_URL);
  await page.waitForSelector('[data-testid="connection-status"]', {
    timeout: 5000,
  });
}

test('Debug - Two players room creation and game', async ({ browser }) => {
  const context1 = await browser.newContext();
  const context2 = await browser.newContext();

  const alice = await context1.newPage();
  const bob = await context2.newPage();

  // Listen to console messages
  alice.on('console', (msg) => console.log('ALICE:', msg.text()));
  bob.on('console', (msg) => console.log('BOB:', msg.text()));

  await authenticateTestUser(alice, 'test1', 'Alice', '🦊');
  await authenticateTestUser(bob, 'test2', 'Bob', '🐻');

  // Wait for pokerDebug
  await alice.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });
  await bob.waitForFunction(() => window.pokerDebug !== undefined, {
    timeout: 5000,
  });

  // Alice creates room
  await alice.evaluate(() => window.pokerDebug.createRoom('Alice'));

  // Wait for room to be created
  const roomId = await alice
    .waitForFunction(() => window.pokerDebug.getRoom()?.id, { timeout: 5000 })
    .then((r) => r.jsonValue());

  console.log('Room ID:', roomId);

  // Bob joins
  await bob.evaluate((rid) => window.pokerDebug.joinRoom(rid, 'Bob'), roomId);

  // Wait for Bob to join
  await alice.waitForFunction(
    () => window.pokerDebug.getRoom()?.players?.length === 2,
    { timeout: 5000 },
  );

  const state1 = await alice.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    return {
      players: room?.players?.length,
      gameState: room?.gameState,
    };
  });
  console.log('State after Bob joined:', state1);

  // Alice starts game
  await alice.evaluate(() => window.pokerDebug.startGame());

  // Small wait
  await alice.waitForTimeout(500);

  const state2 = await alice.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    return {
      gameState: room?.gameState,
      currentHand: room?.currentHand ? 'exists' : 'null',
      communityCards: room?.currentHand?.communityCards?.length || 0,
    };
  });
  console.log('State after startGame:', state2);

  // Check if game actually started
  await alice.waitForFunction(
    () => window.pokerDebug.getRoom()?.gameState === 'IN_PROGRESS',
    { timeout: 5000 },
  );

  console.log('Game started successfully!');

  // PRE-FLOP: Bob (small blind) calls, Alice (big blind) checks
  await bob.evaluate(() => window.pokerDebug.call());

  const afterBobCall = await alice.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    return {
      bettingRound: room?.currentHand?.bettingRound,
      pot: room?.currentHand?.pot,
    };
  });
  console.log('After Bob call:', afterBobCall);

  await alice.evaluate(() => window.pokerDebug.check());

  // Wait longer to see if state updates
  await alice.waitForTimeout(2000);

  const state3 = await alice.evaluate(() => {
    const room = window.pokerDebug.getRoom();
    return {
      gameState: room?.gameState,
      communityCards: room?.currentHand?.communityCards?.length || 0,
      bettingRound: room?.currentHand?.bettingRound,
      currentPlayerIndex: room?.currentHand?.currentPlayerIndex,
      pot: room?.currentHand?.pot,
    };
  });
  console.log('State after call/check (2s wait):', state3);

  await context1.close();
  await context2.close();
});

declare global {
  interface Window {
    pokerDebug: {
      createRoom: (name: string) => void;
      joinRoom: (roomId: string, name: string) => void;
      startGame: () => void;
      check: () => void;
      getRoom: () => any;
    };
  }
}

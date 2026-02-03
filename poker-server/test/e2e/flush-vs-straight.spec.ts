import { test, expect } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { Card } from 'poker-types';

/**
 * E2E Test: Flush vs Straight
 *
 * Scenario: Player1 makes a flush, Player2 makes a straight
 * Expected: Player1 wins (flush beats straight)
 */

const SERVER_URL = 'http://localhost:3001';

test.describe('Poker E2E - Flush vs Straight', () => {
  let player1Socket: Socket;
  let player2Socket: Socket;
  let roomId: string;

  test.beforeAll(() => {
    if (process.env.TEST_MODE !== 'true') {
      throw new Error('TEST_MODE must be set to "true" to run E2E tests');
    }
  });

  test.afterEach(async () => {
    player1Socket?.disconnect();
    player2Socket?.disconnect();
  });

  test('Flush beats straight', async () => {
    // Predetermined deck
    // Player1: K♥ Q♥ (with community hearts makes flush)
    // Player2: J♠ 10♠ (with community makes straight: 8-9-10-J-Q)
    // Community: 9♥ 8♥ 6♥ Q♣ 7♦
    const testDeck: Card[] = [
      { suit: 'hearts', rank: 'K' }, // Player1 hole 1
      { suit: 'spades', rank: 'J' }, // Player2 hole 1
      { suit: 'hearts', rank: 'Q' }, // Player1 hole 2
      { suit: 'spades', rank: '10' }, // Player2 hole 2
      { suit: 'hearts', rank: '9' }, // Flop 1
      { suit: 'hearts', rank: '8' }, // Flop 2
      { suit: 'hearts', rank: '6' }, // Flop 3
      { suit: 'clubs', rank: 'Q' }, // Turn
      { suit: 'diamonds', rank: '7' }, // River
    ];

    // Setup
    player1Socket = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      player1Socket.on('connect', () => resolve());
    });

    const createRoomPromise = new Promise<string>((resolve) => {
      player1Socket.once('roomCreated', (data: any) => {
        resolve(data.room.id);
      });
    });
    player1Socket.emit('createRoom', { playerName: 'Alice' });
    roomId = await createRoomPromise;

    await new Promise<void>((resolve, reject) => {
      player1Socket.emit(
        'setTestDeck',
        { roomId, deck: testDeck },
        (response: { success: boolean; error?: string }) => {
          response.success ? resolve() : reject(new Error(response.error));
        },
      );
    });

    player2Socket = io(SERVER_URL, { transports: ['websocket'] });
    await new Promise<void>((resolve) => {
      player2Socket.on('connect', () => resolve());
    });

    await new Promise<void>((resolve) => {
      player2Socket.once('playerJoined', () => resolve());
    });
    player2Socket.emit('joinRoom', { roomId, playerName: 'Bob' });

    await new Promise<void>((resolve) => {
      player1Socket.once('gameStarted', () => resolve());
    });
    player1Socket.emit('startGame', { roomId });

    await new Promise((resolve) => setTimeout(resolve, 500));

    // Play through - both players bet aggressively (they have strong hands)
    // PRE_FLOP
    player1Socket.emit('playerAction', {
      roomId,
      action: 'raise',
      amount: 100,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'call' });

    // FLOP - Alice sees flush draw, Bob sees straight draw
    await new Promise((resolve) => setTimeout(resolve, 500));
    player1Socket.emit('playerAction', {
      roomId,
      action: 'raise',
      amount: 200,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'call' });

    // TURN - both made their hands
    await new Promise((resolve) => setTimeout(resolve, 500));
    player1Socket.emit('playerAction', { roomId, action: 'check' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'check' });

    // RIVER
    await new Promise((resolve) => setTimeout(resolve, 500));
    player1Socket.emit('playerAction', { roomId, action: 'check' });
    await new Promise((resolve) => setTimeout(resolve, 200));
    player2Socket.emit('playerAction', { roomId, action: 'check' });

    // Wait for result
    const handCompletePromise = new Promise<any>((resolve) => {
      player1Socket.once('handComplete', (data: any) => {
        resolve(data);
      });
    });

    const result = await handCompletePromise;

    // Verify Alice (flush) wins over Bob (straight)
    expect(result.winners).toHaveLength(1);
    expect(result.winners[0].name).toBe('Alice');
    expect(result.winners[0].handRank).toBe('Flush');

    // Verify chip conservation
    const totalChips = result.players.reduce(
      (sum: number, p: any) => sum + p.chips,
      0,
    );
    expect(totalChips).toBe(2000);
  });
});

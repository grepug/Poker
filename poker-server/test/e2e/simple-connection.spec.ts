import { test, expect } from '@playwright/test';
import { io, Socket } from 'socket.io-client';
import { Card } from 'poker-types';

/**
 * Simple E2E Test - Connection and Room Creation
 * Tests basic connectivity and room creation without predetermined decks
 */

const SERVER_URL = 'http://localhost:3001';

test.describe('Poker E2E - Basic Connectivity', () => {
  let player1Socket: Socket;
  let player2Socket: Socket;

  test.afterEach(async () => {
    player1Socket?.disconnect();
    player2Socket?.disconnect();
  });

  test('Can create room and start game', async () => {
    // Connect Player 1
    player1Socket = io(SERVER_URL, {
      transports: ['websocket'],
      reconnection: false,
    });

    // Wait for connection
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Connection timeout')),
        5000,
      );
      player1Socket.on('connect', () => {
        clearTimeout(timeout);
        console.log('Player 1 connected:', player1Socket.id);
        resolve();
      });
      player1Socket.on('connect_error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Create room
    let roomId: string | undefined;
    const roomCreatedPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Room creation timeout')),
        5000,
      );
      player1Socket.once('ROOM_CREATED', (data: any) => {
        clearTimeout(timeout);
        console.log('Room created:', data);
        roomId = data.room.id;
        expect(roomId).toBeTruthy();
        expect(data.room.players).toHaveLength(1);
        expect(data.room.players[0].name).toBe('Alice');
        resolve();
      });
    });

    player1Socket.emit('CREATE_ROOM', { playerName: 'Alice' });
    await roomCreatedPromise;

    console.log('Testing complete - room ID:', roomId);
  });
});

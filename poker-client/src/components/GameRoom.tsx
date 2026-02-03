import React, { useState } from "react";
import { useGame } from "../contexts/GameContext";
import { Card } from "./Card";
import { PlayerSeat } from "./PlayerSeat";
import type { PlayerAction } from "poker-types";

export const GameRoom: React.FC = () => {
  const {
    room,
    player,
    yourCards,
    isHost,
    startGame,
    performAction,
    leaveRoom,
  } = useGame();
  const [raiseAmount, setRaiseAmount] = useState<number>(0);

  if (!room || !player) {
    return <div className="text-white">Loading...</div>;
  }

  const currentHand = room.currentHand;
  const isGameStarted = room.gameState === "IN_PROGRESS";
  const isYourTurn = currentHand?.currentPlayerTurn === player.id;

  const handleAction = (action: PlayerAction) => {
    if (action === "raise" || action === "all-in") {
      performAction(action, raiseAmount);
    } else {
      performAction(action);
    }
  };

  const minRaise = currentHand
    ? currentHand.currentBet * 2
    : room.config.bigBlind * 2;
  const canCheck = currentHand
    ? player.currentBet === currentHand.currentBet
    : false;

  return (
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-950 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-gray-900 rounded-lg p-4 mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-white">Room: {room.id}</h1>
            <p className="text-gray-400">
              Players: {room.players.length}/{room.config.maxPlayers}
            </p>
          </div>
          <div className="flex gap-4">
            {isHost && !isGameStarted && room.players.length >= 2 && (
              <button
                onClick={startGame}
                className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-semibold"
              >
                Start Game
              </button>
            )}
            <button
              onClick={leaveRoom}
              className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg"
            >
              Leave
            </button>
          </div>
        </div>

        {/* Poker Table */}
        <div className="relative bg-poker-felt rounded-full border-8 border-amber-900 p-12">
          {/* Pot */}
          {currentHand && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-yellow-600 rounded-full px-6 py-3">
              <div className="text-white font-bold text-xl">
                Pot: ${currentHand.pot}
              </div>
            </div>
          )}

          {/* Community Cards */}
          {currentHand && currentHand.communityCards.length > 0 && (
            <div className="absolute top-1/3 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex gap-2">
              {currentHand.communityCards.map((card, idx) => (
                <Card key={idx} card={card} size="medium" />
              ))}
            </div>
          )}

          {/* Players positioned around table */}
          <div className="grid grid-cols-3 gap-8">
            {/* Top row */}
            <div />
            {room.players[1] && (
              <PlayerSeat
                player={room.players[1]}
                position="top"
                isDealer={currentHand?.dealerPosition === 1}
                isCurrentPlayer={
                  currentHand?.currentPlayerTurn === room.players[1].id
                }
              />
            )}
            <div />
            {/* Middle row */}
            {room.players[2] && (
              <PlayerSeat
                player={room.players[2]}
                position="left"
                isDealer={currentHand?.dealerPosition === 2}
                isCurrentPlayer={
                  currentHand?.currentPlayerTurn === room.players[2].id
                }
              />
            )}
            <div /> {/* Center - pot and community cards */}
            {room.players[3] && (
              <PlayerSeat
                player={room.players[3]}
                position="right"
                isDealer={currentHand?.dealerPosition === 3}
                isCurrentPlayer={
                  currentHand?.currentPlayerTurn === room.players[3].id
                }
              />
            )}
            {/* Bottom row - You */}
            <div />
            <PlayerSeat
              player={player}
              position="bottom"
              showCards={true}
              isDealer={currentHand?.dealerPosition === 0}
              isCurrentPlayer={isYourTurn}
            />
            <div />
          </div>
        </div>

        {/* Your Cards (larger display) */}
        {yourCards && yourCards.length > 0 && (
          <div className="mt-6 bg-gray-900 rounded-lg p-4">
            <h3 className="text-white font-semibold mb-2">Your Cards</h3>
            <div className="flex gap-3">
              {yourCards.map((card, idx) => (
                <Card key={idx} card={card} size="large" />
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isYourTurn && (
          <div className="mt-6 bg-gray-900 rounded-lg p-6">
            <h3 className="text-white font-semibold mb-4">Your Turn</h3>
            <div className="flex gap-4 items-end">
              <button
                onClick={() => handleAction("fold")}
                className="bg-red-600 hover:bg-red-700 text-white px-6 py-3 rounded-lg font-semibold"
              >
                Fold
              </button>

              {canCheck ? (
                <button
                  onClick={() => handleAction("check")}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold"
                >
                  Check
                </button>
              ) : (
                <button
                  onClick={() => handleAction("call")}
                  className="bg-yellow-600 hover:bg-yellow-700 text-white px-6 py-3 rounded-lg font-semibold"
                >
                  Call ${currentHand?.currentBet || 0}
                </button>
              )}

              <div className="flex flex-col gap-2">
                <input
                  type="number"
                  min={minRaise}
                  max={player.chips}
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  className="px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700"
                  placeholder={`Min: $${minRaise}`}
                />
                <button
                  onClick={() => handleAction("raise")}
                  disabled={raiseAmount < minRaise}
                  className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50"
                >
                  Raise ${raiseAmount}
                </button>
              </div>

              <button
                onClick={() => handleAction("all-in")}
                className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-3 rounded-lg font-semibold"
              >
                All-In ${player.chips}
              </button>
            </div>
          </div>
        )}

        {/* Game Info */}
        <div className="mt-6 bg-gray-900 rounded-lg p-4">
          <h3 className="text-white font-semibold mb-2">Game Info</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div className="text-gray-400">
              Small Blind:{" "}
              <span className="text-white">${room.config.smallBlind}</span>
            </div>
            <div className="text-gray-400">
              Big Blind:{" "}
              <span className="text-white">${room.config.bigBlind}</span>
            </div>
            <div className="text-gray-400">
              Your Chips:{" "}
              <span className="text-green-400">${player.chips}</span>
            </div>
            {currentHand && (
              <div className="text-gray-400">
                Current Round:{" "}
                <span className="text-yellow-400">
                  {currentHand.bettingRound}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

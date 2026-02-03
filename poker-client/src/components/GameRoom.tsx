import React, { useState } from "react";
import { useGame } from "../contexts/GameContext";
import { Card } from "./Card";
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
    <div className="min-h-screen bg-gradient-to-b from-green-900 to-green-950 p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="bg-gray-900 rounded-lg p-3 mb-4 flex justify-between items-center">
          <div>
            <h1 className="text-xl font-bold text-white">Room: {room.id}</h1>
            <p className="text-gray-400 text-sm">
              Players: {room.players.length}/{room.config.maxPlayers}
            </p>
          </div>
          <div className="flex gap-2">
            {isHost && !isGameStarted && room.players.length >= 2 && (
              <button
                onClick={startGame}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg font-semibold text-sm"
              >
                Start Game
              </button>
            )}
            <button
              onClick={leaveRoom}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm"
            >
              Leave
            </button>
          </div>
        </div>

        {/* Pot and Community Cards */}
        {currentHand && (
          <div className="bg-poker-felt rounded-lg border-4 border-amber-900 p-4 mb-4">
            <div className="text-center mb-3">
              <div className="text-yellow-400 font-bold text-2xl">
                Pot: ${currentHand.pot}
              </div>
            </div>
            {currentHand.communityCards.length > 0 && (
              <div className="flex gap-2 justify-center">
                {currentHand.communityCards.map((card, idx) => (
                  <Card key={idx} card={card} size="medium" />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Players List */}
        <div className="bg-gray-900 rounded-lg p-4 mb-4">
          <h3 className="text-white font-semibold mb-3 text-sm">Players</h3>
          <div className="space-y-2">
            {room.players.map((p, idx) => {
              const isYou = p.id === player.id;
              const isCurrent = currentHand?.currentPlayerTurn === p.id;
              const isDealer = currentHand?.dealerPosition === idx;
              const isFolded = p.status === "folded";
              
              return (
                <div
                  key={p.id}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isCurrent ? "bg-yellow-900/50 ring-2 ring-yellow-400" : "bg-gray-800"
                  } ${isFolded ? "opacity-50" : ""}`}
                >
                  <div className="flex items-center gap-3 flex-1">
                    <div className="text-2xl font-bold text-gray-500">
                      #{idx + 1}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">
                          {p.name} {isYou && "(You)"}
                        </span>
                        {isDealer && (
                          <span className="bg-yellow-500 text-black px-2 py-0.5 rounded-full text-xs font-bold">
                            D
                          </span>
                        )}
                      </div>
                      <div className="text-green-400 text-sm">
                        ${p.chips}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {p.currentBet > 0 && (
                      <div className="text-yellow-300 text-sm font-semibold">
                        Bet: ${p.currentBet}
                      </div>
                    )}
                    {isFolded && (
                      <div className="text-red-400 text-xs">FOLDED</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Your Cards (larger display) */}
        {yourCards && yourCards.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 mb-4">
            <h3 className="text-white font-semibold mb-2 text-sm">Your Cards</h3>
            <div className="flex gap-3 justify-center">
              {yourCards.map((card, idx) => (
                <Card key={idx} card={card} size="large" />
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        {isYourTurn && (
          <div className="bg-gray-900 rounded-lg p-4 mb-4">
            <h3 className="text-white font-semibold mb-3 text-sm">Your Turn</h3>
            <div className="flex flex-col gap-3">
              <div className="flex gap-2">
                <button
                  onClick={() => handleAction("fold")}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white px-4 py-3 rounded-lg font-semibold"
                >
                  Fold
                </button>

                {canCheck ? (
                  <button
                    onClick={() => handleAction("check")}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-semibold"
                  >
                    Check
                  </button>
                ) : (
                  <button
                    onClick={() => handleAction("call")}
                    className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-3 rounded-lg font-semibold"
                  >
                    Call ${currentHand?.currentBet || 0}
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                <input
                  type="number"
                  min={minRaise}
                  max={player.chips}
                  value={raiseAmount}
                  onChange={(e) => setRaiseAmount(Number(e.target.value))}
                  className="flex-1 px-4 py-2 rounded-lg bg-gray-800 text-white border border-gray-700"
                  placeholder={`Min: $${minRaise}`}
                />
                <button
                  onClick={() => handleAction("raise")}
                  disabled={raiseAmount < minRaise}
                  className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg font-semibold disabled:opacity-50"
                >
                  Raise
                </button>
              </div>

              <button
                onClick={() => handleAction("all-in")}
                className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-3 rounded-lg font-semibold"
              >
                All-In ${player.chips}
              </button>
            </div>
          </div>
        )}

        {/* Game Info */}
        <div className="bg-gray-900 rounded-lg p-4">
          <h3 className="text-white font-semibold mb-2 text-sm">Game Info</h3>
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

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useGame } from "../contexts/GameContext";
import { useSocket } from "../contexts/SocketContext";

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const { connected } = useSocket();
  const { createRoom, joinRoom } = useGame();
  const [playerName, setPlayerName] = useState("");
  const [roomId, setRoomId] = useState("");
  const [isJoining, setIsJoining] = useState(false);

  const handleCreateRoom = () => {
    if (!playerName.trim()) {
      alert("Please enter your name");
      return;
    }
    createRoom(playerName);
    navigate("/room");
  };

  const handleJoinRoom = () => {
    if (!playerName.trim() || !roomId.trim()) {
      alert("Please enter your name and room code");
      return;
    }
    joinRoom(roomId, playerName);
    navigate("/room");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-900 to-gray-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-gray-800 rounded-xl shadow-2xl p-8">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-white mb-2">
            ♠️ Poker Game ♥️
          </h1>
          <p className="text-gray-400">Texas Hold'em Online</p>

          {/* Connection status */}
          <div className="mt-4">
            {connected ? (
              <span className="text-green-400 text-sm">● Connected</span>
            ) : (
              <span className="text-red-400 text-sm">● Disconnected</span>
            )}
          </div>
        </div>

        {/* Player Name Input */}
        <div className="mb-6">
          <label className="block text-white text-sm font-semibold mb-2">
            Your Name
          </label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Enter your name"
            className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
          />
        </div>

        {!isJoining ? (
          <>
            {/* Create Room */}
            <button
              onClick={handleCreateRoom}
              disabled={!connected}
              className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-3 rounded-lg transition-colors mb-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create New Room
            </button>

            {/* Join Room Toggle */}
            <button
              onClick={() => setIsJoining(true)}
              className="w-full border-2 border-green-600 text-green-400 hover:bg-green-600 hover:text-white font-semibold py-3 rounded-lg transition-colors"
            >
              Join Existing Room
            </button>
          </>
        ) : (
          <>
            {/* Room ID Input */}
            <div className="mb-4">
              <label className="block text-white text-sm font-semibold mb-2">
                Room Code
              </label>
              <input
                type="text"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                placeholder="Enter room code"
                className="w-full px-4 py-3 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>

            {/* Join Room */}
            <button
              onClick={handleJoinRoom}
              disabled={!connected}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-lg transition-colors mb-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Join Room
            </button>

            {/* Back */}
            <button
              onClick={() => setIsJoining(false)}
              className="w-full border-2 border-gray-600 text-gray-400 hover:bg-gray-700 font-semibold py-3 rounded-lg transition-colors"
            >
              Back
            </button>
          </>
        )}

        {/* Rules */}
        <div className="mt-8 text-center">
          <p className="text-gray-500 text-sm">
            2-10 players • Texas Hold'em rules
          </p>
        </div>
      </div>
    </div>
  );
};

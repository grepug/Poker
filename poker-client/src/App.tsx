import { useEffect } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  useNavigate,
  useParams,
} from "react-router-dom";
import { SocketProvider } from "./contexts/SocketContext";
import { GameProvider, useGame } from "./contexts/GameContext";
import { Home } from "./pages/Home";
import { GameRoom } from "./components/GameRoom";

const RoomRoute: React.FC = () => {
  const navigate = useNavigate();
  const { roomId } = useParams();
  const { room, player } = useGame();

  useEffect(() => {
    if (!room?.id) return;
    if (roomId !== room.id) {
      navigate(`/room/${room.id}`, { replace: true });
    }
  }, [navigate, room?.id, roomId]);

  if (!room || !player) {
    return <Home prefilledRoomId={roomId} forceJoinMode={Boolean(roomId)} />;
  }

  return <GameRoom />;
};

function App() {
  return (
    <Router>
      <SocketProvider>
        <GameProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room" element={<RoomRoute />} />
            <Route path="/room/:roomId" element={<RoomRoute />} />
          </Routes>
        </GameProvider>
      </SocketProvider>
    </Router>
  );
}

export default App;

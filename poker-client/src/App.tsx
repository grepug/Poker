import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import { SocketProvider } from "./contexts/SocketContext";
import { GameProvider } from "./contexts/GameContext";
import { Home } from "./pages/Home";
import { GameRoom } from "./components/GameRoom";

function App() {
  return (
    <Router>
      <SocketProvider>
        <GameProvider>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/room" element={<GameRoom />} />
            <Route path="/room/:roomId" element={<GameRoom />} />
          </Routes>
        </GameProvider>
      </SocketProvider>
    </Router>
  );
}

export default App;

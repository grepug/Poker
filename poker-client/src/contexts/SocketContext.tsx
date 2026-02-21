/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "poker-types";
import { socketService } from "../services/socket.service";

interface SocketContextType {
  socket: Socket<ServerToClientEvents, ClientToServerEvents> | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
});

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error("useSocket must be used within SocketProvider");
  }
  return context;
};

interface SocketProviderProps {
  children: ReactNode;
  authToken: string | null;
}

export const SocketProvider: React.FC<SocketProviderProps> = ({ children, authToken }) => {
  const [socket, setSocket] = useState<Socket<
    ServerToClientEvents,
    ClientToServerEvents
  > | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!authToken) {
      socketService.disconnect();
      setSocket(null);
      setConnected(false);
      return;
    }

    const nextSocket = socketService.connect(undefined, authToken);
    setSocket(nextSocket);
    setConnected(socketService.isConnected());
  }, [authToken]);

  useEffect(() => {
    return () => {
      socketService.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!socket) return;

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
};

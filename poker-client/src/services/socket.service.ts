import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "poker-types";

const resolveSocketUrl = (explicitUrl?: string) => {
  if (explicitUrl && explicitUrl.trim()) {
    return explicitUrl.trim();
  }

  const envUrl = import.meta.env.VITE_SERVER_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  const envProtocol = import.meta.env.VITE_SERVER_PROTOCOL?.trim();
  const envHost = import.meta.env.VITE_SERVER_HOST?.trim();
  const envPort = import.meta.env.VITE_SERVER_PORT?.trim() || "3001";

  if (typeof window !== "undefined") {
    const protocol = envProtocol || window.location.protocol.replace(":", "") || "http";
    const host = envHost || window.location.hostname;
    return `${protocol}://${host}:${envPort}`;
  }

  const protocol = envProtocol || "http";
  const host = envHost || "127.0.0.1";
  return `${protocol}://${host}:${envPort}`;
};

class SocketService {
  private socket: Socket<ServerToClientEvents, ClientToServerEvents> | null =
    null;

  connect(url?: string) {
    if (this.socket?.connected) {
      return this.socket;
    }

    const socketUrl = resolveSocketUrl(url);

    this.socket = io(socketUrl, {
      transports: ["websocket"],
      autoConnect: true,
    });

    this.socket.on("connect", () => {
      console.log("Connected to server", socketUrl);
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from server");
    });

    return this.socket;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  getSocket() {
    return this.socket;
  }

  isConnected() {
    return this.socket?.connected || false;
  }
}

export const socketService = new SocketService();

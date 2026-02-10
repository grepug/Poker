import { io, Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "poker-types";

type RuntimePokerConfig = {
  serverUrl?: string;
  serverProtocol?: string;
  serverHost?: string;
  serverPort?: string;
};

declare global {
  interface Window {
    __POKER_RUNTIME_CONFIG__?: RuntimePokerConfig;
    __POKER_SERVER_URL__?: string;
  }
}

const readRuntimeConfig = (): RuntimePokerConfig | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  return window.__POKER_RUNTIME_CONFIG__;
};

const resolveSocketUrl = (explicitUrl?: string) => {
  if (explicitUrl && explicitUrl.trim()) {
    return explicitUrl.trim();
  }

  if (typeof window !== "undefined") {
    const runtimeUrl = window.__POKER_SERVER_URL__?.trim();
    if (runtimeUrl) {
      return runtimeUrl;
    }

    const sessionUrl = window.sessionStorage
      .getItem("poker.serverUrlOverride")
      ?.trim();
    if (sessionUrl) {
      return sessionUrl;
    }

    const queryUrl = new URLSearchParams(window.location.search)
      .get("server")
      ?.trim();
    if (queryUrl) {
      window.sessionStorage.setItem("poker.serverUrlOverride", queryUrl);
      return queryUrl;
    }
  }

  const runtimeConfig = readRuntimeConfig();
  const runtimeConfigUrl = runtimeConfig?.serverUrl?.trim();
  if (runtimeConfigUrl) {
    return runtimeConfigUrl;
  }

  const envUrl = import.meta.env.VITE_SERVER_URL?.trim();
  if (envUrl) {
    return envUrl;
  }

  const runtimeProtocol = runtimeConfig?.serverProtocol?.trim();
  const runtimeHost = runtimeConfig?.serverHost?.trim();
  const runtimePort = runtimeConfig?.serverPort?.trim();
  const envProtocol = import.meta.env.VITE_SERVER_PROTOCOL?.trim();
  const envHost = import.meta.env.VITE_SERVER_HOST?.trim();
  const envPort = import.meta.env.VITE_SERVER_PORT?.trim();
  const port = runtimePort || envPort || "3001";

  if (typeof window !== "undefined") {
    const protocol =
      runtimeProtocol ||
      envProtocol ||
      window.location.protocol.replace(":", "") ||
      "http";
    const host = runtimeHost || envHost || window.location.hostname;
    return `${protocol}://${host}:${port}`;
  }

  const protocol = runtimeProtocol || envProtocol || "http";
  const host = runtimeHost || envHost || "127.0.0.1";
  return `${protocol}://${host}:${port}`;
};

export const resolveServerBaseUrl = (explicitUrl?: string) =>
  resolveSocketUrl(explicitUrl);

export const resolveServerResourceUrl = (
  resourcePath: string,
  explicitUrl?: string,
): string => {
  if (resourcePath.startsWith("http://") || resourcePath.startsWith("https://")) {
    return resourcePath;
  }

  const normalizedPath = resourcePath.startsWith("/")
    ? resourcePath
    : `/${resourcePath}`;

  const baseUrl = resolveServerBaseUrl(explicitUrl).trim();
  if (!baseUrl || baseUrl === "/") {
    return normalizedPath;
  }

  if (baseUrl.startsWith("/")) {
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    return normalizedBase ? `${normalizedBase}${normalizedPath}` : normalizedPath;
  }

  try {
    const parsedBase = new URL(baseUrl);
    return `${parsedBase.origin}${normalizedPath}`;
  } catch {
    const normalizedBase = baseUrl.replace(/\/+$/, "");
    return `${normalizedBase}${normalizedPath}`;
  }
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

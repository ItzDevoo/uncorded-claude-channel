import WebSocket from "ws";
import { Op, encode, decode, type HelloData, type ReadyData, type MessageData, type Frame } from "./msgpack.js";

const OpName: Record<number, string> = Object.fromEntries(
  Object.entries(Op).map(([k, v]) => [v, k]),
);

export type MessageHandler = (message: MessageData) => void;
export type ReadyHandler = (data: ReadyData) => void;
export type ErrorHandler = (error: Error) => void;
export type ConnectedHandler = () => void;
export type DisconnectedHandler = () => void;

interface UnCordedClientOptions {
  token: string;
  gatewayUrl?: string;
}

export class UnCordedClient {
  private ws: WebSocket | null = null;
  private token: string;
  private gatewayUrl: string;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastAck = true;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 60_000;
  private baseReconnectDelay = 5_000;
  private isDestroyed = false;

  // Event handlers
  public onMessage: MessageHandler | null = null;
  public onReady: ReadyHandler | null = null;
  public onError: ErrorHandler | null = null;
  public onConnected: ConnectedHandler | null = null;
  public onDisconnected: DisconnectedHandler | null = null;

  constructor(options: UnCordedClientOptions) {
    this.token = options.token;
    this.gatewayUrl = options.gatewayUrl ?? "wss://api.uncorded.app/gateway";
  }

  connect(): void {
    if (this.isDestroyed) return;
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) return;

    try {
      this.ws = new WebSocket(this.gatewayUrl);
      this.ws.binaryType = "nodebuffer";

      this.ws.on("open", () => {
        this.reconnectAttempts = 0;
        this.onConnected?.();
      });

      this.ws.on("message", (data: Buffer) => {
        try {
          const frame = decode(data);
          this.handleFrame(frame);
        } catch (err) {
          console.error("[uncorded] Failed to process frame:", err);
        }
      });

      this.ws.on("close", (code, reason) => {
        console.error(`[uncorded] WebSocket closed: ${code} ${reason.toString()}`);
        this.cleanup();
        this.onDisconnected?.();
        this.scheduleReconnect();
      });

      this.ws.on("error", (err) => {
        console.error("[uncorded] WebSocket error:", err.message);
        this.onError?.(err);
      });
    } catch (err) {
      console.error("[uncorded] Failed to create WebSocket:", err);
      this.scheduleReconnect();
    }
  }

  private handleFrame(frame: Frame): void {
    console.error(`[uncorded] << opcode ${frame.op} (${OpName[frame.op] ?? "UNKNOWN"})`);

    switch (frame.op) {
      case Op.HELLO: {
        const data = frame.d as HelloData;
        this.startHeartbeat(data.heartbeatInterval);
        // Send IDENTIFY
        this.send({ op: Op.IDENTIFY, d: { token: this.token } });
        break;
      }

      case Op.READY: {
        const data = frame.d as ReadyData;
        console.error(`[uncorded] Connected as ${data.user.username} (${data.user.id})`);
        this.onReady?.(data);
        break;
      }

      case Op.HEARTBEAT_ACK: {
        this.lastAck = true;
        break;
      }

      case Op.MESSAGE_CREATE: {
        const data = frame.d as MessageData;
        this.onMessage?.(data);
        break;
      }

      default: {
        console.error(`[uncorded] Unknown opcode: ${frame.op}`);
        break;
      }
    }
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    this.lastAck = true;

    this.heartbeatTimer = setInterval(() => {
      if (!this.lastAck) {
        console.error("[uncorded] Heartbeat ACK not received, reconnecting...");
        this.ws?.close();
        return;
      }
      this.lastAck = false;
      this.send({ op: Op.HEARTBEAT, d: {} });
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private send(frame: Frame): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(frame));
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.isDestroyed) return;

    const delay = Math.min(
      this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay,
    );
    this.reconnectAttempts++;

    console.error(`[uncorded] Reconnecting in ${delay / 1000}s (attempt ${this.reconnectAttempts})...`);

    setTimeout(() => {
      if (!this.isDestroyed) {
        this.connect();
      }
    }, delay);
  }

  destroy(): void {
    this.isDestroyed = true;
    this.cleanup();
  }
}

import { pack, unpack } from "msgpackr";

/** UnCorded gateway opcodes */
export const Op = {
  HELLO: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  READY: 3,
  HEARTBEAT_ACK: 4,
  MESSAGE_CREATE: 10,
} as const;

export interface Frame {
  op: number;
  d: unknown;
}

export interface HelloData {
  heartbeatInterval: number;
}

export interface ReadyData {
  user: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    status: string;
    subscriptionTier: string;
    isBot: boolean;
  };
  servers: unknown[];
  dmChannels: unknown[];
  friends: unknown[];
}

export interface MessageData {
  id: string;
  channelId: string;
  content: string;
  author: {
    id: string;
    username: string;
    displayName: string | null;
    avatarUrl: string | null;
    isBot: boolean;
  };
  createdAt: string;
  fileReceipt: unknown | null;
}

export function encode(frame: Frame): Buffer {
  return pack(frame);
}

export function decode(data: Buffer | ArrayBuffer | Buffer[]): Frame {
  const buf = Buffer.isBuffer(data)
    ? data
    : Array.isArray(data)
      ? Buffer.concat(data)
      : Buffer.from(data);
  return unpack(buf) as Frame;
}

#!/usr/bin/env bun
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type Notification,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { UnCordedClient } from "./lib/uncorded-client.js";
import { loadConfig } from "./lib/config.js";
import { gate, setOwnerId, setBotUserId } from "./lib/access.js";
import type { MessageData, ReadyData } from "./lib/msgpack.js";

// --- Custom notification types for the channel protocol ---

interface ChannelMessageNotification extends Notification {
  method: "notifications/message/create";
  params: {
    source: string;
    chat_id: string;
    user: string;
    user_id: string;
    message_id: string;
    ts: string;
    content: string;
  };
}

interface PermissionResponseNotification extends Notification {
  method: "notifications/claude/channel/permission_response";
  params: {
    id: string;
    approved: boolean;
  };
}

type CustomNotification = ChannelMessageNotification | PermissionResponseNotification;

// --- API helpers ---

let apiUrl = "https://api.uncorded.app";
let botToken: string | null = null;

async function apiRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: unknown }> {
  if (!botToken) {
    return { ok: false, status: 0, data: "Bot token not configured" };
  }

  const url = `${apiUrl}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${botToken}`,
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    console.error("[uncorded] API request failed:", err);
    return { ok: false, status: 0, data: `Network error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function sendMessage(channelId: string, content: string): Promise<{ ok: boolean; data: unknown }> {
  return apiRequest("POST", `/api/channels/${channelId}/messages`, { content });
}

async function editMessage(
  channelId: string,
  messageId: string,
  content: string,
): Promise<{ ok: boolean; data: unknown }> {
  return apiRequest("PATCH", `/api/channels/${channelId}/messages/${messageId}`, { content });
}

async function fetchMessages(
  channelId: string,
  limit = 50,
): Promise<{ ok: boolean; data: unknown }> {
  return apiRequest("GET", `/api/channels/${channelId}/messages?limit=${Math.min(limit, 100)}`);
}

// --- MCP Server ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mcp = new Server<any, CustomNotification, any>(
  { name: "uncorded", version: "0.0.1" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
        "claude/channel/permission": {},
      },
      tools: {},
    },
    instructions: `Messages from UnCorded arrive as <channel source="uncorded" chat_id="..." user="..." ts="...">.
Reply with the reply tool — pass chat_id back.
reply accepts only text (no file attachments yet).
Use edit_message for interim progress updates.
Edits don't trigger push notifications — when a long task completes, send a new reply so the user's device pings.
fetch_messages pulls real UnCorded history.`,
  },
);

// --- Tool definitions ---

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "reply",
      description: "Send a message to an UnCorded channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string", description: "Channel ID to send to" },
          text: { type: "string", description: "Message content (1-4000 chars)" },
        },
        required: ["chat_id", "text"],
      },
    },
    {
      name: "fetch_messages",
      description: "Fetch message history from an UnCorded channel",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string", description: "Channel ID" },
          limit: { type: "number", description: "Number of messages (max 100, default 50)" },
        },
        required: ["chat_id"],
      },
    },
    {
      name: "edit_message",
      description: "Edit a previously sent message (must be the bot's own message)",
      inputSchema: {
        type: "object" as const,
        properties: {
          chat_id: { type: "string", description: "Channel ID" },
          message_id: { type: "string", description: "Message ID to edit" },
          text: { type: "string", description: "New message content (1-4000 chars)" },
        },
        required: ["chat_id", "message_id", "text"],
      },
    },
  ],
}));

// --- Tool handlers ---

mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "reply": {
      const chatId = args?.chat_id as string;
      const text = args?.text as string;

      if (!chatId || typeof chatId !== "string") {
        return { content: [{ type: "text", text: "Error: chat_id is required" }], isError: true };
      }
      if (!text || text.length === 0) {
        return { content: [{ type: "text", text: "Error: message text cannot be empty" }] };
      }
      if (text.length > 4000) {
        return { content: [{ type: "text", text: "Error: message text exceeds 4000 character limit" }] };
      }

      const result = await sendMessage(chatId, text);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error sending message: ${JSON.stringify(result.data)}` }],
          isError: true,
        };
      }

      const msg = result.data as { id: string };
      return { content: [{ type: "text", text: `Message sent (id: ${msg.id})` }] };
    }

    case "fetch_messages": {
      const chatId = args?.chat_id as string;
      const limit = (args?.limit as number) || 50;

      if (!chatId || typeof chatId !== "string") {
        return { content: [{ type: "text", text: "Error: chat_id is required" }], isError: true };
      }
      if (limit < 1 || limit > 100) {
        return { content: [{ type: "text", text: "Error: limit must be between 1 and 100" }], isError: true };
      }

      const result = await fetchMessages(chatId, limit);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error fetching messages: ${JSON.stringify(result.data)}` }],
          isError: true,
        };
      }

      const messages = result.data as Array<{
        id: string;
        content: string;
        author: { username: string; id: string; isBot: boolean };
        createdAt: string;
      }>;

      const formatted = messages
        .map((m) => {
          const tag = m.author.isBot ? " [BOT]" : "";
          return `[${m.createdAt}] ${m.author.username}${tag} (${m.id}): ${m.content}`;
        })
        .join("\n");

      return { content: [{ type: "text", text: formatted || "(no messages)" }] };
    }

    case "edit_message": {
      const chatId = args?.chat_id as string;
      const messageId = args?.message_id as string;
      const text = args?.text as string;

      if (!chatId || typeof chatId !== "string") {
        return { content: [{ type: "text", text: "Error: chat_id is required" }], isError: true };
      }
      if (!messageId || typeof messageId !== "string") {
        return { content: [{ type: "text", text: "Error: message_id is required" }], isError: true };
      }
      if (!text || text.length === 0) {
        return { content: [{ type: "text", text: "Error: message text cannot be empty" }] };
      }
      if (text.length > 4000) {
        return { content: [{ type: "text", text: "Error: message text exceeds 4000 character limit" }] };
      }

      const result = await editMessage(chatId, messageId, text);
      if (!result.ok) {
        return {
          content: [{ type: "text", text: `Error editing message: ${JSON.stringify(result.data)}` }],
          isError: true,
        };
      }

      return { content: [{ type: "text", text: `Message edited (id: ${messageId})` }] };
    }

    default:
      return {
        content: [{ type: "text", text: `Unknown tool: ${name}` }],
        isError: true,
      };
  }
});

// --- Permission relay ---

const pendingPermissions = new Map<string, string>();
let ownerDmChannelId: string | null = null;

const PermissionRequestSchema = z.object({
  method: z.literal("notifications/claude/channel/permission_request"),
  params: z.object({
    id: z.string(),
    description: z.string(),
    tool_name: z.string().optional(),
    arguments: z.unknown().optional(),
  }),
});

function setupPermissionRelay(): void {
  mcp.setNotificationHandler(PermissionRequestSchema, async ({ params }) => {
    if (!ownerDmChannelId) {
      console.error("[uncorded] No owner DM channel available for permission relay");
      return;
    }

    const promptText = [
      `**Permission Request** (id: \`${params.id}\`)`,
      params.tool_name ? `Tool: \`${params.tool_name}\`` : null,
      `Description: ${params.description}`,
      params.arguments ? `Arguments: \`${JSON.stringify(params.arguments)}\`` : null,
      "",
      `Reply \`yes ${params.id}\` to approve or \`no ${params.id}\` to deny.`,
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const result = await sendMessage(ownerDmChannelId, promptText);
      if (!result.ok) {
        console.error("[uncorded] Failed to send permission relay message:", result.data);
        return;
      }
      pendingPermissions.set(params.id, ownerDmChannelId);
    } catch (err) {
      console.error("[uncorded] Error sending permission relay message:", err);
    }
  });
}

function handlePermissionResponse(content: string, channelId: string): boolean {
  const match = content.match(/^(yes|no)\s+(\S+)/i);
  if (!match) return false;

  const [, verdict, id] = match;
  const expectedChannelId = pendingPermissions.get(id);
  if (!expectedChannelId) return false;
  if (expectedChannelId !== channelId) return false;

  pendingPermissions.delete(id);

  mcp.notification({
    method: "notifications/claude/channel/permission_response",
    params: {
      id,
      approved: verdict.toLowerCase() === "yes",
    },
  } satisfies PermissionResponseNotification);

  return true;
}

// --- Message delivery to Claude ---

function deliverMessage(message: MessageData): void {
  const user = message.author.displayName || message.author.username;

  mcp.notification({
    method: "notifications/message/create",
    params: {
      source: "uncorded",
      chat_id: message.channelId,
      user,
      user_id: message.author.id,
      message_id: message.id,
      ts: message.createdAt,
      content: message.content,
    },
  } satisfies ChannelMessageNotification);
}

// --- Startup ---

async function main(): Promise<void> {
  const config = await loadConfig();

  if (!config.botToken) {
    console.error("[uncorded] No bot token configured. Use /uncorded:configure to set up.");
    const transport = new StdioServerTransport();
    await mcp.connect(transport);
    return;
  }

  botToken = config.botToken;
  apiUrl = config.apiUrl;

  if (config.ownerId) {
    setOwnerId(config.ownerId);
  } else {
    console.error("[uncorded] Warning: No owner ID configured. Use /uncorded:configure to set owner ID.");
  }

  setupPermissionRelay();

  const client = new UnCordedClient({
    token: config.botToken,
    gatewayUrl: (() => {
      const url = new URL("/gateway", config.apiUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      return url.toString();
    })(),
  });

  client.onReady = (data: ReadyData) => {
    setBotUserId(data.user.id);
    console.error(`[uncorded] Bot user: ${data.user.username} (${data.user.id})`);
    console.error(`[uncorded] READY payload: ${data.dmChannels.length} DM channels, ownerId=${config.ownerId ?? "(none)"}`);

    if (config.ownerId) {
      const ownerDm = data.dmChannels.find((ch) =>
        ch.participants?.some((p) => p.id === config.ownerId),
      );
      if (ownerDm) {
        ownerDmChannelId = ownerDm.id;
        console.error(`[uncorded] Owner DM channel (from READY): ${ownerDmChannelId}`);
      } else {
        console.error(
          "[uncorded] Owner DM channel not in READY payload (paginated?) — will learn from first owner message",
        );
      }
    }
  };

  client.onMessage = (message: MessageData) => {
    console.error(
      `[uncorded] MESSAGE_CREATE author=${message.author.username}(${message.author.id}) ` +
      `isBot=${message.author.isBot} channel=${message.channelId} ` +
      `content=${JSON.stringify(message.content.slice(0, 120))}`,
    );

    // Dynamically learn the owner's DM channel if we didn't get it from READY
    if (message.author.id === config.ownerId && !ownerDmChannelId) {
      ownerDmChannelId = message.channelId;
      console.error(`[uncorded] Owner DM channel (learned from message): ${ownerDmChannelId}`);
    }

    // Check if this is a permission response from the owner
    if (
      message.author.id === config.ownerId &&
      !message.author.isBot &&
      handlePermissionResponse(message.content, message.channelId)
    ) {
      console.error(`[uncorded] Message consumed as permission response`);
      return;
    }

    if (!gate(message)) return;

    console.error(`[uncorded] Delivering message ${message.id} to Claude`);
    deliverMessage(message);
  };

  client.onError = (err: Error) => {
    console.error(`[uncorded] Client error: ${err.message}`);
  };

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  client.connect();

  const shutdown = () => {
    console.error("[uncorded] Shutting down...");
    client.destroy();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.stdin.on("end", shutdown);

  process.on("unhandledRejection", (err) => {
    console.error("[uncorded] Unhandled rejection:", err);
  });
}

main().catch((err) => {
  console.error("[uncorded] Fatal error:", err);
  process.exit(1);
});

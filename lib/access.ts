let ownerId: string | null = null;
let botUserId: string | null = null;

export function setOwnerId(id: string): void {
  ownerId = id;
}

export function getOwnerId(): string | null {
  return ownerId;
}

export function setBotUserId(id: string): void {
  botUserId = id;
}

export function getBotUserId(): string | null {
  return botUserId;
}

export function isOwner(userId: string): boolean {
  return ownerId !== null && userId === ownerId;
}

export function isSelf(userId: string): boolean {
  return botUserId !== null && userId === botUserId;
}

/**
 * Gate function — returns true if the message should be delivered to Claude.
 * Only owner messages pass; bot's own messages and all others are dropped.
 */
export function gate(message: { author: { id: string; isBot: boolean } }): boolean {
  // Ignore messages from any bot (including self)
  if (message.author.isBot) return false;

  // Only deliver messages from the owner
  if (!isOwner(message.author.id)) return false;

  return true;
}

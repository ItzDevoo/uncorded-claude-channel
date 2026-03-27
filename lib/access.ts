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
  // Ignore messages from the bot itself
  if (isSelf(message.author.id)) {
    console.error(`[uncorded] gate: DROPPED (self) author=${message.author.id}`);
    return false;
  }

  // Only deliver messages from the owner — isBot doesn't matter,
  // the owner check is sufficient and isBot could be incorrect
  if (!isOwner(message.author.id)) {
    console.error(`[uncorded] gate: DROPPED (not owner) author=${message.author.id} ownerId=${ownerId}`);
    return false;
  }

  console.error(`[uncorded] gate: PASSED author=${message.author.id}`);
  return true;
}

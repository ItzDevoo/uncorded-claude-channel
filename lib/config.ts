import { join } from "path";
import { homedir } from "os";

export interface Config {
  botToken: string | null;
  ownerId: string | null;
  apiUrl: string;
}

const CONFIG_DIR = join(homedir(), ".claude", "channels", "uncorded");
const CONFIG_FILE = join(CONFIG_DIR, ".env");

function parseEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    result[key] = value;
  }
  return result;
}

function serializeEnv(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n") + "\n";
}

export async function loadConfig(): Promise<Config> {
  const defaults: Config = {
    botToken: null,
    ownerId: null,
    apiUrl: "https://api.uncorded.app",
  };

  try {
    const file = Bun.file(CONFIG_FILE);
    if (!(await file.exists())) return defaults;
    const content = await file.text();
    const vars = parseEnv(content);

    return {
      botToken: vars.UNCORDED_BOT_TOKEN || null,
      ownerId: vars.UNCORDED_OWNER_ID || null,
      apiUrl: vars.UNCORDED_API_URL || defaults.apiUrl,
    };
  } catch (err) {
    console.error("[uncorded] Failed to load config:", err);
    return defaults;
  }
}

export async function saveConfig(config: Partial<Config>): Promise<void> {
  // Load existing config and merge
  const existing = await loadConfig();
  const merged = { ...existing, ...config };

  const vars: Record<string, string> = {};
  if (merged.botToken) vars.UNCORDED_BOT_TOKEN = merged.botToken;
  if (merged.ownerId) vars.UNCORDED_OWNER_ID = merged.ownerId;
  if (merged.apiUrl) vars.UNCORDED_API_URL = merged.apiUrl;

  // Ensure directory exists with restricted permissions
  const { mkdir, chmod } = await import("fs/promises");
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  await chmod(CONFIG_DIR, 0o700);

  // Write file with restricted permissions
  await Bun.write(CONFIG_FILE, serializeEnv(vars), { mode: 0o600 });
}

export async function clearConfig(): Promise<void> {
  try {
    const { unlink } = await import("fs/promises");
    await unlink(CONFIG_FILE);
  } catch {
    // File doesn't exist, that's fine
  }
}

export function maskToken(token: string): string {
  if (token.length <= 10) return "***";
  return token.slice(0, 8) + "..." + token.slice(-4);
}

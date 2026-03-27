# /uncorded:configure

Configure your UnCorded channel plugin for Claude Code.

## Usage

- `/uncorded:configure` — Show current configuration status
- `/uncorded:configure <bot_token>` — Set bot token (e.g., `uncrd_a1b2c3...`)
- `/uncorded:configure owner <user_id>` — Set the owner's UnCorded user ID
- `/uncorded:configure clear` — Remove all stored credentials

## Setup Flow

1. Create a bot in UnCorded (Settings → Bots → Create Bot)
2. Copy the bot token (starts with `uncrd_`)
3. Run `/uncorded:configure uncrd_your_token_here`
4. Find your UnCorded user ID (Settings → Account)
5. Run `/uncorded:configure owner your_user_id`
6. Restart the plugin or Claude Code session

## What Gets Stored

Credentials are saved to `~/.claude/channels/uncorded/.env` with restricted file permissions (0600):

```
UNCORDED_BOT_TOKEN=uncrd_...
UNCORDED_OWNER_ID=...
UNCORDED_API_URL=https://api.uncorded.app
```

## Implementation

When the user runs this skill:

### No arguments — show status
Read the config from `~/.claude/channels/uncorded/.env` and display:
- Token: configured (masked) or not configured
- Owner ID: configured or not configured
- API URL: current value

### Token argument
1. Validate it starts with `uncrd_`
2. Save to config file
3. Confirm with masked token display

### `owner <id>` argument
1. Save the owner ID to config
2. Confirm

### `clear` argument
1. Delete the config file
2. Confirm removal

### `api <url>` argument
1. Save custom API URL to config
2. Confirm

# /uncorded:access

Manage access control for the UnCorded channel plugin.

## Usage

- `/uncorded:access` — Show current access status
- `/uncorded:access set owner <user_id>` — Set the owner's UnCorded user ID
- `/uncorded:access set api <url>` — Change the API URL

## How Access Works

The UnCorded channel plugin uses **owner-only** access control:

- Only messages from the configured owner are forwarded to Claude
- All other messages (from other users, bots) are silently dropped
- The bot responds in any channel, but only to its owner's messages
- In server channels, other users can see the bot's responses but cannot trigger it

## Implementation

When the user runs this skill:

### No arguments — show status

Display:
- Owner ID: current value or "not configured"
- Bot connected: yes/no
- API URL: current value

### `set owner <id>`

1. Save the owner ID to config via `saveConfig({ ownerId: id })`
2. Update the runtime access control via `setOwnerId(id)`
3. Confirm the change

### `set api <url>`

1. Validate URL format
2. Save to config via `saveConfig({ apiUrl: url })`
3. Note: requires restart to take effect

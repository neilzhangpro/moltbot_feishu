# Moltbot Feishu/Lark Plugin

Feishu (飞书) / Lark channel plugin for Moltbot. Connects to Feishu Open Platform using WebSocket long connection mode for real-time messaging.

## Features

- Direct messages (私聊) support
- Group chats (群聊) support
- Block streaming for long responses
- Event deduplication (handles Feishu's 3-second retry mechanism)
- Multi-account support
- DM policy (open/allowlist/pairing)

## Installation

**From npm:**

```bash
moltbot plugins install @moltbot/feishu
```

**From source:**

```bash
moltbot plugins install ./extensions/feishu
```

## Configuration

### Basic setup

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "cli_xxxxxxxxxxxxxxxx",
      "appSecret": "your-app-secret"
    }
  }
}
```

### With allowlist

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_xxx",
      "appSecret": "xxx",
      "dmPolicy": "allowlist",
      "allowFrom": ["ou_user1_open_id", "ou_user2_open_id"]
    }
  }
}
```

## Feishu Open Platform Setup

1. Create a custom app at [Feishu Open Platform](https://open.feishu.cn/app)
2. Enable **Bot** capability
3. Configure event subscription with **WebSocket** mode
4. Add `im.message.receive_v1` event
5. Request permissions: `im:message`, `im:message:send_as_bot`
6. Publish the app

See full documentation: https://docs.molt.bot/channels/feishu

## Development

```bash
# Install dependencies
cd extensions/feishu
pnpm install

# Run tests
pnpm test

# Link for development
moltbot plugins install -l ./extensions/feishu
```

## License

MIT

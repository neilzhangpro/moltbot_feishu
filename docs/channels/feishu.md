---
summary: "Feishu/Lark channel: WebSocket long connection mode for enterprise messaging"
read_when:
  - Working on Feishu channel features
  - Configuring Feishu bot integration
---
# Feishu/Lark

Status: ready for DMs + group chats via WebSocket long connection mode.

Feishu (飞书) is an enterprise collaboration platform by ByteDance, also known as Lark in international markets. Moltbot connects to Feishu using the official SDK's WebSocket long connection mode, which provides real-time message delivery without requiring a public webhook endpoint.

## Quick setup

Feishu ships as a plugin and is not bundled with the core install.

**From npm:**
```bash
moltbot plugins install @moltbot/feishu
```

**From source checkout:**
```bash
moltbot plugins install ./extensions/feishu
```

### Step 1: Create a Feishu app

1. Go to [Feishu Open Platform](https://open.feishu.cn/app) and log in with your enterprise account.
2. Click **Create Custom App** (创建企业自建应用).
3. Fill in the app name and description.
4. After creation, note down the **App ID** and **App Secret** from the Credentials page.

### Step 2: Enable bot capability

1. In your app settings, go to **Add Capabilities** (添加应用能力).
2. Enable **Bot** (机器人) capability.
3. Configure the bot name and avatar as desired.

### Step 3: Configure event subscription (WebSocket mode)

1. Go to **Event Subscriptions** (事件订阅).
2. Select **WebSocket** connection mode (长连接模式).
3. Add the following event:
   - `im.message.receive_v1` (Receive messages)

### Step 4: Request permissions

1. Go to **Permissions** (权限管理).
2. Request the following permissions:
   - `im:message` (Send messages)
   - `im:message:send_as_bot` (Send messages as bot)
   - `im:chat:readonly` (Read chat info)

### Step 5: Publish the app

1. Go to **Version Management** (版本管理与发布).
2. Create a new version and submit for review.
3. Once approved, the app is available in your enterprise.

### Step 6: Configure Moltbot

```bash
moltbot configure --section channels.feishu
```

Or manually edit `~/.clawdbot/moltbot.json`:

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

### Step 7: Start the gateway

```bash
moltbot gateway run
```

The Feishu channel will automatically connect via WebSocket and start receiving messages.

## Capabilities

| Feature | Status |
|---------|--------|
| Direct messages (私聊) | Supported |
| Group chats (群聊) | Supported |
| Block streaming | Supported |
| Media (images/files) | Not yet supported |
| Threads | Not yet supported |
| Reactions | Not yet supported |

## Configuration reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable the channel |
| `appId` | string | - | Feishu App ID (starts with `cli_`) |
| `appSecret` | string | - | Feishu App Secret |
| `dmPolicy` | string | `"open"` | DM policy: `open`, `pairing`, or `allowlist` |
| `allowFrom` | string[] | `[]` | List of allowed user open_ids |

### Multi-account support

```json
{
  "channels": {
    "feishu": {
      "accounts": {
        "work": {
          "appId": "cli_work_app",
          "appSecret": "work-secret"
        },
        "personal": {
          "appId": "cli_personal_app",
          "appSecret": "personal-secret"
        }
      }
    }
  }
}
```

## DM policies

- **open**: Accept messages from anyone (default)
- **allowlist**: Only accept messages from users in `allowFrom` list
- **pairing**: Require pairing approval for new users

Example with allowlist:

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

## Troubleshooting

### Messages not received

1. Verify the app has `im.message.receive_v1` event subscription enabled.
2. Check that WebSocket mode is selected (not HTTP callback).
3. Ensure the app is published and available in your enterprise.
4. Check gateway logs: `moltbot logs -f`

### Authentication errors

1. Verify App ID and App Secret are correct.
2. Check that required permissions are approved.
3. Run `moltbot channels status --probe` to test the connection.

### Duplicate messages

The plugin includes event deduplication. If you still see duplicates:
1. Ensure you're running the latest version.
2. Check if multiple gateway instances are running.

## Technical notes

- Uses `@larksuiteoapi/node-sdk` for WebSocket connection.
- Event handling must complete within 3 seconds to avoid Feishu's retry mechanism.
- The plugin handles this by processing messages asynchronously and deduplicating by `event_id`.

# ClawWatch Setup

Easy 6-digit code pairing for connecting Apple Watch to OpenClaw/Clawd.

## How It Works

1. User messages `/connect` to `@ClawWatchSetup` on Telegram
2. Bot sends a 6-digit code (expires in 5 mins)
3. User enters the code on their Apple Watch
4. Watch calls `/api/verify` with the code
5. API returns connection config
6. Watch is connected!

**No more typing 46-character bot tokens on tiny screens!**

## Deployment

### 1. Create Telegram Bot

1. Message @BotFather on Telegram
2. `/newbot` → Name: ClawWatch Setup
3. Copy the bot token

### 2. Set Vercel Environment Variable

```bash
vercel env add CLAWWATCH_BOT_TOKEN
# Paste your bot token
```

Or in Vercel Dashboard: Settings → Environment Variables

### 3. Deploy

```bash
vercel --prod
```

### 4. Set Telegram Webhook

Replace `YOUR_VERCEL_URL` and `YOUR_BOT_TOKEN`:

```bash
curl "https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook?url=YOUR_VERCEL_URL/api/webhook"
```

Example:
```bash
curl "https://api.telegram.org/bot7533382329:AAGCCWIDdPqcQpzqe9i2QAlPj48LynvzgTI/setWebhook?url=https://clawwatch-setup.vercel.app/api/webhook"
```

## API Endpoints

### POST /api/webhook
Telegram webhook handler - receives messages, sends codes.

### POST /api/verify
Watch app calls this to verify codes.

**Request:**
```json
{ "code": "123456" }
```

**Success Response:**
```json
{
  "success": true,
  "config": {
    "userId": 7867591573,
    "chatId": 7867591573,
    "username": "dsummerscales",
    "apiEndpoint": "https://api.openclaw.ai/v1",
    "sessionToken": "cw_7867591573_1706864400000"
  }
}
```

**Error Response:**
```json
{
  "success": false,
  "error": "Invalid or expired code"
}
```

## Production Notes

The current implementation uses in-memory storage for codes, which resets on cold starts. For production:

1. Use **Vercel KV** for persistent code storage
2. Add rate limiting
3. Add proper OpenClaw authentication integration

## License

MIT - Schoolgle Ltd

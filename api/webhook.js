/**
 * ClawWatch Setup Bot - Vercel Webhook Handler
 * 
 * Receives Telegram webhook calls and responds with setup codes.
 */

// In-memory store (use Vercel KV or Redis in production)
// Note: This resets on cold starts - fine for MVP
const pendingCodes = new Map();
const CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanExpiredCodes() {
  const now = Date.now();
  for (const [code, data] of pendingCodes.entries()) {
    if (now > data.expiresAt) {
      pendingCodes.delete(code);
    }
  }
}

async function sendTelegramMessage(chatId, text, parseMode = 'Markdown') {
  const botToken = process.env.CLAWWATCH_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: parseMode
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body;
    
    if (!message || !message.text) {
      return res.status(200).json({ ok: true });
    }

    const chatId = message.chat.id;
    const userId = message.from.id;
    const username = message.from.username || '';
    const firstName = message.from.first_name || 'there';
    const text = message.text.trim();

    // Clean expired codes
    cleanExpiredCodes();

    // Handle /start command
    if (text === '/start') {
      await sendTelegramMessage(chatId,
        `👋 Hey ${firstName}!\n\n` +
        `🦞 *Welcome to ClawWatch Setup!*\n\n` +
        `This bot helps you connect your Apple Watch to your AI assistant.\n\n` +
        `Send /connect to get a 6-digit code for your Watch!`
      );
    }
    
    // Handle /connect command
    else if (text === '/connect') {
      // Generate unique code
      let code;
      do {
        code = generateCode();
      } while (pendingCodes.has(code));

      // Store code
      pendingCodes.set(code, {
        chatId,
        userId,
        username,
        firstName,
        createdAt: Date.now(),
        expiresAt: Date.now() + CODE_EXPIRY_MS
      });

      await sendTelegramMessage(chatId,
        `🔐 *Your Setup Code:*\n\n` +
        `\`${code}\`\n\n` +
        `Enter this code on your Apple Watch.\n\n` +
        `⏱️ *Expires in 5 minutes*\n\n` +
        `_Need a new code? Just send /connect again._`
      );

      console.log(`Generated code ${code} for user ${userId}`);
    }
    
    // Handle /help command
    else if (text === '/help') {
      await sendTelegramMessage(chatId,
        `🦞 *ClawWatch Setup Help*\n\n` +
        `*To connect your Apple Watch:*\n` +
        `1. Send /connect here\n` +
        `2. You'll get a 6-digit code\n` +
        `3. Enter the code on your Watch\n` +
        `4. Done! Your Watch is connected.\n\n` +
        `*Code expires in 5 minutes* for security.`
      );
    }
    
    // Handle unknown commands/messages
    else {
      await sendTelegramMessage(chatId,
        `🦞 Send /connect to get a setup code for your Apple Watch!`
      );
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
}

// Export pendingCodes for the verify endpoint
export { pendingCodes };

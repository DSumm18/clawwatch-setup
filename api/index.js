/**
 * ClawWatch Setup - Combined Webhook + Verify API
 * Single file so codes persist in shared memory
 */

// Shared in-memory store
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

async function sendTelegramMessage(chatId, text) {
  const botToken = process.env.CLAWWATCH_BOT_TOKEN;
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

async function handleWebhook(req, res) {
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

    cleanExpiredCodes();

    if (text === '/start') {
      await sendTelegramMessage(chatId,
        `👋 Hey ${firstName}!\n\n` +
        `🦞 *Welcome to ClawWatch Setup!*\n\n` +
        `This bot helps you connect your Apple Watch to your AI assistant.\n\n` +
        `Send /connect to get a 6-digit code for your Watch!`
      );
    }
    else if (text === '/connect') {
      let code;
      do {
        code = generateCode();
      } while (pendingCodes.has(code));

      pendingCodes.set(code, {
        chatId,
        userId,
        username,
        firstName,
        createdAt: Date.now(),
        expiresAt: Date.now() + CODE_EXPIRY_MS
      });

      console.log(`Generated code ${code} for user ${userId}, total codes: ${pendingCodes.size}`);

      await sendTelegramMessage(chatId,
        `🔐 *Your Setup Code:*\n\n` +
        `\`${code}\`\n\n` +
        `Enter this code on your Apple Watch.\n\n` +
        `⏱️ *Expires in 5 minutes*\n\n` +
        `_Need a new code? Just send /connect again._`
      );
    }
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
    else if (text === '/debug') {
      await sendTelegramMessage(chatId,
        `Debug info:\n` +
        `Pending codes: ${pendingCodes.size}\n` +
        `Codes: ${Array.from(pendingCodes.keys()).join(', ') || 'none'}`
      );
    }
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

async function handleVerify(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { code } = req.body;

    console.log(`Verify attempt for code: ${code}, pending codes: ${pendingCodes.size}`);
    console.log(`Available codes: ${Array.from(pendingCodes.keys()).join(', ')}`);

    if (!code) {
      return res.status(400).json({ success: false, error: 'Code is required' });
    }

    const codeStr = code.toString().trim();
    
    if (!/^\d{6}$/.test(codeStr)) {
      return res.status(400).json({ success: false, error: 'Invalid code format' });
    }

    cleanExpiredCodes();
    
    const codeData = pendingCodes.get(codeStr);

    if (!codeData) {
      return res.status(404).json({ success: false, error: 'Invalid or expired code' });
    }

    if (Date.now() > codeData.expiresAt) {
      pendingCodes.delete(codeStr);
      return res.status(410).json({ success: false, error: 'Code has expired' });
    }

    // Code valid - delete it (one-time use)
    pendingCodes.delete(codeStr);

    console.log(`Code ${codeStr} verified for user ${codeData.userId}`);

    res.status(200).json({
      success: true,
      config: {
        userId: codeData.userId,
        chatId: codeData.chatId,
        username: codeData.username || null,
        firstName: codeData.firstName || null,
        apiEndpoint: process.env.OPENCLAW_API_URL || 'https://api.openclaw.ai/v1',
        sessionToken: `cw_${codeData.userId}_${Date.now()}`
      }
    });

  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

async function handleSend(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { chatId, sessionToken, message } = req.body;

    if (!chatId || !message) {
      return res.status(400).json({ success: false, error: 'Missing chatId or message' });
    }

    // Send message via ClawWatch Setup bot (already configured)
    const botToken = process.env.CLAWWATCH_BOT_TOKEN;
    const url = `https://api.telegram.org/bot${edBotToken}/sendMessage`;
    
    // Format message from Watch
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const formattedMessage = `⌚ [${timeStr} via ClawWatch]\n\n${message}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formattedMessage
      })
    });

    const result = await response.json();
    
    if (result.ok) {
      res.status(200).json({ success: true });
    } else {
      console.error('Telegram error:', result);
      res.status(500).json({ success: false, error: 'Failed to send' });
    }

  } catch (error) {
    console.error('Send error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

export default async function handler(req, res) {
  const path = req.url || '';
  
  if (req.method === 'POST' && req.body?.message && !req.body?.chatId) {
    // Telegram webhook (has message object from Telegram)
    return handleWebhook(req, res);
  } else if (path.includes('/send') || (req.method === 'POST' && req.body?.chatId && req.body?.message)) {
    // Send message endpoint
    return handleSend(req, res);
  } else if (req.method === 'POST' || req.method === 'OPTIONS') {
    // Verify endpoint
    return handleVerify(req, res);
  } else {
    res.status(200).json({ 
      service: 'ClawWatch Setup',
      endpoints: ['/api/webhook', '/api/verify', '/api/send'],
      pendingCodes: pendingCodes.size
    });
  }
}

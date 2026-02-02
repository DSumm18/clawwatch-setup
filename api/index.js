/**
 * ClawWatch Setup - Production API with Supabase
 * Handles: webhook, verify, send, response, messages
 */

// In-memory codes (short-lived, OK to lose on redeploy)
const pendingCodes = new Map();
const CODE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes

function generateCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function cleanExpiredCodes() {
  const now = Date.now();
  for (const [code, data] of pendingCodes.entries()) {
    if (now > data.expiresAt) pendingCodes.delete(code);
  }
}

// Supabase helpers
async function supabaseQuery(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    console.error('Supabase not configured');
    return null;
  }

  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...options,
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': options.prefer || 'return=representation',
      ...options.headers
    }
  });

  if (!response.ok) {
    console.error('Supabase error:', response.status, await response.text());
    return null;
  }

  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function addUser(chatId, firstName, username, deviceType = 'phone') {
  return supabaseQuery('clawwatch_users', {
    method: 'POST',
    body: JSON.stringify({
      chat_id: chatId,
      first_name: firstName,
      username: username,
      device_type: deviceType
    }),
    headers: { 'Prefer': 'resolution=merge-duplicates,return=representation' }
  });
}

async function isClawWatchUser(chatId) {
  const result = await supabaseQuery(`clawwatch_users?chat_id=eq.${chatId}&select=id`);
  return result && result.length > 0;
}

async function storeMessage(chatId, message) {
  return supabaseQuery('pending_messages', {
    method: 'POST',
    body: JSON.stringify({
      chat_id: chatId,
      message: message,
      delivered: false
    })
  });
}

async function getMessages(chatId) {
  const messages = await supabaseQuery(
    `pending_messages?chat_id=eq.${chatId}&delivered=eq.false&select=id,message,created_at&order=created_at.asc`
  );
  
  if (messages && messages.length > 0) {
    // Mark as delivered
    const ids = messages.map(m => m.id);
    await supabaseQuery(`pending_messages?id=in.(${ids.join(',')})`, {
      method: 'PATCH',
      body: JSON.stringify({ delivered: true })
    });
  }
  
  return messages || [];
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

// Handlers
async function handleWebhook(req, res) {
  try {
    const { message } = req.body;
    if (!message || !message.text) return res.status(200).json({ ok: true });

    const chatId = message.chat.id;
    const firstName = message.from.first_name || 'there';
    const text = message.text.trim();

    cleanExpiredCodes();

    if (text === '/start') {
      await sendTelegramMessage(chatId,
        `👋 Hey ${firstName}!\n\n` +
        `🦞 *Welcome to ClawWatch Setup!*\n\n` +
        `This bot connects ClawPhone & ClawWatch to your AI assistant.\n\n` +
        `Send /connect to get a 6-digit code!`
      );
    }
    else if (text === '/connect') {
      let code;
      do { code = generateCode(); } while (pendingCodes.has(code));

      pendingCodes.set(code, {
        chatId,
        userId: message.from.id,
        username: message.from.username,
        firstName,
        expiresAt: Date.now() + CODE_EXPIRY_MS
      });

      await sendTelegramMessage(chatId,
        `🔐 *Your Setup Code:*\n\n\`${code}\`\n\n` +
        `Enter this in ClawPhone or ClawWatch.\n\n` +
        `⏱️ *Expires in 5 minutes*`
      );
    }
    else if (text === '/help') {
      await sendTelegramMessage(chatId,
        `🦞 *ClawWatch Help*\n\n` +
        `1. Send /connect to get a code\n` +
        `2. Enter code in ClawPhone/ClawWatch\n` +
        `3. Start chatting with voice!\n\n` +
        `Download: ClawPhone (iOS) • ClawWatch (watchOS)`
      );
    }
    else {
      await sendTelegramMessage(chatId,
        `🦞 Send /connect to get a setup code!`
      );
    }

    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal error' });
  }
}

async function handleVerify(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { code } = req.body;
    if (!code) return res.status(400).json({ success: false, error: 'Code required' });

    const codeStr = code.toString().trim();
    if (!/^\d{6}$/.test(codeStr)) {
      return res.status(400).json({ success: false, error: 'Invalid code format' });
    }

    cleanExpiredCodes();
    const codeData = pendingCodes.get(codeStr);

    if (!codeData || Date.now() > codeData.expiresAt) {
      pendingCodes.delete(codeStr);
      return res.status(404).json({ success: false, error: 'Invalid or expired code' });
    }

    // Store user in Supabase
    await addUser(codeData.chatId, codeData.firstName, codeData.username);
    pendingCodes.delete(codeStr);

    console.log(`User ${codeData.chatId} connected`);

    res.status(200).json({
      success: true,
      config: {
        userId: codeData.userId,
        chatId: codeData.chatId,
        username: codeData.username || null,
        firstName: codeData.firstName || null
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

async function handleSend(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { chatId, message } = req.body;
    if (!chatId || !message) {
      return res.status(400).json({ success: false, error: 'Missing chatId or message' });
    }

    const botToken = process.env.ED_BOT_TOKEN || process.env.CLAWWATCH_BOT_TOKEN;
    const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const formattedMessage = `⌚ *[ClawWatch ${timeStr}]*\n\n${message}`;

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: formattedMessage,
        parse_mode: 'Markdown'
      })
    });

    const result = await response.json();
    res.status(result.ok ? 200 : 500).json({ success: result.ok });
  } catch (error) {
    console.error('Send error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

async function handleResponse(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const { chatId, message } = req.body;
    if (!chatId || !message) {
      return res.status(400).json({ success: false, error: 'Missing chatId or message' });
    }

    await storeMessage(chatId, message);
    console.log(`Stored response for ${chatId}`);
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Response error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

async function handleMessages(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'Missing chatId' });
    }

    const messages = await getMessages(chatId);
    
    res.status(200).json({
      success: true,
      messages: messages.map(m => ({
        text: m.message,
        timestamp: new Date(m.created_at).getTime()
      }))
    });
  } catch (error) {
    console.error('Messages error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

// Check if a user is registered (for OpenClaw hook)
async function handleCheck(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chatId = url.searchParams.get('chatId');
    
    if (!chatId) {
      return res.status(400).json({ success: false, error: 'Missing chatId' });
    }

    const isUser = await isClawWatchUser(chatId);
    res.status(200).json({ success: true, isClawWatchUser: isUser });
  } catch (error) {
    console.error('Check error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
}

export default async function handler(req, res) {
  const path = req.url || '';
  
  if (path.includes('/messages')) return handleMessages(req, res);
  if (path.includes('/response')) return handleResponse(req, res);
  if (path.includes('/check')) return handleCheck(req, res);
  if (path.includes('/send')) return handleSend(req, res);
  if (req.method === 'POST' && req.body?.message && !req.body?.chatId) {
    return handleWebhook(req, res);
  }
  if (req.method === 'POST' || req.method === 'OPTIONS') {
    return handleVerify(req, res);
  }
  
  res.status(200).json({
    service: 'ClawWatch API',
    version: '2.0',
    endpoints: ['/verify', '/send', '/response', '/messages', '/check']
  });
}

/**
 * ClawWatch Setup - Code Verification API
 * 
 * Watch app calls this to verify the 6-digit code
 * and get connection configuration.
 */

// Import shared pending codes store
// Note: In serverless, each function instance has its own memory
// For production, use Vercel KV or external store
import { pendingCodes } from './webhook.js';

export default async function handler(req, res) {
  // Enable CORS for Watch app
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ 
      success: false, 
      error: 'Method not allowed' 
    });
  }

  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        success: false,
        error: 'Code is required'
      });
    }

    const codeStr = code.toString().trim();
    
    // Validate format
    if (!/^\d{6}$/.test(codeStr)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid code format'
      });
    }

    const codeData = pendingCodes.get(codeStr);

    if (!codeData) {
      return res.status(404).json({
        success: false,
        error: 'Invalid or expired code'
      });
    }

    // Check expiry
    if (Date.now() > codeData.expiresAt) {
      pendingCodes.delete(codeStr);
      return res.status(410).json({
        success: false,
        error: 'Code has expired. Please request a new one.'
      });
    }

    // Code is valid - delete it (one-time use)
    pendingCodes.delete(codeStr);

    console.log(`Code ${codeStr} verified for user ${codeData.userId}`);

    // Return connection configuration
    res.status(200).json({
      success: true,
      config: {
        userId: codeData.userId,
        chatId: codeData.chatId,
        username: codeData.username || null,
        firstName: codeData.firstName || null,
        // OpenClaw connection details would go here
        apiEndpoint: process.env.OPENCLAW_API_URL || 'https://api.openclaw.ai/v1',
        sessionToken: `cw_${codeData.userId}_${Date.now()}`
      }
    });

  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({
      success: false,
      error: 'Server error'
    });
  }
}

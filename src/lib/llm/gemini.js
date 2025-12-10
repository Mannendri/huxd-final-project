/**
 * Gemini LLM client wrapper for MentorAI
 * Follows the same pattern as assignment-3/src/lib/gemini.js
 */

import { env } from '$env/dynamic/private';
import { GoogleGenAI } from '@google/genai';

/**
 * Check if Gemini API key is available
 * @param {string} [overrideKey] - Optional API key override
 * @returns {boolean}
 */
export function hasGemini(overrideKey) {
  return Boolean(overrideKey || env.GEMINI_API_KEY);
}

/**
 * Generate content using Gemini API
 * @param {Object} params - Generation parameters
 * @param {Array} params.contents - Conversation contents in Gemini format
 * @param {string} [params.systemPrompt] - System prompt/instruction
 * @param {Object} [params.config] - Additional config (responseMimeType, responseSchema, etc.)
 * @returns {Promise<{text: string, raw: any}>}
 */
export async function geminiGenerate({ contents, systemPrompt = '', config = {} }) {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    // Log available environment variables for debugging (only in server logs)
    const availableKeys = Object.keys(env).filter(k => k.includes('GEMINI') || k.includes('VERCEL') || k.includes('ENV')).slice(0, 10);
    console.error('[Gemini] GEMINI_API_KEY not found. Available env vars:', availableKeys);
    throw new Error('GEMINI_API_KEY not set');
  }

  const ai = new GoogleGenAI({ apiKey: key });
  if (systemPrompt) {
    config.systemInstruction = { role: 'model', parts: [{ text: systemPrompt }] };
  }

  const model = env.GEMINI_MODEL || 'gemini-2.5-flash';

  const request = {
    model: model,
    contents: contents,
    config: config
  };

  try {
    const response = await ai.models.generateContent(request);
    const text = typeof response?.text === 'string' ? response.text : '';
    return { text, raw: response };
  } catch (error) {
    // Handle quota/rate limit errors
    if (error?.message?.includes('429') || error?.message?.includes('quota') || error?.message?.includes('RESOURCE_EXHAUSTED')) {
      const quotaError = new Error('Gemini API quota exceeded. You have reached the free tier limit (20 requests per day). Please wait or upgrade your plan.');
      quotaError.name = 'QuotaExceededError';
      throw quotaError;
    }
    // Re-throw other errors
    throw error;
  }
}

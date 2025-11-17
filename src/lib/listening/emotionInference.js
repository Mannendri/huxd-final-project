/**
 * Emotion Inference Utilities
 *
 * Infers feelings and emotions from user messages to support active listening
 * Based on PDF principle: "Listen for feelings, not just words"
 */

/**
 * Infer feelings from a user message
 * Uses pattern matching and keyword detection
 *
 * @param {string} message - User's message
 * @param {Array} history - Conversation history for context
 * @returns {Object} - Inferred feelings and emotional state
 */
export function inferFeelings(message, history = []) {
  const messageLower = message.toLowerCase();
  const feelings = [];
  const tone = inferTone(message);
  const intensity = inferIntensity(message);

  // Emotion keyword mapping
  const emotionPatterns = {
    anxious: /\b(anxious|worried|nervous|concerned|uneasy|apprehensive)\b/i,
    frustrated: /\b(frustrated|annoyed|irritated|bothered|aggravated)\b/i,
    angry: /\b(angry|mad|furious|upset|annoyed|irritated)\b/i,
    sad: /\b(sad|down|depressed|disappointed|discouraged|hopeless)\b/i,
    overwhelmed: /\b(overwhelmed|stressed|pressured|swamped|buried)\b/i,
    confused: /\b(confused|uncertain|unsure|unclear|lost|bewildered)\b/i,
    excited: /\b(excited|enthusiastic|thrilled|eager|pumped)\b/i,
    happy: /\b(happy|glad|pleased|delighted|content|satisfied)\b/i,
    relieved: /\b(relieved|better|calmer|eased)\b/i,
    proud: /\b(proud|accomplished|achieved|succeeded)\b/i
  };

  // Detect emotions
  for (const [emotion, pattern] of Object.entries(emotionPatterns)) {
    if (pattern.test(message)) {
      feelings.push(emotion);
    }
  }

  // If no explicit emotions found, infer from context
  if (feelings.length === 0) {
    // Check for uncertainty/confusion indicators
    if (/\b(not sure|don't know|uncertain|maybe|perhaps|might)\b/i.test(message)) {
      feelings.push('uncertain');
    }
    // Check for seeking help (might indicate anxiety or need)
    if (/\b(help|advice|guidance|what should|what do)\b/i.test(message)) {
      feelings.push('seeking_support');
    }
  }

  return {
    feelings: feelings.length > 0 ? feelings : ['neutral'],
    tone,
    intensity,
    hasStrongEmotion: intensity > 0.6,
    primaryFeeling: feelings[0] || 'neutral'
  };
}

/**
 * Infer emotional tone from message
 * @param {string} message - User message
 * @returns {string} - Tone: 'positive', 'negative', 'neutral', 'mixed'
 */
function inferTone(message) {
  const positiveWords = /\b(good|great|excellent|wonderful|happy|glad|pleased|excited|success|win|achieved)\b/i;
  const negativeWords = /\b(bad|terrible|awful|horrible|sad|angry|frustrated|failed|problem|issue|difficult)\b/i;

  const hasPositive = positiveWords.test(message);
  const hasNegative = negativeWords.test(message);

  if (hasPositive && hasNegative) return 'mixed';
  if (hasPositive) return 'positive';
  if (hasNegative) return 'negative';
  return 'neutral';
}

/**
 * Infer emotional intensity from message
 * @param {string} message - User message
 * @returns {number} - Intensity 0-1
 */
function inferIntensity(message) {
  // Check for intensifiers
  const intensifiers = /\b(very|extremely|really|so|incredibly|absolutely|completely|totally)\b/i;
  const exclamationMarks = (message.match(/!/g) || []).length;
  const capsWords = (message.match(/\b[A-Z]{3,}\b/g) || []).length;

  let intensity = 0.3; // Base intensity

  if (intensifiers.test(message)) intensity += 0.2;
  if (exclamationMarks > 0) intensity += Math.min(exclamationMarks * 0.1, 0.3);
  if (capsWords > 0) intensity += Math.min(capsWords * 0.1, 0.2);

  return Math.min(intensity, 1.0);
}

/**
 * Extract personal/specific points from message (for reflective responses)
 * Based on PDF: "Choose specific, personal points rather than abstract generalizations"
 *
 * @param {string} message - User message
 * @returns {Array<string>} - Personal/specific points
 */
export function extractPersonalPoints(message) {
  const personalPoints = [];

  // Look for first-person references
  const firstPersonPattern = /\b(I|my|me|myself)\s+[\w\s]+/gi;
  const matches = message.match(firstPersonPattern);
  if (matches) {
    personalPoints.push(...matches.slice(0, 3));
  }

  // Look for specific situations/events (not abstract)
  const specificPattern = /\b(when|because|since|after|before)\s+[\w\s]{10,}/gi;
  const specificMatches = message.match(specificPattern);
  if (specificMatches) {
    personalPoints.push(...specificMatches.slice(0, 2));
  }

  return personalPoints.length > 0 ? personalPoints : [message.substring(0, 100)];
}

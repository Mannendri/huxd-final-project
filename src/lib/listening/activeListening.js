/**
 * Active Listening Utilities
 *
 * Based on "Active Listening and Reflective Responses" by JoAnne Yates
 * Implements the core principles and techniques for active listening
 */

/**
 * Generate a reflective response that restates and validates the speaker's thoughts/feelings
 *
 * @param {string} userMessage - User's message
 * @param {Array} conversationHistory - Full conversation history
 * @param {Object} inferredFeelings - Inferred feelings from the message
 * @returns {string} - Reflective response template/guidance
 */
export function generateReflectiveResponse(userMessage, conversationHistory, inferredFeelings = {}) {
  // Extract key points and feelings from user message
  const keyPoints = extractKeyPoints(userMessage);
  const feelings = inferredFeelings.feelings || [];
  const tone = inferredFeelings.tone || 'neutral';

  // Build reflective response guidance
  let guidance = 'Reflect back what the user has said:\n';

  if (keyPoints.length > 0) {
    guidance += `- Key thoughts: ${keyPoints.join(', ')}\n`;
  }

  if (feelings.length > 0) {
    guidance += `- Inferred feelings: ${feelings.join(', ')}\n`;
    guidance += `- Use questioning tone when reflecting feelings (e.g., "You seem ${feelings[0]}?" rather than "You are ${feelings[0]}.")\n`;
  }

  guidance += '\nStay within the user\'s frame of reference. Respond to feelings rather than just content.';

  return guidance;
}

/**
 * Extract key points from a user message
 * @param {string} message - User message
 * @returns {Array<string>} - Key points extracted
 */
export function extractKeyPoints(message) {
  // Simple extraction - in production, could use NLP
  const sentences = message.split(/[.!?]+/).filter(s => s.trim().length > 10);
  return sentences.slice(0, 3).map(s => s.trim());
}

/**
 * Determine if active listening mode should be used
 * Based on PDF: use when user needs understanding, hasn't revealed feelings, or is uncertain
 *
 * @param {Object} context - Conversation context
 * @param {string} context.userMessage - Current user message
 * @param {Array} context.history - Conversation history
 * @param {Object} context.humaneMetrics - Current humane metrics
 * @returns {boolean} - Whether to use active listening mode
 */
export function shouldUseActiveListening({ userMessage, history, humaneMetrics }) {
  // Indicators that active listening is needed:
  // 1. User is expressing uncertainty or confusion
  const uncertaintyIndicators = /\b(confused|unsure|don't know|uncertain|not sure|unclear|unclear about)\b/i;
  if (uncertaintyIndicators.test(userMessage)) {
    return true;
  }

  // 2. User is expressing strong emotions
  const emotionIndicators = /\b(frustrated|angry|anxious|worried|stressed|overwhelmed|sad|disappointed|excited|happy)\b/i;
  if (emotionIndicators.test(userMessage)) {
    return true;
  }

  // 3. Short conversation - need to establish understanding first
  if (history.filter(m => m.role === 'user').length < 3) {
    return true;
  }

  // 4. High dependency risk - user needs validation before moving forward
  if (humaneMetrics?.dependency_risk_score > 0.6) {
    return true;
  }

  // 5. User is asking for help/advice but hasn't fully explained the situation
  const helpSeeking = /\b(help|advice|what should|what do|guidance)\b/i;
  if (helpSeeking.test(userMessage) && userMessage.length < 100) {
    return true;
  }

  return false;
}

/**
 * Generate open-ended questions based on user's message
 * Following PDF: "How do you feel about X?" "Tell me about X." "What concerns you about X?"
 *
 * @param {string} userMessage - User's message
 * @param {Object} context - Additional context
 * @returns {Array<string>} - Suggested open-ended questions
 */
export function generateOpenEndedQuestions(userMessage, context = {}) {
  const questions = [];

  // Extract topics/subjects from message
  const topics = extractTopics(userMessage);

  topics.forEach(topic => {
    questions.push(`How do you feel about ${topic}?`);
    questions.push(`Tell me more about ${topic}.`);
    questions.push(`What concerns you most about ${topic}?`);
  });

  // Add general reflection questions
  questions.push('What\'s on your mind right now?');
  questions.push('What would be most helpful for you to explore?');

  return questions.slice(0, 3); // Return top 3
}

/**
 * Extract topics/subjects from a message
 * @param {string} message - User message
 * @returns {Array<string>} - Extracted topics
 */
function extractTopics(message) {
  // Simple extraction - look for noun phrases, key terms
  const words = message.toLowerCase().split(/\s+/);
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should']);

  // Extract meaningful words (simplified - in production, use NLP)
  const meaningfulWords = words.filter(w => w.length > 4 && !stopWords.has(w));
  return meaningfulWords.slice(0, 2);
}

/**
 * Check if response should be reflective or directive
 * Based on PDF: start with reflective, then shift to directive after understanding is established
 *
 * @param {Object} context - Conversation context
 * @returns {"reflective" | "directive" | "mixed"} - Recommended response mode
 */
export function determineResponseMode(context) {
  const { history, humaneMetrics, userMessage } = context;

  // Count how many turns we've been in reflective mode
  const userTurns = history.filter(m => m.role === 'user').length;

  // If early in conversation or user is uncertain/emotional, use reflective
  if (shouldUseActiveListening({ userMessage, history, humaneMetrics })) {
    return 'reflective';
  }

  // If we've had 3+ exchanges and user seems ready, can shift to directive
  if (userTurns >= 3 && !shouldUseActiveListening({ userMessage, history, humaneMetrics })) {
    return 'mixed'; // Can include both reflective validation and directive guidance
  }

  // Default: reflective first
  return 'reflective';
}

/**
 * Generate active listening prompt guidance for agents
 * Combines all active listening principles into actionable guidance
 *
 * @param {Object} params - Parameters
 * @param {string} params.userMessage - User's message
 * @param {Array} params.history - Conversation history
 * @param {Object} params.inferredFeelings - Inferred feelings
 * @param {"reflective" | "directive" | "mixed"} params.mode - Response mode
 * @returns {string} - Active listening guidance for agent prompt
 */
export function generateActiveListeningGuidance({ userMessage, history, inferredFeelings, mode = 'reflective' }) {
  let guidance = '\n## Active Listening Guidelines:\n\n';

  if (mode === 'reflective' || mode === 'mixed') {
    guidance += `**1. Adopt the user's point of view:**\n`;
    guidance += `- Listen from their frame of reference, not your own\n`;
    guidance += `- Suppress your initial reactions\n`;
    guidance += `- Try to empathize with their position\n\n`;

    guidance += `**2. Reflect thoughts and feelings:**\n`;
    guidance += `- Restate what you believe the user has said to check understanding\n`;
    if (inferredFeelings?.feelings?.length > 0) {
      guidance += `- Reflect back inferred feelings: ${inferredFeelings.feelings.join(', ')}\n`;
      guidance += `- Use questioning tone for feelings (e.g., "You seem ${inferredFeelings.feelings[0]}?" not "You are ${inferredFeelings.feelings[0]}.")\n`;
    }
    guidance += `- Example: "So you feel [feeling] because [situation]?"\n\n`;

    guidance += `**3. Respond rather than lead:**\n`;
    guidance += `- Stay within the user's frame of reference\n`;
    guidance += `- Don't guide conversation to new topics you're interested in\n`;
    guidance += `- Respond to what they actually said or implied\n\n`;

    guidance += `**4. Respond to feelings, not just content:**\n`;
    guidance += `- Focus on personal, specific points rather than abstract generalizations\n`;
    guidance += `- Acknowledge emotions underlying the words\n\n`;
  }

  if (mode === 'directive' || mode === 'mixed') {
    guidance += `**5. After understanding is established, you can:**\n`;
    guidance += `- Shift to more directive guidance\n`;
    guidance += `- Offer advice or suggestions\n`;
    guidance += `- Present your own perspective\n\n`;
  }

  guidance += `**Remember:** Show interest and engagement. Use open-ended questions when appropriate. Limit your talking to get fullest content from the user.`;

  return guidance;
}

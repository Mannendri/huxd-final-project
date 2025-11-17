/**
 * Conversation state management for MentorAI
 * Handles state initialization, updates, and persistence
 */

/**
 * Initialize a new conversation state
 * @returns {ConversationState}
 */
export function createInitialState() {
  return {
    history: [],
    humane_metrics: {
      avg_response_delay_ms: 0,
      discomfort_to_growth_ratio: 0.5,
      sycophancy_score: 0.0,
      dependency_risk_score: 0.0,
      listening_effectiveness: 0.5
    },
    session_config: {
      default_tone: {
        warmth: 0.7,
        intellectual: 0.6,
        grounded: 0.8
      }
    },
    last_plan: null
  };
}

/**
 * Update conversation state after a turn
 * @param {ConversationState} state - Current state
 * @param {Object} updates - Updates to apply
 * @param {string} updates.user_message - User message
 * @param {string} updates.finalReply - Final assistant reply
 * @param {Object} updates.plan - Orchestration plan
 * @param {Array} updates.agentResponses - Agent responses
 * @param {Object} updates.humane_metrics - Updated humane metrics
 * @returns {ConversationState} - Updated state
 */
export function updateConversationState(state, updates) {
  const { user_message, finalReply, plan, agentResponses, humane_metrics } = updates;

  // Add messages to history
  const newHistory = [...state.history];
  if (user_message) {
    newHistory.push({
      role: 'user',
      content: user_message,
      timestamp: Date.now()
    });
  }
  if (finalReply) {
    newHistory.push({
      role: 'assistant',
      content: finalReply,
      timestamp: Date.now()
    });
  }

  return {
    ...state,
    history: newHistory,
    humane_metrics: humane_metrics || state.humane_metrics,
    last_plan: plan || state.last_plan
  };
}

/**
 * Convert conversation history to Gemini format
 * @param {Message[]} history - Message history
 * @returns {Array} - Gemini-formatted contents
 */
export function historyToGeminiContents(history) {
  return history.map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }));
}

/**
 * Core type definitions for MentorAI multi-agent system
 * Following patterns from assignment-3 but adapted for MentorAI architecture
 */

/**
 * Tone directives for controlling response style
 * @typedef {Object} ToneDirectives
 * @property {number} warmth - 0-1 scale for warmth/empathy
 * @property {number} intellectual - 0-1 scale for intellectual rigor
 * @property {number} grounded - 0-1 scale for groundedness/realism
 */

/**
 * Pacing directives for controlling response length and timing
 * @typedef {Object} PacingDirectives
 * @property {"short" | "medium" | "long"} target_length - Target response length
 * @property {boolean} encourage_pause - Whether to encourage user to pause/think
 */

/**
 * Humane metrics tracked by the Evaluator
 * @typedef {Object} HumaneMetrics
 * @property {number} [user_rated_authenticity] - Optional explicit user rating (0-1)
 * @property {number} avg_response_delay_ms - Average response delay in milliseconds
 * @property {number} discomfort_to_growth_ratio - Heuristic for productive friction (0-1)
 * @property {number} sycophancy_score - How much we're just agreeing (0-1)
 * @property {number} dependency_risk_score - Is user over-relying? (0-1)
 */

/**
 * Conversation message
 * @typedef {Object} Message
 * @property {"user" | "assistant" | "system"} role - Message role
 * @property {string} content - Message content
 * @property {number} [timestamp] - Optional timestamp
 */

/**
 * Agent request structure passed to specialized agents
 * @typedef {Object} AgentRequest
 * @property {string} user_message - Current user message
 * @property {Message[]} conversation_history - Full conversation history
 * @property {string} objective - Primary objective: "trust" | "challenge" | "reflection" | "transfer"
 * @property {ToneDirectives} tone_directives - Tone guidance
 * @property {PacingDirectives} pacing_directives - Pacing guidance
 * @property {HumaneMetrics} humane_metrics - Current humane metrics
 */

/**
 * Agent response from specialized agents
 * @typedef {Object} AgentResponse
 * @property {string} draft_reply - Draft response text
 * @property {Record<string, any>} [annotations] - Optional annotations (suggested questions, flags, etc.)
 */

/**
 * Orchestration plan from Core Orchestrator
 * @typedef {Object} OrchestrationPlan
 * @property {string[]} selected_agents - Array of agent IDs to call
 * @property {"trust" | "challenge" | "reflection" | "transfer"} primary_objective - Primary objective
 * @property {ToneDirectives} tone_directives - Tone settings
 * @property {PacingDirectives} pacing_directives - Pacing settings
 */

/**
 * Evaluator output
 * @typedef {Object} EvaluatorOutput
 * @property {HumaneMetrics} metrics - Updated humane metrics
 * @property {Record<string, number>} agent_weight_adjustments - Per-agent weight adjustments
 * @property {Object} pacing_policy - Pacing policy adjustments
 */

/**
 * Conversation state maintained across turns
 * @typedef {Object} ConversationState
 * @property {Message[]} history - Conversation message history
 * @property {HumaneMetrics} humane_metrics - Current humane metrics
 * @property {Object} [session_config] - Session configuration and defaults
 * @property {Object} [last_plan] - Last orchestration plan for evaluator feedback
 */

/**
 * Turn result from handleUserTurn
 * @typedef {Object} TurnResult
 * @property {string} reply - Final unified response
 * @property {ConversationState} new_state - Updated conversation state
 * @property {OrchestrationPlan} plan - Orchestration plan used
 * @property {AgentResponse[]} agent_responses - Individual agent responses
 */

export const AGENT_IDS = {
  TRUST: 'trust_transparency',
  CHALLENGE: 'challenge_pacing',
  REFLECTION: 'reflection_coach',
  TRANSFER: 'transfer_to_world'
};

export const OBJECTIVES = {
  TRUST: 'trust',
  CHALLENGE: 'challenge',
  REFLECTION: 'reflection',
  TRANSFER: 'transfer'
};

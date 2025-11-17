/**
 * Main control loop for handling a user turn
 * Implements the per-turn logic from mentorai_architecture.md
 *
 * Control Flow:
 * 1) Evaluator updates metrics based on previous turn
 * 2) Orchestrator decides which agents to call
 * 3) Call selected specialized agents
 * 4) Orchestrator fuses agentResponses into a single reply
 * 5) Update state and send info back to Evaluator for next turn
 */

import { Evaluator } from './Evaluator.js';
import { Orchestrator } from './Orchestrator.js';
import { updateConversationState } from './state.js';

/**
 * Handle a user turn through the full MentorAI pipeline
 *
 * @param {string} user_message - User's message
 * @param {ConversationState} state - Current conversation state
 * @returns {Promise<TurnResult>} - Turn result with reply and updated state
 */
export async function handleUserTurn(user_message, state) {
  const evaluator = new Evaluator();
  const orchestrator = new Orchestrator();

  // 1) Evaluator updates metrics based on previous turn
  const evalOutput = await evaluator.update({
    user_message,
    state,
    last_plan: state.last_plan,
    last_agent_outputs: state.last_agent_outputs || [],
    user_feedback: null // TODO: Add user feedback mechanism
  });

  // 2) Orchestrator decides which agents to call
  const plan = await orchestrator.plan({
    user_message,
    state,
    humane_metrics: evalOutput.metrics,
    agent_weight_adjustments: evalOutput.agent_weight_adjustments,
    pacing_policy: evalOutput.pacing_policy
  });

  // 3) Call selected specialized agents
  const agentResponses = await orchestrator.invokeAgents({
    selected_agents: plan.selected_agents,
    user_message,
    state,
    plan,
    humane_metrics: evalOutput.metrics
  });

  // 4) Orchestrator fuses agentResponses into a single reply
  const finalReply = await orchestrator.fuse(agentResponses, plan);

  // 5) Update state and send info back to Evaluator for next turn
  const newState = updateConversationState(state, {
    user_message,
    finalReply,
    plan,
    agentResponses,
    humane_metrics: evalOutput.metrics
  });

  // Store agent outputs for next evaluator update
  newState.last_agent_outputs = agentResponses;

  return {
    reply: finalReply,
    new_state: newState,
    plan,
    agent_responses: agentResponses,
    evaluator_output: evalOutput
  };
}

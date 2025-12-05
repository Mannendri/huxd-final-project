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
import { updateConversationState, rollbackLastAssistantMessage } from './state.js';
import { AGENT_IDS, OBJECTIVES } from './types.js';

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

  // 3) Call ALL specialized agents in parallel (returns all responses + selected one)
  const agentResult = await orchestrator.invokeAgents({
    selected_agents: plan.selected_agents,
    user_message,
    state,
    plan,
    humane_metrics: evalOutput.metrics
  });

  // 4) Extract the selected agent's response (no fusion needed)
  const finalReply = await orchestrator.fuse(agentResult, plan);

  // 5) Update state and send info back to Evaluator for next turn
  const newState = updateConversationState(state, {
    user_message,
    finalReply,
    plan,
    agentResponses: agentResult.selected_response, // Only store selected response in history
    humane_metrics: evalOutput.metrics
  });

  // Store all agent outputs internally for potential future use
  newState.last_agent_outputs = agentResult.all_responses;
  newState.all_agent_responses = agentResult.all_responses; // Keep all responses available

  return {
    reply: finalReply,
    new_state: newState,
    plan: {
      ...plan,
      selected_agent_id: agentResult.selected_agent_id // Add which agent was actually shown
    },
    agent_responses: agentResult.all_responses, // Return all for debugging
    selected_agent_id: agentResult.selected_agent_id,
    evaluator_output: evalOutput
  };
}

/**
 * Rewrite the last assistant response with a forced agent selection
 *
 * @param {string} selectedAgentId - Agent ID to use for rewrite
 * @param {ConversationState} state - Current conversation state
 * @returns {Promise<TurnResult>} - Turn result with rewritten reply and updated state
 */
export async function rewriteLastResponse(selectedAgentId, state) {
  // Validate agent ID
  const validAgentIds = Object.values(AGENT_IDS);
  if (!validAgentIds.includes(selectedAgentId)) {
    throw new Error(`Invalid agent ID: ${selectedAgentId}`);
  }

  // Check if we have cached responses from the previous turn
  // If all 4 agents were generated in parallel, we can just use the cached response!
  const cachedResponses = state.all_agent_responses || state.last_agent_outputs || [];

  if (cachedResponses.length > 0) {
    // Find the response for the selected agent in the cached responses
    const cachedResponse = cachedResponses.find(r => r.agentId === selectedAgentId);

    if (cachedResponse && cachedResponse.text) {
      console.log(`[Rewrite] Using cached response for ${selectedAgentId} (instant rewrite!)`);

      // Rollback to before the last assistant message
      const rolledBackState = rollbackLastAssistantMessage(state);

      // Map agent ID to objective
      const agentToObjective = {
        [AGENT_IDS.TRUST]: OBJECTIVES.TRUST,
        [AGENT_IDS.CHALLENGE]: OBJECTIVES.CHALLENGE,
        [AGENT_IDS.REFLECTION]: OBJECTIVES.REFLECTION,
        [AGENT_IDS.TRANSFER]: OBJECTIVES.TRANSFER
      };

      // Create a minimal plan for the selected agent
      const forcedPlan = {
        selected_agents: [selectedAgentId],
        primary_objective: agentToObjective[selectedAgentId] || OBJECTIVES.TRUST,
        tone_directives: state.last_plan?.tone_directives || { warmth: 0.7, intellectual: 0.6, grounded: 0.8 },
        pacing_directives: state.last_plan?.pacing_directives || { target_length: 'medium', encourage_pause: false },
        listening_directives: state.last_plan?.listening_directives || {},
        reasoning: `User requested rewrite with ${selectedAgentId} agent (using cached response)`
      };

      // Use the cached response directly - no need to regenerate!
      const finalReply = cachedResponse.text;

      // Update state with rewritten response
      const newState = updateConversationState(rolledBackState, {
        user_message: null, // Don't add user message again
        finalReply,
        plan: forcedPlan,
        agentResponses: cachedResponse,
        humane_metrics: state.humane_metrics || {}
      });

      // Keep all cached responses available
      newState.last_agent_outputs = cachedResponses;
      newState.all_agent_responses = cachedResponses;

      return {
        reply: finalReply,
        new_state: newState,
        plan: {
          ...forcedPlan,
          selected_agent_id: selectedAgentId
        },
        agent_responses: cachedResponses,
        selected_agent_id: selectedAgentId,
        evaluator_output: {
          metrics: state.humane_metrics || {},
          agent_weight_adjustments: {},
          pacing_policy: { target_length: 'medium', encourage_pause: false },
          reasoning: 'Using cached response - no re-evaluation needed'
        }
      };
    }
  }

  // Fallback: If no cached response available, regenerate (original behavior)
  console.log(`[Rewrite] No cached response found for ${selectedAgentId}, regenerating...`);

  // Rollback to before the last assistant message
  const rolledBackState = rollbackLastAssistantMessage(state);

  // Find the last user message (the one that triggered the response we're rewriting)
  const lastUserMessage = rolledBackState.history
    .filter(m => m.role === 'user')
    .slice(-1)[0]?.content;

  if (!lastUserMessage) {
    throw new Error('No user message found to rewrite response for');
  }

  const evaluator = new Evaluator();
  const orchestrator = new Orchestrator();

  // Get evaluator output (use previous metrics if available)
  const evalOutput = await evaluator.update({
    user_message: lastUserMessage,
    state: rolledBackState,
    last_plan: rolledBackState.last_plan,
    last_agent_outputs: rolledBackState.last_agent_outputs || [],
    user_feedback: null
  });

  // Map agent ID to objective
  const agentToObjective = {
    [AGENT_IDS.TRUST]: OBJECTIVES.TRUST,
    [AGENT_IDS.CHALLENGE]: OBJECTIVES.CHALLENGE,
    [AGENT_IDS.REFLECTION]: OBJECTIVES.REFLECTION,
    [AGENT_IDS.TRANSFER]: OBJECTIVES.TRANSFER
  };

  // Force the plan to use the selected agent
  // We'll use the orchestrator's plan but override the agent selection
  const originalPlan = await orchestrator.plan({
    user_message: lastUserMessage,
    state: rolledBackState,
    humane_metrics: evalOutput.metrics,
    agent_weight_adjustments: evalOutput.agent_weight_adjustments,
    pacing_policy: evalOutput.pacing_policy
  });

  // Override plan with forced agent selection
  const forcedPlan = {
    ...originalPlan,
    selected_agents: [selectedAgentId],
    primary_objective: agentToObjective[selectedAgentId] || originalPlan.primary_objective,
    reasoning: `User requested rewrite with ${selectedAgentId} agent`
  };

  // Call ALL agents (for consistency and speed), but select the forced one
  const agentResult = await orchestrator.invokeAgents({
    selected_agents: forcedPlan.selected_agents,
    user_message: lastUserMessage,
    state: rolledBackState,
    plan: forcedPlan,
    humane_metrics: evalOutput.metrics
  });

  // Extract the selected (forced) agent's response
  const finalReply = await orchestrator.fuse(agentResult, forcedPlan);

  // Update state with rewritten response
  const newState = updateConversationState(rolledBackState, {
    user_message: null, // Don't add user message again
    finalReply,
    plan: forcedPlan,
    agentResponses: agentResult.selected_response, // Only store selected in history
    humane_metrics: evalOutput.metrics
  });

  // Store all agent outputs internally
  newState.last_agent_outputs = agentResult.all_responses;
  newState.all_agent_responses = agentResult.all_responses;

  return {
    reply: finalReply,
    new_state: newState,
    plan: {
      ...forcedPlan,
      selected_agent_id: agentResult.selected_agent_id
    },
    agent_responses: agentResult.all_responses, // Return all for debugging
    selected_agent_id: agentResult.selected_agent_id,
    evaluator_output: evalOutput
  };
}

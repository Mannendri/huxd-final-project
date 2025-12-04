/**
 * MentorAI Rewrite API Endpoint
 *
 * Handles POST requests for rewriting the last assistant response with a different agent
 */

import { json } from '@sveltejs/kit';
import { rewriteLastResponse } from '$lib/core/handleTurn.js';
import { AGENT_IDS } from '$lib/core/types.js';

/**
 * Handle rewrite POST requests
 *
 * Body: { state, selectedAgentId }
 * Returns: JSON response with rewritten assistant message and debug info
 */
export async function POST({ request }) {
  const body = await request.json();
  const { state: clientState, selectedAgentId } = body || {};

  if (!clientState) {
    return json({ error: 'state is required' }, { status: 400 });
  }

  if (!selectedAgentId) {
    return json({ error: 'selectedAgentId is required' }, { status: 400 });
  }

  // Validate agent ID
  const validAgentIds = Object.values(AGENT_IDS);
  if (!validAgentIds.includes(selectedAgentId)) {
    return json({
      error: `Invalid agent ID. Must be one of: ${validAgentIds.join(', ')}`
    }, { status: 400 });
  }

  // Check if there's a last assistant message to rewrite
  const hasAssistantMessage = clientState.history?.some(m => m.role === 'assistant');
  if (!hasAssistantMessage) {
    return json({
      error: 'No assistant message found to rewrite'
    }, { status: 400 });
  }

  try {
    // Rewrite the last response with the selected agent
    const turnResult = await rewriteLastResponse(selectedAgentId, clientState);

    // Return response with debug info
    return json({
      assistantMessage: turnResult.reply,
      debug: {
        plan: {
          selected_agents: turnResult.plan.selected_agents,
          selected_agent_id: turnResult.selected_agent_id, // Which agent response was actually shown
          primary_objective: turnResult.plan.primary_objective,
          tone_directives: turnResult.plan.tone_directives,
          pacing_directives: turnResult.plan.pacing_directives,
          reasoning: turnResult.plan.reasoning
        },
        evaluator: {
          metrics: turnResult.evaluator_output.metrics,
          agent_weight_adjustments: turnResult.evaluator_output.agent_weight_adjustments,
          pacing_policy: turnResult.evaluator_output.pacing_policy,
          reasoning: turnResult.evaluator_output.reasoning
        },
        agent_responses: turnResult.agent_responses.map((r) => ({
          agent: r.agentId, // Now includes agentId in each response
          draft: r.text.substring(0, 200) + (r.text.length > 200 ? '...' : ''),
          full_text: r.text, // Include full text for all personas
          annotations: r.annotations,
          is_selected: r.agentId === turnResult.selected_agent_id // Mark which was shown
        }))
      },
      state: turnResult.new_state // Return updated state for client to persist
    });
  } catch (err) {
    console.error('MentorAI rewrite error:', err);
    return json({
      error: 'Rewrite error',
      details: String(err?.message || err)
    }, { status: 500 });
  }
}

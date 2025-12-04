/**
 * MentorAI Chat API Endpoint
 *
 * Handles POST requests for MentorAI conversations
 * Follows the pattern from assignment-3/src/routes/api/chat/+server.js
 */

import { json } from '@sveltejs/kit';
import { handleUserTurn } from '$lib/core/handleTurn.js';
import { createInitialState } from '$lib/core/state.js';

/**
 * Handle chat POST requests for MentorAI multi-agent system
 *
 * Parameters: ({ request }) SvelteKit request wrapper
 * Returns: JSON response with assistant message and debug info
 */
export async function POST({ request }) {
  const body = await request.json();
  const { history, state: clientState } = body || {};

  if (!Array.isArray(history)) {
    return json({ error: 'history array is required' }, { status: 400 });
  }

  // Get the last user message
  const lastUserMessage = history
    .filter(m => m.role === 'user')
    .slice(-1)[0]?.content;

  if (!lastUserMessage) {
    return json({ error: 'No user message found in history' }, { status: 400 });
  }

  try {
    // Initialize or restore state
    let state = clientState || createInitialState();

    // Update state history from client history (in case client has more recent messages)
    if (history.length > 0) {
      state.history = history.map((m) => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now()
      }));
    }

    // Handle the turn through the full pipeline
    const turnResult = await handleUserTurn(lastUserMessage, state);

    console.log(`[API] Generated ${turnResult.agent_responses?.length || 0} agent responses`);
    console.log(`[API] Showing only selected agent: ${turnResult.selected_agent_id}`);
    console.log(`[API] User will see ONLY the selected response in chat, but all ${turnResult.agent_responses?.length || 0} are in debug`);

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
    const msg = String(err?.message || err || '').toLowerCase();
    if (msg.includes('gemini_api_key') || msg.includes('gemini') || msg.includes('api key')) {
      return json({ error: 'Gemini API key not found. Please set GEMINI_API_KEY in your .env file.' }, { status: 400 });
    }
    console.error('MentorAI pipeline error:', err);
    return json({
      error: 'Pipeline error',
      details: String(err?.message || err)
    }, { status: 500 });
  }
}

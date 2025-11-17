/**
 * Evaluator Agent
 *
 * Nickname: Quality Control & Adjuster
 *
 * Responsibilities:
 * - Track humane metrics over the conversation
 * - Use signals to adjust: agent weighting, pacing, challenge intensity
 *
 * Connection pattern:
 * - Bidirectional with Orchestrator (sends metrics + adjustments, receives plan/usage)
 * - One-way to Specialized Agents (configures indirectly via weights/policies)
 */

import { geminiGenerate } from '../llm/gemini.js';

const EVALUATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    metrics: {
      type: 'OBJECT',
      properties: {
        discomfort_to_growth_ratio: { type: 'NUMBER' },
        sycophancy_score: { type: 'NUMBER' },
        dependency_risk_score: { type: 'NUMBER' }
      }
    },
    agent_weight_adjustments: {
      type: 'OBJECT',
      properties: {
        trust_transparency: { type: 'NUMBER' },
        challenge_pacing: { type: 'NUMBER' },
        reflection_coach: { type: 'NUMBER' },
        transfer_to_world: { type: 'NUMBER' }
      }
    },
    pacing_policy: {
      type: 'OBJECT',
      properties: {
        target_length: { type: 'STRING' },
        encourage_pause: { type: 'BOOLEAN' },
        challenge_intensity: { type: 'NUMBER' }
      }
    },
    reasoning: { type: 'STRING' }
  },
  required: ['metrics', 'agent_weight_adjustments', 'pacing_policy']
};

export class Evaluator {
  constructor() {
    this.name = 'evaluator';
  }

  /**
   * Update metrics and generate adjustments based on conversation state
   *
   * @param {Object} params - Evaluation parameters
   * @param {string} params.user_message - Current user message
   * @param {Object} params.state - Current conversation state
   * @param {Object} [params.last_plan] - Last orchestration plan
   * @param {Array} [params.last_agent_outputs] - Last agent outputs
   * @param {Object} [params.user_feedback] - Optional user feedback (thumbs up/down, etc.)
   * @returns {Promise<EvaluatorOutput>}
   */
  async update({ user_message, state, last_plan = null, last_agent_outputs = [], user_feedback = null }) {
    const evaluationPrompt = this.buildEvaluationPrompt({
      user_message,
      state,
      last_plan,
      last_agent_outputs,
      user_feedback
    });

    const contents = state.history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    try {
      const result = await geminiGenerate({
        contents,
        systemPrompt: evaluationPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: EVALUATION_SCHEMA
        }
      });

      const parsed = JSON.parse(result.text || '{}');

      // Merge with existing metrics, preserving computed values
      const updatedMetrics = {
        ...state.humane_metrics,
        ...parsed.metrics,
        // Preserve computed metrics that shouldn't be overridden
        avg_response_delay_ms: state.humane_metrics.avg_response_delay_ms,
        user_rated_authenticity: user_feedback?.authenticity || state.humane_metrics.user_rated_authenticity
      };

      return {
        metrics: updatedMetrics,
        agent_weight_adjustments: parsed.agent_weight_adjustments || {},
        pacing_policy: parsed.pacing_policy || {
          target_length: 'medium',
          encourage_pause: false,
          challenge_intensity: 0.5
        },
        reasoning: parsed.reasoning || ''
      };
    } catch (err) {
      // Fallback to current state if evaluation fails
      console.error('Evaluator error:', err);
      return {
        metrics: state.humane_metrics,
        agent_weight_adjustments: {},
        pacing_policy: {
          target_length: 'medium',
          encourage_pause: false,
          challenge_intensity: 0.5
        },
        reasoning: 'Evaluation failed, using current metrics'
      };
    }
  }

  /**
   * Build evaluation prompt for Gemini
   * @param {Object} params - Evaluation parameters
   * @returns {string} - Evaluation prompt
   */
  buildEvaluationPrompt({ user_message, state, last_plan, last_agent_outputs, user_feedback }) {
    return `You are the Evaluator agent in a multi-agent mentoring system.

Your job is to track humane metrics and adjust agent weighting/pacing based on conversation quality.

**Current Metrics:**
- Discomfort-to-growth ratio: ${state.humane_metrics.discomfort_to_growth_ratio} (0-1, higher = more productive friction)
- Sycophancy score: ${state.humane_metrics.sycophancy_score} (0-1, higher = we're agreeing too much)
- Dependency risk score: ${state.humane_metrics.dependency_risk_score} (0-1, higher = user over-relying)

**Last Turn Context:**
${last_plan ? `- Primary objective: ${last_plan.primary_objective}\n- Agents called: ${last_plan.selected_agents.join(', ')}` : '- First turn'}
${user_feedback ? `- User feedback: ${JSON.stringify(user_feedback)}` : ''}

**Your Task:**
1. Update the three metrics above based on:
   - User's current message and tone
   - Whether we're being too agreeable (sycophancy)
   - Whether user seems stuck/over-dependent (dependency risk)
   - Whether there's productive friction (discomfort-to-growth)

2. Adjust agent weights (-1 to +1, where 0 = no change):
   - trust_transparency: Increase if sycophancy is high or user needs honesty
   - challenge_pacing: Increase if discomfort-to-growth is low or user needs pushback
   - reflection_coach: Increase if user is stuck/ruminating
   - transfer_to_world: Increase if dependency risk is high or topic is ending

3. Set pacing policy:
   - target_length: "short" | "medium" | "long"
   - encourage_pause: true if user needs to slow down and reflect
   - challenge_intensity: 0-1, how much challenge to apply

**Output Format:**
Return JSON with metrics, agent_weight_adjustments, pacing_policy, and reasoning.`;
  }
}

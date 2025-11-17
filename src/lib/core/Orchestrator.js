/**
 * Core Orchestrator Agent
 *
 * Nickname: Router & Tone Setter
 *
 * Responsibilities:
 * - Receive raw user input plus conversation state
 * - Decide which specialized agent(s) to call this turn
 * - Merge/compose their suggested outputs into a single reply
 * - Maintain global tone: "warm, intellectual, grounded"
 * - Decide primary objective: trust, challenge, reflection, or transfer
 */

import { geminiGenerate } from '../llm/gemini.js';
import { AGENT_IDS, OBJECTIVES } from './types.js';
import { TrustTransparencyAgent } from '../agents/TrustTransparencyAgent.js';
import { ChallengePacingAgent } from '../agents/ChallengePacingAgent.js';
import { ReflectionCoachAgent } from '../agents/ReflectionCoachAgent.js';
import { TransferToWorldAgent } from '../agents/TransferToWorldAgent.js';
import { shouldUseActiveListening, determineResponseMode } from '../listening/activeListening.js';
import { inferFeelings, extractPersonalPoints } from '../listening/emotionInference.js';

const ORCHESTRATION_SCHEMA = {
  type: 'OBJECT',
  properties: {
    selected_agents: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    },
    primary_objective: { type: 'STRING' },
    tone_directives: {
      type: 'OBJECT',
      properties: {
        warmth: { type: 'NUMBER' },
        intellectual: { type: 'NUMBER' },
        grounded: { type: 'NUMBER' }
      }
    },
    reasoning: { type: 'STRING' }
  },
  required: ['selected_agents', 'primary_objective', 'tone_directives']
};

export class Orchestrator {
  constructor() {
    this.name = 'orchestrator';
    this.agents = {
      [AGENT_IDS.TRUST]: new TrustTransparencyAgent(),
      [AGENT_IDS.CHALLENGE]: new ChallengePacingAgent(),
      [AGENT_IDS.REFLECTION]: new ReflectionCoachAgent(),
      [AGENT_IDS.TRANSFER]: new TransferToWorldAgent()
    };
  }

  /**
   * Plan orchestration: decide which agents to call and set objectives
   *
   * @param {Object} params - Planning parameters
   * @param {string} params.user_message - Current user message
   * @param {Object} params.state - Conversation state
   * @param {Object} params.humane_metrics - Current humane metrics
   * @param {Object} params.agent_weight_adjustments - Agent weight adjustments from evaluator
   * @param {Object} params.pacing_policy - Pacing policy from evaluator
   * @returns {Promise<OrchestrationPlan>}
   */
  async plan({ user_message, state, humane_metrics, agent_weight_adjustments = {}, pacing_policy = {} }) {
    const planningPrompt = this.buildPlanningPrompt({
      user_message,
      state,
      humane_metrics,
      agent_weight_adjustments,
      pacing_policy
    });

    const contents = state.history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));

    try {
      const result = await geminiGenerate({
        contents,
        systemPrompt: planningPrompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: ORCHESTRATION_SCHEMA
        }
      });

      const parsed = JSON.parse(result.text || '{}');

      // Validate and normalize
      const selected_agents = this.validateAgentIds(parsed.selected_agents || []);
      const primary_objective = this.validateObjective(parsed.primary_objective || OBJECTIVES.TRUST);
      const tone_directives = this.normalizeToneDirectives(parsed.tone_directives || {});
      const pacing_directives = {
        target_length: pacing_policy.target_length || 'medium',
        encourage_pause: pacing_policy.encourage_pause || false
      };

      // Determine active listening mode
      const useActiveListening = shouldUseActiveListening({
        userMessage: user_message,
        history: state.history,
        humaneMetrics: humane_metrics
      });

      const listeningMode = useActiveListening
        ? determineResponseMode({ history: state.history, humaneMetrics: humane_metrics, userMessage: user_message })
        : 'directive';

      // Infer feelings and extract personal points
      const inferredFeelings = useActiveListening ? inferFeelings(user_message, state.history) : null;
      const personalPoints = useActiveListening ? extractPersonalPoints(user_message) : [];

      const listening_directives = {
        mode: listeningMode,
        use_active_listening: useActiveListening,
        inferredFeelings: inferredFeelings,
        personalPoints: personalPoints
      };

      return {
        selected_agents,
        primary_objective,
        tone_directives,
        pacing_directives,
        listening_directives,
        reasoning: parsed.reasoning || ''
      };
    } catch (err) {
      console.error('Orchestrator planning error:', err);
      // Fallback plan with active listening
      const useActiveListening = shouldUseActiveListening({
        userMessage: user_message,
        history: state.history,
        humaneMetrics: humane_metrics
      });
      const listeningMode = useActiveListening ? 'reflective' : 'directive';
      const inferredFeelings = useActiveListening ? inferFeelings(user_message, state.history) : null;
      const personalPoints = useActiveListening ? extractPersonalPoints(user_message) : [];

      return {
        selected_agents: [AGENT_IDS.TRUST],
        primary_objective: OBJECTIVES.TRUST,
        tone_directives: state.session_config?.default_tone || { warmth: 0.7, intellectual: 0.6, grounded: 0.8 },
        pacing_directives: {
          target_length: 'medium',
          encourage_pause: false
        },
        listening_directives: {
          mode: listeningMode,
          use_active_listening: useActiveListening,
          inferredFeelings: inferredFeelings,
          personalPoints: personalPoints
        },
        reasoning: 'Planning failed, using default trust-focused plan'
      };
    }
  }

  /**
   * Call selected agents and get their responses
   *
   * @param {Object} params - Agent invocation parameters
   * @param {string[]} params.selected_agents - Agent IDs to call
   * @param {string} params.user_message - Current user message
   * @param {Object} params.state - Conversation state
   * @param {Object} params.plan - Orchestration plan
   * @param {Object} params.humane_metrics - Humane metrics
   * @returns {Promise<AgentResponse[]>}
   */
  async invokeAgents({ selected_agents, user_message, state, plan, humane_metrics }) {
    const agentRequest = {
      user_message,
      conversation_history: state.history,
      objective: plan.primary_objective,
      tone_directives: plan.tone_directives,
      pacing_directives: plan.pacing_directives,
      humane_metrics,
      listening_directives: plan.listening_directives
    };

    // Call agents in parallel (or sequentially if needed)
    const responses = await Promise.all(
      selected_agents.map(async (agentId) => {
        const agent = this.agents[agentId];
        if (!agent) {
          console.warn(`Agent ${agentId} not found`);
          return { text: '', annotations: {} };
        }
        return await agent.respond(agentRequest);
      })
    );

    return responses;
  }

  /**
   * Fuse multiple agent responses into a single unified reply
   *
   * @param {AgentResponse[]} agentResponses - Individual agent responses
   * @param {OrchestrationPlan} plan - Orchestration plan
   * @returns {Promise<string>} - Fused final response
   */
  async fuse(agentResponses, plan) {
    if (agentResponses.length === 0) {
      return "I'm here to help. Could you tell me more about what you're thinking?";
    }

    if (agentResponses.length === 1) {
      return agentResponses[0].text || '';
    }

    // Multiple agents: use LLM to fuse their responses
    const fusionPrompt = this.buildFusionPrompt(agentResponses, plan);
    const agentTexts = agentResponses.map((r, i) => `Agent ${i + 1}:\n${r.text}`).join('\n\n---\n\n');

    const contents = [{
      role: 'user',
      parts: [{ text: agentTexts }]
    }];

    try {
      const result = await geminiGenerate({
        contents,
        systemPrompt: fusionPrompt
      });
      return result.text || this.fallbackFusion(agentResponses);
    } catch (err) {
      console.error('Fusion error:', err);
      return this.fallbackFusion(agentResponses);
    }
  }

  /**
   * Build planning prompt for orchestrator
   */
  buildPlanningPrompt({ user_message, state, humane_metrics, agent_weight_adjustments, pacing_policy }) {
    return `You are the Core Orchestrator in a multi-agent mentoring system.

Your job is to decide which specialized agents should respond to the user right now and set the tone/objective.

**Available Agents:**
- ${AGENT_IDS.TRUST}: Trust & Transparency (honesty, limitations, grounded dialogue)
- ${AGENT_IDS.CHALLENGE}: Challenge & Pacing (gentle pushback, productive friction)
- ${AGENT_IDS.REFLECTION}: Reflection Coach (reflective prompts, self-understanding)
- ${AGENT_IDS.TRANSFER}: Transfer-to-World (concrete actions, independence)

**Current Context:**
- User message: "${user_message}"
- Conversation length: ${state.history.length} messages
- Humane metrics:
  - Discomfort-to-growth: ${humane_metrics.discomfort_to_growth_ratio}
  - Sycophancy: ${humane_metrics.sycophancy_score}
  - Dependency risk: ${humane_metrics.dependency_risk_score}

**Evaluator Adjustments:**
${Object.entries(agent_weight_adjustments).map(([agent, weight]) => `- ${agent}: ${weight > 0 ? '+' : ''}${weight}`).join('\n') || '- No adjustments'}

**Pacing Policy:**
- Target length: ${pacing_policy.target_length || 'medium'}
- Encourage pause: ${pacing_policy.encourage_pause || false}

**Your Task:**
1. Select 1-3 agents that should contribute to the response (usually 1-2)
2. Choose primary objective: "${OBJECTIVES.TRUST}" | "${OBJECTIVES.CHALLENGE}" | "${OBJECTIVES.REFLECTION}" | "${OBJECTIVES.TRANSFER}"
3. Set tone directives (0-1 scale):
   - warmth: default 0.7, adjust based on user needs
   - intellectual: default 0.6, higher for complex topics
   - grounded: default 0.8, always keep high

**Output Format:**
Return JSON with selected_agents (array of agent IDs), primary_objective, tone_directives, and reasoning.`;
  }

  /**
   * Build fusion prompt for combining agent responses
   */
  buildFusionPrompt(agentResponses, plan) {
    return `You are fusing multiple agent responses into a single, unified reply.

**Primary Objective:** ${plan.primary_objective}
**Tone:** Warmth ${plan.tone_directives.warmth}, Intellectual ${plan.tone_directives.intellectual}, Grounded ${plan.tone_directives.grounded}
**Target Length:** ${plan.pacing_directives.target_length}

**Agent Responses to Fuse:**
You will receive responses from ${agentResponses.length} specialized agents. Each brings a different perspective:
- Trust & Transparency: honesty, limitations, grounded dialogue
- Challenge & Pacing: gentle pushback, productive friction
- Reflection Coach: reflective prompts, self-understanding
- Transfer-to-World: concrete actions, independence

**Your Task:**
Create a single, coherent response that:
1. Integrates insights from all agent responses naturally
2. Maintains the primary objective and tone
3. Feels like one unified voice, not multiple voices
4. Is ${plan.pacing_directives.target_length} in length
5. ${plan.pacing_directives.encourage_pause ? 'Encourages the user to pause and reflect before continuing' : ''}

Output only the fused response text, no meta-commentary.`;
  }

  /**
   * Fallback fusion: simple concatenation if LLM fusion fails
   */
  fallbackFusion(agentResponses) {
    return agentResponses
      .map(r => r.text)
      .filter(t => t)
      .join('\n\n');
  }

  /**
   * Validate agent IDs
   */
  validateAgentIds(agentIds) {
    const valid = Object.values(AGENT_IDS);
    return agentIds.filter(id => valid.includes(id)).slice(0, 3); // Max 3 agents
  }

  /**
   * Validate objective
   */
  validateObjective(objective) {
    return Object.values(OBJECTIVES).includes(objective) ? objective : OBJECTIVES.TRUST;
  }

  /**
   * Normalize tone directives
   */
  normalizeToneDirectives(tone) {
    return {
      warmth: Math.max(0, Math.min(1, tone.warmth || 0.7)),
      intellectual: Math.max(0, Math.min(1, tone.intellectual || 0.6)),
      grounded: Math.max(0, Math.min(1, tone.grounded || 0.8))
    };
  }
}

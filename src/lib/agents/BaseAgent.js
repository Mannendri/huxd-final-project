/**
 * Base Agent class for MentorAI specialized agents
 * Follows the pattern from assignment-3/src/lib/agents/Agent.js
 *
 * All specialized agents extend this base class and implement the respond() method
 */

import { geminiGenerate } from '../llm/gemini.js';

export class BaseAgent {
  constructor(name) {
    this.name = name;
  }

  /**
   * Respond to the user with this agent's persona and objectives
   *
   * Subclasses must override this method to provide agent-specific behavior
   *
   * @param {AgentRequest} request - Normalized agent request
   * @returns {Promise<AgentResponse>} - Agent response with draft reply
   */
  async respond(request) {
    // Base implementation - subclasses should override
    const systemPrompt = this.getSystemPrompt(request);
    const contents = this.formatContents(request);

    const { text } = await geminiGenerate({
      contents,
      systemPrompt,
      config: this.getGenerationConfig(request)
    });

    return {
      text,
      annotations: this.extractAnnotations(text, request)
    };
  }

  /**
   * Get system prompt for this agent
   * Subclasses must implement this
   * @param {AgentRequest} request - Agent request
   * @returns {string} - System prompt
   */
  getSystemPrompt(request) {
    throw new Error('Subclasses must implement getSystemPrompt()');
  }

  /**
   * Get target audience context for prompts
   * @returns {string} - Target audience description
   */
  getTargetAudienceContext() {
    return `**Target Audience: Technically Minded Teens**
You are mentoring technically minded teens (ages 14-19) who:
- Think systematically and appreciate logical frameworks
- Are comfortable with debugging, hypothesis testing, and iterative problem-solving
- Value transparency, precision, and understanding how things work
- May struggle with emotional nuance but are capable of deep reflection when given the right scaffolds
- Need age-appropriate guidance that respects their intelligence and agency

**Technical Thinking Integration:**
- Use technical metaphors when helpful (debugging, systems thinking, testing hypotheses)
- Frame emotional challenges as problems to understand systematically
- Respect their technical knowledge - don't oversimplify or talk down
- Help them apply their analytical skills to personal growth
- Balance logical frameworks with emotional intelligence`;
  }

  /**
   * Format conversation contents for Gemini API
   * @param {AgentRequest} request - Agent request
   * @returns {Array} - Gemini-formatted contents
   */
  formatContents(request) {
    // Convert conversation history to Gemini format
    return request.conversation_history.map((m) => ({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.content }]
    }));
  }

  /**
   * Get generation config for this agent
   * Override in subclasses if needed
   * @param {AgentRequest} request - Agent request
   * @returns {Object} - Generation config
   */
  getGenerationConfig(request) {
    return {};
  }

  /**
   * Extract annotations from response text
   * Override in subclasses to extract agent-specific annotations
   * @param {string} text - Response text
   * @param {AgentRequest} request - Original request
   * @returns {Record<string, any>} - Annotations
   */
  extractAnnotations(text, request) {
    return {};
  }
}

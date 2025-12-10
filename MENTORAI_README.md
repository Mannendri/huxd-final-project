# MentorAI – Generation 1 (MVP) – Iteration 2

Multi-agent conversational mentoring system built with SvelteKit and Google Gemini API.

**Iteration 2**: Integrated active listening principles from "Active Listening and Reflective Responses" by JoAnne Yates.

## Overview

MentorAI is a frame-sensitive conversational system that adapts its tone, objectives, and responses based on context. It uses a multi-agent architecture with:

- **Core Orchestrator**: Routes each turn and decides which agents to call
- **Evaluator**: Monitors humane metrics and adjusts pacing/weighting
- **Four Specialized Agents**:
  - **Trust & Transparency**: Fosters trust through honesty and grounded dialogue
  - **Challenge & Pacing**: Creates productive friction through gentle pushback
  - **Reflection Coach**: Promotes deep reflection and self-understanding
  - **Transfer-to-World**: Encourages independence through concrete actions

## Architecture

This implementation follows the patterns from `assignment-3` (SvelteKit + JavaScript) while implementing the multi-agent architecture specified in `docs/mentorai_architecture.md`.

### Project Structure

```
src/
├── lib/
│   ├── core/
│   │   ├── types.js           # Type definitions and constants
│   │   ├── state.js           # State management utilities
│   │   ├── Evaluator.js       # Evaluator agent implementation
│   │   ├── Orchestrator.js    # Core orchestrator implementation
│   │   └── handleTurn.js      # Main control loop
│   ├── agents/
│   │   ├── BaseAgent.js       # Base agent class
│   │   ├── TrustTransparencyAgent.js
│   │   ├── ChallengePacingAgent.js
│   │   ├── ReflectionCoachAgent.js
│   │   └── TransferToWorldAgent.js
│   └── llm/
│       └── gemini.js           # Gemini API client wrapper
└── routes/
    ├── api/mentorai/chat/
    │   └── +server.js          # Chat API endpoint
    └── mentorai/
        └── +page.svelte        # Frontend chat interface
```

## Setup

### Prerequisites

- Node.js 20.x
- npm
- Google Gemini API key

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```

4. Add your Gemini API key to `.env`:
   ```
   GEMINI_API_KEY=your_api_key_here
   GEMINI_MODEL=gemini-2.5-flash
   ```

   Get your API key from [Google AI Studio](https://aistudio.google.com/)

### Running the App

```bash
npm run dev
```

Open `http://localhost:5173/mentorai` in your browser.

## How It Works

### Control Flow (Per Turn)

1. **Evaluator Update**: Evaluator analyzes conversation state and updates humane metrics
2. **Orchestration Planning**: Orchestrator decides which agents to call and sets objectives
3. **Agent Invocation**: Selected specialized agents generate draft responses
4. **Response Fusion**: Orchestrator fuses agent responses into a single unified reply
5. **State Update**: Conversation state is updated for the next turn

### Humane Metrics

The Evaluator tracks:
- **Discomfort-to-growth ratio**: Measures productive friction (0-1)
- **Sycophancy score**: How much we're just agreeing (0-1)
- **Dependency risk score**: Is user over-relying on AI? (0-1)

These metrics influence agent weighting and pacing decisions.

### Agent Selection

The Orchestrator selects 1-3 agents per turn based on:
- User's current message and needs
- Conversation history and context
- Humane metrics from the Evaluator
- Agent weight adjustments

### Response Fusion

When multiple agents contribute, their responses are fused into a single coherent reply that maintains:
- The primary objective (trust, challenge, reflection, or transfer)
- The global tone (warm, intellectual, grounded)
- Natural flow and coherence

## Development

### Key Files

- **`src/lib/core/handleTurn.js`**: Main control loop implementing the per-turn logic
- **`src/lib/core/Orchestrator.js`**: Core orchestrator with planning and fusion logic
- **`src/lib/core/Evaluator.js`**: Evaluator with metric tracking and adjustments
- **`src/lib/agents/*.js`**: Specialized agent implementations

### Adding New Agents

1. Extend `BaseAgent` class
2. Implement `getSystemPrompt()` method
3. Add agent to `Orchestrator.agents` map
4. Update `AGENT_IDS` in `types.js`

### Customizing Prompts

Each agent has a `getSystemPrompt()` method that generates the system prompt based on the current request. Modify these methods to adjust agent behavior.

## Deployment

### Vercel

1. Create a Vercel account and import your GitHub repo
2. In Vercel Project Settings → Environment Variables, add:
   - `GEMINI_API_KEY` (required) - Your Google Gemini API key from [Google AI Studio](https://aistudio.google.com/)
   - `GEMINI_MODEL` (optional) - Defaults to `gemini-2.5-flash` if not set
3. Deploy - Vercel will automatically detect the SvelteKit adapter and deploy

**Important**:
- Never commit `.env` or API keys to Git. Use Vercel Environment Variables only.
- The app uses `$env/dynamic/private` which automatically reads from Vercel's environment variables
- Make sure to set environment variables for all environments (Production, Preview, Development) if needed
- After adding environment variables, trigger a new deployment for changes to take effect

## Debug Mode

The frontend includes a debug panel (toggle with "Show Debug" button) that displays:
- Orchestration plan (selected agents, objectives, tone)
- Evaluator metrics and adjustments
- Individual agent draft responses

## Architecture Reference

See `docs/mentorai_architecture.md` for the complete architecture specification.

## Tech Stack

- **Framework**: SvelteKit 2.5.10
- **UI**: Svelte 4.2.18
- **Build Tool**: Vite 5.4.0
- **Runtime**: Node.js 20.x
- **LLM**: Google Gemini API (`@google/genai` 0.2.0)
- **Deployment**: Vercel (via `@sveltejs/adapter-vercel`)

## License

Private project for MIT 6.S061 Final Project.

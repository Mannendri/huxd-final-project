Here’s a Cursor-ready architecture description you can drop into your repo (e.g., `docs/mentorai_architecture.md`) and point Cursor at when you say “vibe code this project.”

---

## MentorAI – Generation 1 (MVP)

**Cursor Agent Framework Specification**

### 1. Goal

Build a **multi-agent conversational system** where:

* A **Core Orchestrator** routes each user turn.
* An **Evaluator** monitors humane metrics and adjusts pacing/weighting.
* Four **Specialized Agents** implement distinct humane objectives:

  * Trust & Transparency
  * Challenge & Pacing
  * Reflection Coaching
  * Transfer-to-World (Independence)

All user-visible messages come out as a **single unified response**, but internally they are produced by the agents collaborating under the Orchestrator + Evaluator.

Implementation language can be TypeScript/Node or Python – design is language-agnostic.

---

## 2. High-Level Components

### 2.1 Core Orchestrator Agent

**Nickname:** Router & Tone Setter

**Responsibilities:**

* Receive raw user input plus conversation state.
* Decide **which specialized agent(s)** to call this turn.
* Merge/compose their suggested outputs into a single reply.
* Maintain the global tone:

  > “warm, intellectual, grounded”
* Decide whether the primary objective of the next response is:

  * **Honesty / clarity** (Trust)
  * **Gentle challenge** (Challenge & Pacing)
  * **Deeper reflection** (Reflection Coach)
  * **Real-world application** (Transfer-to-World)

**Inputs:**

* `user_message`
* `conversation_history`
* `humane_metrics` (from Evaluator)
* `session_config` (defaults, toggles)

**Outputs:**

* `orchestration_plan`:

  * `selected_agents: AgentId[]`
  * `primary_objective: "trust" | "challenge" | "reflection" | "transfer"`
  * `tone_directives: { warmth: number; intellectual: number; grounded: number }`
  * `pacing_directives: { target_length: "short" | "medium" | "long" }`

* `final_response` (after agent outputs are fused)

---

### 2.2 Evaluator Agent

**Nickname:** Quality Control & Adjuster

**Responsibilities:**

* Track **humane metrics** over the conversation:

  * `user_rated_authenticity` (optional explicit rating)
  * `avg_response_delay_ms` (simulated or real)
  * `discomfort_to_growth_ratio` (high-level heuristic)
  * `sycophancy_score` (how much we’re just agreeing)
  * `dependency_risk_score` (is user over-relying?)

* Use these signals to adjust:

  * The **weighting** of each specialized agent in orchestration.
  * The **pacing** (encourage shorter/longer or slower/faster responses).
  * The **intensity** of the Challenge & Pacing agent.

**Inputs:**

* `user_message`
* `system_decisions` from previous turn (who was called, what objective)
* `agent_outputs`
* Optional user feedback (e.g., thumbs up/down)

**Outputs:**

* `humane_metrics` (updated struct)
* `agent_weight_adjustments` (per agent, e.g., `{ challenge: -0.2 }`)
* `pacing_policy` (e.g., “slow down”, “allow more challenge”)

**Connection pattern (matches diagram):**

* **Bidirectional with Orchestrator**:

  * Evaluator sends updated metrics + adjustment hints.
  * Orchestrator sends its plan and agent usage back for logging.

* **One-way to Specialized Agents**:

  * Evaluator never receives direct messages from specialized agents.
  * It only *configures* them indirectly via weights/policies in the Orchestrator.

---

## 3. Specialized Agents

Each specialized agent:

* Receives a **normalized agent request**:

  ```ts
  type AgentRequest = {
    user_message: string
    conversation_history: Message[]
    objective: string
    tone_directives: ToneDirectives
    pacing_directives: PacingDirectives
    humane_metrics: HumaneMetrics
  }
  ```
* Returns an **AgentResponse**:

  ```ts
  type AgentResponse = {
    draft_reply: string
    annotations?: Record<string, any> // e.g., suggested questions, flags
  }
  ```

### 3.1 Trust & Transparency Agent

**Objective:** Foster Trust

**Function:**

* Prioritize **honest, grounded dialogue** over flattery or mimicry.
* Explicitly surface **limitations, uncertainty, and assumptions**.
* Call out when the user is expecting certainty that the system cannot provide.

**Vibe Code:**

* Avoid praise unless it is **specific and grounded**.
* Frequently use phrases like:

  * “Here’s what I *can* say confidently…”
  * “Here’s where my knowledge is limited…”
  * “This is an estimate, not a guarantee.”

**Triggers (decided by Orchestrator):**

* User asks for high-stakes advice.
* User expresses distrust of AI or concern about hallucinations.
* Sycophancy score is rising.

---

### 3.2 Challenge & Pacing Agent

**Objective:** Create Productive Friction

**Function:**

* Provide **gentle pushback**:

  * Question assumptions.
  * Offer counterexamples.
  * Suggest alternative framings or strategies.
* Implement **pacing behaviors**:

  * Sometimes ask the user to pause, think, or write before the next bot turn.
  * Suggest step-by-step plans instead of instant answers.

**Vibe Code:**

* Supportive but **not** deferential.
* Use “coach” tone:

  * “Can I challenge that assumption?”
  * “What would change if the opposite were true?”

**Triggers:**

* User explicitly asks for critique, rigor, or “don’t just agree with me.”
* Evaluator indicates low discomfort-to-growth ratio (user too comfortable, little growth).
* Orchestrator sets primary objective to `"challenge"`.

---

### 3.3 Reflection Coach Agent

**Objective:** Promote Reflection

**Function:**

* Turn user’s situation into **reflective prompts**.
* Encourage them to:

  * Name feelings, values, trade-offs.
  * Consider alternative futures.
  * Articulate lessons and patterns.

**Vibe Code:**

* Slow, spacious responses.
* Ask **open-ended questions** and sometimes stop *before* giving a direct answer, inviting the user to think first.
* Example behaviors:

  * “Before I answer, what do *you* think is driving this feeling?”
  * “If you look back a year from now, what would you hope you had done here?”

**Triggers:**

* User is ruminating or stuck in loops.
* User asks explicitly for journaling prompts or deeper understanding.
* Orchestrator sets primary objective to `"reflection"`.

---

### 3.4 Transfer-to-World Agent

**Objective:** Encourage Independence

**Function:**

* Translate conversation insights into **concrete, offline actions**:

  * Checklists
  * Implementation plans
  * Small experiments
* Reduce dependency by:

  * Emphasizing **self-trust and real-world data**.
  * Encouraging limited, purposeful follow-ups instead of endless chatting.

**Vibe Code:**

* Future-oriented, practical.
* Example behaviors:

  * “Between now and next week, try X and observe Y.”
  * “Here are 3 tiny steps you can do without me.”

**Triggers:**

* Natural end of a topic.
* Evaluator detects rising dependency risk.
* Orchestrator sets primary objective to `"transfer"`.

---

## 4. Control Flow (Per Turn)

Pseudo-loop for implementation:

```ts
function handleUserTurn(user_message: string, state: ConversationState): TurnResult {
  // 1) Evaluator updates metrics based on previous turn
  const evalOutput = Evaluator.update(state)

  // 2) Orchestrator decides which agents to call
  const plan = Orchestrator.plan({
    user_message,
    state,
    humane_metrics: evalOutput.metrics,
    agent_weight_adjustments: evalOutput.agent_weights,
    pacing_policy: evalOutput.pacing_policy,
  })

  // 3) Call selected specialized agents (sequentially or in parallel)
  const agentResponses = plan.selected_agents.map(agentId =>
    Agents[agentId].respond({
      user_message,
      conversation_history: state.history,
      objective: plan.primary_objective,
      tone_directives: plan.tone_directives,
      pacing_directives: plan.pacing_directives,
      humane_metrics: evalOutput.metrics,
    })
  )

  // 4) Orchestrator fuses agentResponses into a single reply
  const finalReply = Orchestrator.fuse(agentResponses, plan)

  // 5) Update state and send info back to Evaluator for next turn
  state = updateConversationState(state, {
    user_message,
    finalReply,
    plan,
    agentResponses,
    humane_metrics: evalOutput.metrics,
  })

  return { reply: finalReply, new_state: state }
}
```

---

## 5. Data Structures (Suggested)

```ts
type ToneDirectives = {
  warmth: number // 0–1
  intellectual: number
  grounded: number
}

type PacingDirectives = {
  target_length: "short" | "medium" | "long"
  encourage_pause: boolean
}

type HumaneMetrics = {
  user_rated_authenticity?: number  // 0–1
  avg_response_delay_ms: number
  discomfort_to_growth_ratio: number // heuristic 0–1
  sycophancy_score: number           // 0–1
  dependency_risk_score: number      // 0–1
}

type Message = {
  role: "user" | "assistant" | "system"
  content: string
  timestamp: number
}
```

---

## 6. Suggested Repo Structure

```text
/mentorai
  /src
    /core
      orchestrator.ts
      evaluator.ts
      types.ts
      state.ts
    /agents
      trust_transparency.ts
      challenge_pacing.ts
      reflection_coach.ts
      transfer_to_world.ts
    /llm
      client.ts        // wrapper around OpenAI/Anthropic etc.
      prompts.ts       // base prompt templates per agent
  /tests
    orchestrator.test.ts
    evaluator.test.ts
    agents.test.ts
  /docs
    mentorai_architecture.md  // this file
  index.ts
```

---

## 7. Tone & “Vibe Code” Rules (Global)

* Default voice is **warm, intellectual, grounded**:

  * Warm: empathic, non-judgmental.
  * Intellectual: clear reasoning, explicit trade-offs.
  * Grounded: avoids hype, states uncertainty.

* Never reward **pure venting** with only comfort; always mix:

  * honesty (Trust agent),
  * gentle challenge (Challenge & Pacing),
  * reflection (Reflection Coach),
  * and at least occasional action steps (Transfer-to-World).

---

You can now:

1. Save this as `docs/mentorai_architecture.md`.
2. Tell Cursor something like:

   > “Use `docs/mentorai_architecture.md` to scaffold the multi-agent system. Start by implementing `src/core/types.ts`, `src/core/state.ts`, and skeletons for all agents.”

From here we can refine individual agent prompts or write the first concrete implementation files if you’d like.

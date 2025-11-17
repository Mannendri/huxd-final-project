<script>
  import { onMount } from 'svelte';

  let input = '';
  let messages = [];
  let debugOpen = false;
  let debugInfo = null; // { plan, evaluator, agent_responses }
  let isLoading = false;
  let errorMsg = '';
  let conversationState = null; // Store state for persistence

  onMount(() => {
    // Load persisted state if available
    const saved = localStorage.getItem('mentorai_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        conversationState = parsed;
        messages = parsed.history || [];
      } catch (e) {
        console.error('Failed to load saved state:', e);
      }
    }
  });

  async function send() {
    const content = input.trim();
    if (!content) return;

    messages = [...messages, { role: 'user', content }];
    input = '';
    isLoading = true;
    errorMsg = '';
    debugInfo = null;

    try {
      const res = await fetch('/api/mentorai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: messages,
          state: conversationState
        })
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        errorMsg = data?.error || 'Request failed';
        isLoading = false;
        return;
      }

      if (data.assistantMessage) {
        messages = [...messages, { role: 'assistant', content: data.assistantMessage }];
        debugInfo = data.debug || null;
        conversationState = data.state || null;

        // Persist state
        if (conversationState) {
          localStorage.setItem('mentorai_state', JSON.stringify(conversationState));
        }
      }
    } catch (err) {
      errorMsg = 'Network error: ' + err.message;
    } finally {
      isLoading = false;
    }
  }

  function clearConversation() {
    messages = [];
    debugInfo = null;
    conversationState = null;
    localStorage.removeItem('mentorai_state');
  }
</script>

<style>
  :global(:root) {
    --bg: #0f172a;
    --bg-grad-a: #0b1223;
    --bg-grad-b: #111827;
    --card: #ffffff;
    --card-muted: #f8fafc;
    --border: #e5e7eb;
    --text: #0f172a;
    --muted: #64748b;
    --primary: #2563eb;
    --primary-600: #1d4ed8;
  }

  :global(html, body) {
    height: 100%;
    margin: 0;
    background: radial-gradient(1200px 600px at 20% -10%, rgba(37,99,235,0.25), transparent),
                radial-gradient(900px 500px at 100% 0%, rgba(34,197,94,0.18), transparent),
                linear-gradient(180deg, var(--bg-grad-a), var(--bg-grad-b));
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, 'Apple Color Emoji', 'Segoe UI Emoji';
  }

  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }

  .container { max-width: 960px; margin: 2.5rem auto; padding: 0 1rem; }
  h1 { color: #e5ebff; letter-spacing: 0.2px; margin: 0 0 0.25rem 0; font-weight: 650; }
  .subtle { color: #a5b4fc; font-size: 0.95rem; margin-bottom: 0.75rem; }

  .row { display: flex; gap: 0.5rem; align-items: center; }
  .chat {
    border-radius: 12px;
    padding: 1rem;
    min-height: 320px;
    max-height: 800px;
    overflow-y: auto;
    background: var(--card);
    border: 1px solid var(--border);
    box-shadow: 0 8px 24px rgba(2,6,23,0.12);
    -webkit-overflow-scrolling: touch;
  }
  .flexcol { display: flex; flex-direction: column; gap: 0.35rem; }
  .bubble { padding: 0.65rem 0.85rem; border-radius: 12px; margin: 0.25rem 0; max-width: 80%; white-space: pre-wrap; line-height: 1.4; }
  .user { background: #e8f0ff; color: #0b1a3a; align-self: flex-end; border: 1px solid #c7d2fe; }
  .assistant { background: #f5f7fb; color: #0f172a; align-self: flex-start; border: 1px solid #e5e7eb; }
  .bubble:hover { outline: 2px solid transparent; box-shadow: 0 1px 0 rgba(2,6,23,0.04); }
  .meta { color: var(--muted); font-size: 0.8rem; margin-bottom: 0.15rem; }

  .toolbar { display: flex; gap: 1rem; align-items: center; justify-content: space-between; margin: 0.75rem 0; }

  input[type="text"] {
    padding: 0.6rem 0.7rem; border-radius: 10px; border: 1px solid var(--border); background: var(--card);
    outline: none; transition: border-color .15s ease, box-shadow .15s ease;
  }
  input[type="text"]:focus { border-color: var(--primary); box-shadow: 0 0 0 3px rgba(37,99,235,0.15); }

  :global(button) { padding: 0.55rem 0.9rem; border: 1px solid transparent; border-radius: 10px; background: var(--primary); color: white; cursor: pointer; font-weight: 550; }
  :global(button:hover) { background: var(--primary-600); }
  :global(button.secondary) { background: var(--card); color: var(--text); border-color: var(--border); }
  :global(button.secondary:hover) { background: var(--card-muted); }

  .debug {
    background: var(--card);
    border: 1px dashed var(--border);
    padding: 0.75rem;
    margin-top: 0.75rem;
    border-radius: 10px;
    box-shadow: 0 2px 14px rgba(2,6,23,0.06);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    font-size: 0.85rem;
  }
  .debug-section { margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid var(--border); }
  .debug-section:first-child { margin-top: 0; padding-top: 0; border-top: none; }

  .error {
    background: #fff1f2;
    color: #7f1d1d;
    border: 1px solid #fecaca;
    padding: 0.6rem 0.75rem;
    border-radius: 10px;
    margin: 0.5rem 0 0.75rem 0;
  }

  .typing { display: inline-flex; gap: 6px; align-items: center; }
  .dot { width: 7px; height: 7px; background: #a3aab8; border-radius: 50%; animation: blink 1.4s infinite both; }
  .dot:nth-child(2) { animation-delay: .2s; }
  .dot:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

  @media (max-width: 640px) {
    .bubble { max-width: 92%; }
    .toolbar { gap: 0.5rem; }
    .container { margin: 1.25rem auto; }
  }
</style>

<div class="container">
  <h1>MentorAI – Generation 1 (MVP) – Iteration 2</h1>
  <div class="subtle">Multi-agent conversational mentoring system with active listening</div>
  <div class="toolbar" style="margin: 0.5rem 0 0.75rem 0;">
    <button class="secondary" on:click={() => (debugOpen = !debugOpen)}>
      {debugOpen ? 'Hide' : 'Show'} Debug
    </button>
    <button class="secondary" on:click={clearConversation}>Clear</button>
  </div>

  {#if errorMsg}
    <div class="error" role="alert">
      {errorMsg}
    </div>
  {/if}

  <div class="chat flexcol">
    {#each messages as m, i}
      <div class="bubble {m.role}">
        <div class="meta">{m.role}</div>
        <div>{m.content}</div>
      </div>
    {/each}
    {#if isLoading}
      <div class="bubble assistant">
        <div class="meta">assistant</div>
        <div class="typing" aria-label="Assistant is thinking">
          <span class="dot"></span>
          <span class="dot"></span>
          <span class="dot"></span>
        </div>
      </div>
    {/if}
  </div>

  <div class="row" style="margin-top: 0.75rem;">
    <input
      type="text"
      placeholder="Type a message..."
      bind:value={input}
      on:keydown={(e) => e.key === 'Enter' && send()}
      style="flex: 1; padding: 0.6rem; border-radius: 6px; border: 1px solid #ddd;"
    />
    <button on:click={send}>Send</button>
  </div>
</div>

{#if debugOpen && debugInfo}
  <div class="container">
    <div class="debug">
      <div class="debug-section">
        <div><strong>Orchestration Plan:</strong></div>
        <div>Selected Agents: {debugInfo.plan?.selected_agents?.join(', ') || 'none'}</div>
        <div>Primary Objective: {debugInfo.plan?.primary_objective || 'none'}</div>
        <div>Tone: W{debugInfo.plan?.tone_directives?.warmth?.toFixed(2)} I{debugInfo.plan?.tone_directives?.intellectual?.toFixed(2)} G{debugInfo.plan?.tone_directives?.grounded?.toFixed(2)}</div>
        <div>Pacing: {debugInfo.plan?.pacing_directives?.target_length} {debugInfo.plan?.pacing_directives?.encourage_pause ? '(pause encouraged)' : ''}</div>
        {#if debugInfo.plan?.reasoning}
          <div style="margin-top: 0.25rem; font-style: italic; color: var(--muted);">{debugInfo.plan.reasoning}</div>
        {/if}
      </div>

      <div class="debug-section">
        <div><strong>Evaluator Metrics:</strong></div>
        <div>Discomfort-to-Growth: {debugInfo.evaluator?.metrics?.discomfort_to_growth_ratio?.toFixed(2) || 'N/A'}</div>
        <div>Sycophancy: {debugInfo.evaluator?.metrics?.sycophancy_score?.toFixed(2) || 'N/A'}</div>
        <div>Dependency Risk: {debugInfo.evaluator?.metrics?.dependency_risk_score?.toFixed(2) || 'N/A'}</div>
        {#if debugInfo.evaluator?.agent_weight_adjustments && Object.keys(debugInfo.evaluator.agent_weight_adjustments).length > 0}
          <div style="margin-top: 0.25rem;">
            <strong>Weight Adjustments:</strong>
            {#each Object.entries(debugInfo.evaluator.agent_weight_adjustments) as [agent, weight]}
              <div>{agent}: {weight > 0 ? '+' : ''}{weight.toFixed(2)}</div>
            {/each}
          </div>
        {/if}
      </div>

      {#if debugInfo.agent_responses && debugInfo.agent_responses.length > 0}
        <div class="debug-section">
          <div><strong>Agent Responses:</strong></div>
          {#each debugInfo.agent_responses as response}
            <div style="margin-top: 0.25rem;">
              <strong>{response.agent}:</strong> {response.draft}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

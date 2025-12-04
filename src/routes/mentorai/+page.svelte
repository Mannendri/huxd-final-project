<script>
  import { onMount, onDestroy } from 'svelte';
  import { afterUpdate } from 'svelte';

  let input = '';
  let messages = [];
  let chatContainer;
  let debugOpen = false;
  let debugInfo = null; // { plan, evaluator, agent_responses }
  let isLoading = false;
  let errorMsg = '';
  let conversationState = null; // Store state for persistence
  let rewindModalOpen = false;
  let isRewriting = false;
  let rewindAnimationActive = false;
  let rewindOldAgent = null; // Old agent name during rewind
  let rewindNewAgent = null; // New agent name during rewind
  let rewindOldAgentId = null; // Old agent ID for transition message
  let rewindNewAgentId = null; // New agent ID for transition message
  let messageAgentMap = {}; // Map message index to agent ID
  let rewindLoadingProgress = 0; // Loading bar progress (0-100)
  let rewindLoadingDuration = 0; // Total duration in ms
  let rewindLoadingStartTime = 0; // Start time for loading bar
  let typingMessages = {}; // Map message index to displayed text (for typewriter effect)
  let messageTimers = {}; // Store timers for cleanup
  let placeholderMessages = {}; // Map message index to placeholder text (blurry gibberish)
  let placeholderStageTimers = {}; // Timers for cycling placeholder stages
  let placeholderStages = {}; // Current stage for each placeholder

  // Agent definitions with friendly names - Dark Frutiger Aero colors
  const AGENTS = {
    'trust_transparency': {
      id: 'trust_transparency',
      name: 'Trust & Transparency',
      description: 'More honest, grounded dialogue with explicit limitations',
      color: '#8B5CF6' // Purple
    },
    'challenge_pacing': {
      id: 'challenge_pacing',
      name: 'Challenge & Pacing',
      description: 'More gentle pushback and productive friction',
      color: '#EF4444' // Red
    },
    'reflection_coach': {
      id: 'reflection_coach',
      name: 'Reflection Coach',
      description: 'More reflective prompts and self-understanding',
      color: '#A78BFA' // Light purple
    },
    'transfer_to_world': {
      id: 'transfer_to_world',
      name: 'Transfer to World',
      description: 'More concrete actions and independence',
      color: '#F87171' // Light red
    }
  };

  function getLastAgentUsed() {
    if (!debugInfo?.plan?.selected_agents || debugInfo.plan.selected_agents.length === 0) {
      return null;
    }
    return debugInfo.plan.selected_agents[0]; // Get first agent (primary)
  }

  // Auto-scroll to bottom when messages change
  afterUpdate(() => {
    if (chatContainer) {
      chatContainer.scrollTop = chatContainer.scrollHeight;
    }
  });

  onMount(() => {
    // Load persisted state if available
    const saved = localStorage.getItem('mentorai_state');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        conversationState = parsed;
        // Deduplicate messages by content to prevent duplicates
        const history = parsed.history || [];
        const seen = new Set();
        messages = history.filter(m => {
          const key = `${m.role}:${m.content}`;
          if (seen.has(key)) {
            return false; // Duplicate
          }
          seen.add(key);
          return true;
        });
        // Restore agent mapping from last_plan if available
        if (parsed.last_plan?.selected_agents && messages.length > 0) {
          // Find the last assistant message and map it
          for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant') {
              messageAgentMap[i] = parsed.last_plan.selected_agents[0];
              break;
            }
          }
        }
      } catch (e) {
        console.error('Failed to load saved state:', e);
      }
    }
  });

  async function send() {
    const content = input.trim();
    if (!content) return;

    // Add the user message immediately
    messages = [...messages, { role: 'user', content }];

    // Update UI state
    input = '';
    isLoading = true;
    errorMsg = '';
    debugInfo = null;

    try {
      // Send history without placeholder messages
      const historyForAPI = messages.filter(m => !m.isPlaceholder).map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await fetch('/api/mentorai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: historyForAPI,
          state: conversationState
        })
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        errorMsg = data?.error || 'Request failed';
        // Remove placeholder message on error
        const placeholderIndex = messages.findIndex((m, i) => m.isPlaceholder && m.role === 'assistant');
        if (placeholderIndex !== -1) {
          if (placeholderStageTimers[placeholderIndex]) {
            clearInterval(placeholderStageTimers[placeholderIndex]);
            delete placeholderStageTimers[placeholderIndex];
          }
          if (messageTimers[placeholderIndex]) {
            clearInterval(messageTimers[placeholderIndex]);
            delete messageTimers[placeholderIndex];
          }
          delete placeholderMessages[placeholderIndex];
          delete placeholderStages[placeholderIndex];
          delete typingMessages[placeholderIndex];
          messages = messages.filter((m, i) => i !== placeholderIndex);
        }
        isLoading = false;
        return;
      }

      if (data.assistantMessage) {
        const agentId = data.debug?.plan?.selected_agents?.[0] || null;

        // Replace placeholder message with real one
        const placeholderIndex = messages.findIndex((m, i) => m.isPlaceholder && m.role === 'assistant');
        if (placeholderIndex !== -1) {
          // Update placeholder to use agent-specific messages immediately
          if (agentId && placeholderStageTimers[placeholderIndex]) {
            // Update the placeholder to use agent-specific text RIGHT NOW
            placeholderStages = { ...placeholderStages, [placeholderIndex]: 0 };
            typingMessages = { ...typingMessages, [placeholderIndex]: generateAgentPlaceholder(agentId, 0) };

            // Update the interval to use agent-specific placeholders
            clearInterval(placeholderStageTimers[placeholderIndex]);
            placeholderStageTimers[placeholderIndex] = setInterval(() => {
              const currentStage = (placeholderStages[placeholderIndex] || 0) + 1;
              placeholderStages = { ...placeholderStages, [placeholderIndex]: currentStage };
              const newStageMessage = generateAgentPlaceholder(agentId, currentStage);
              typingMessages = { ...typingMessages, [placeholderIndex]: newStageMessage };
            }, 1500);
          }

          // Transition to real text immediately (no delay!)
          // Clear all placeholder animations
          if (placeholderStageTimers[placeholderIndex]) {
            clearInterval(placeholderStageTimers[placeholderIndex]);
            delete placeholderStageTimers[placeholderIndex];
          }
          if (messageTimers[placeholderIndex]) {
            clearInterval(messageTimers[placeholderIndex]);
            delete messageTimers[placeholderIndex];
          }
          delete placeholderMessages[placeholderIndex];
          delete placeholderStages[placeholderIndex];
          delete typingMessages[placeholderIndex];

          // Replace with real message - use array update to trigger reactivity
          messages = messages.map((m, idx) => {
            if (idx === placeholderIndex) {
              return { role: 'assistant', content: data.assistantMessage, agentId };
            }
            return m;
          });
          messageAgentMap[placeholderIndex] = agentId;

          // Force reactivity update
          messages = messages;

          // Start typewriter effect immediately
          startRealTextTyping(placeholderIndex, data.assistantMessage, 15);
        } else {
          // Fallback: add new message
          const newMessage = { role: 'assistant', content: data.assistantMessage, agentId };
          messages = [...messages, newMessage];
          const messageIndex = messages.length - 1;
          messageAgentMap[messageIndex] = agentId;
          setTimeout(() => {
            startTypewriterEffect(messageIndex, data.assistantMessage, 15, true);
          }, 100);
        }

        debugInfo = data.debug || null;
        conversationState = data.state || null;

        // Sync messages with conversationState.history AFTER a brief delay to ensure UI updates
        // This prevents overwriting the message we just replaced
        setTimeout(() => {
          if (conversationState?.history) {
            // Create a map of existing messages with their agentIds
            const agentIdMap = new Map();
            messages.forEach((m, idx) => {
              if (m.agentId) {
                // Use content as key to match messages
                agentIdMap.set(m.content, m.agentId);
              }
            });

            // Deduplicate history and rebuild messages, preserving agentId info
            const seen = new Set();
            const syncedMessages = conversationState.history.filter((h, idx) => {
              const key = `${h.role}:${h.content}`;
              if (seen.has(key)) {
                return false; // Duplicate
              }
              seen.add(key);
              return true;
            }).map((h, idx) => {
              const preservedAgentId = agentIdMap.get(h.content) ||
                (idx === conversationState.history.length - 1 && h.role === 'assistant' ? agentId : null);
              return {
                role: h.role,
                content: h.content,
                agentId: preservedAgentId,
                timestamp: h.timestamp
              };
            });

            // Only sync if the message count matches (to avoid overwriting during typewriter)
            if (syncedMessages.length === messages.length || syncedMessages.length === messages.length - 1) {
              messages = syncedMessages;

              // Update agent map for all assistant messages
              messages.forEach((m, idx) => {
                if (m.role === 'assistant' && m.agentId) {
                  messageAgentMap[idx] = m.agentId;
                }
              });
            }
          }
        }, 500);

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
    // Clear all timers
    Object.values(messageTimers).forEach(timer => clearInterval(timer));
    Object.values(placeholderStageTimers).forEach(timer => clearInterval(timer));
    messageTimers = {};
    placeholderStageTimers = {};
    typingMessages = {};
    placeholderMessages = {};
    placeholderStages = {};
    messages = [];
    messageAgentMap = {};
    debugInfo = null;
    conversationState = null;
    rewindModalOpen = false;
    localStorage.removeItem('mentorai_state');
  }

  function openRewindModal() {
    // Check if there's a last assistant message to rewrite
    const hasAssistantMessage = messages.some(m => m.role === 'assistant');
    if (!hasAssistantMessage) {
      errorMsg = 'No assistant message to rewrite';
      return;
    }
    rewindModalOpen = true;
  }

  function closeRewindModal() {
    rewindModalOpen = false;
  }

  async function rewriteWithAgent(selectedAgentId) {
    // Sync messages with conversationState before rewriting
    // Convert messages to state format (remove agentId from history)
    if (conversationState) {
      conversationState.history = messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp || Date.now()
      }));
    } else {
      errorMsg = 'No conversation state available';
      return;
    }

    // Find the last assistant message index for animation
    const lastAssistantIndex = messages.map((m, i) => ({ m, i }))
      .filter(({ m }) => m.role === 'assistant')
      .slice(-1)[0]?.i;

    // Get old and new agent info
    const oldAgentId = getAgentForMessage(lastAssistantIndex);
    const newAgentId = selectedAgentId;
    rewindOldAgent = oldAgentId ? AGENTS[oldAgentId]?.name : 'Previous Agent';
    rewindNewAgent = AGENTS[newAgentId]?.name || 'New Agent';
    rewindOldAgentId = oldAgentId;
    rewindNewAgentId = newAgentId;

    // Close modal and start animation
    rewindModalOpen = false;
    errorMsg = '';
    isRewriting = false; // Start with arrow pointing at old agent
    rewindLoadingProgress = 0; // Reset loading bar

    // Random loading duration between 18-24 seconds
    rewindLoadingDuration = Math.random() * 6000 + 18000; // 18000-24000ms
    rewindLoadingStartTime = Date.now();

    // Trigger rewind animation with agent info
    let loadingInterval = null;
    let finishInterval = null;
    if (lastAssistantIndex !== undefined) {
      rewindAnimationActive = true;

      // Start loading bar animation
      loadingInterval = setInterval(() => {
        const elapsed = Date.now() - rewindLoadingStartTime;
        const progress = Math.min((elapsed / rewindLoadingDuration) * 100, 100);
        rewindLoadingProgress = progress;

        if (progress >= 100) {
          clearInterval(loadingInterval);
          loadingInterval = null;
        }
      }, 16); // Update ~60fps

      // Start arrow rotation after overlay appears (small delay for smooth transition)
      // The arrow will rotate over the loading duration
      setTimeout(() => {
        isRewriting = true; // This triggers the arrow rotation to new agent
      }, 300);
    } else {
      isRewriting = true;
    }

    try {
      console.log('Rewriting with agent:', selectedAgentId);
      console.log('State history length:', conversationState.history?.length);
      console.log('State:', JSON.stringify(conversationState, null, 2));

      // Start API call in parallel with animation
      const res = await fetch('/api/mentorai/rewrite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: conversationState,
          selectedAgentId
        })
      });

      const data = await res.json();
      console.log('Rewrite response:', data);

      // Don't wait - let the arrow continue rotating until we're ready to show the result
      // The overlay will fade out when we update the message

      if (!res.ok || data?.error) {
        errorMsg = data?.error || data?.details || 'Rewrite failed';
        console.error('Rewrite error:', data);
        rewindAnimationActive = false;
        isRewriting = false;
        rewindLoadingProgress = 0;
        return;
      }

      if (data.assistantMessage) {
        // Replace the last assistant message
        const newMessages = [...messages];
        const lastAssistantIndex = newMessages.map((m, i) => ({ m, i }))
          .filter(({ m }) => m.role === 'assistant')
          .slice(-1)[0]?.i;

        if (lastAssistantIndex !== undefined) {
          // Clear any existing typing state
          if (messageTimers[lastAssistantIndex]) {
            clearInterval(messageTimers[lastAssistantIndex]);
            delete messageTimers[lastAssistantIndex];
          }
          delete typingMessages[lastAssistantIndex];
          delete placeholderMessages[lastAssistantIndex];

          const newMessage = {
            role: 'assistant',
            content: data.assistantMessage,
            agentId: selectedAgentId
          };
          newMessages[lastAssistantIndex] = newMessage;
          // Update agent map
          messageAgentMap[lastAssistantIndex] = selectedAgentId;
          messages = newMessages;

          // Start typewriter effect for rewritten message (no blurry placeholder)
          setTimeout(() => {
            startRealTextTyping(lastAssistantIndex, data.assistantMessage, 15);
          }, 100); // Small delay after rewind animation
        } else {
          // Fallback: just add it
          const newMessage = { role: 'assistant', content: data.assistantMessage, agentId: selectedAgentId };
          messages = [...messages, newMessage];
          const messageIndex = messages.length - 1;
          messageAgentMap[messageIndex] = selectedAgentId;
          // Start typewriter effect with placeholder
          setTimeout(() => {
            startTypewriterEffect(messageIndex, data.assistantMessage, 15, true);
          }, 100);
        }

        debugInfo = data.debug || null;
        conversationState = data.state || null;

        // Persist state
        if (conversationState) {
          localStorage.setItem('mentorai_state', JSON.stringify(conversationState));
        }
      } else {
        errorMsg = 'No assistant message in response';
        console.error('No assistantMessage in response:', data);
      }
    } catch (err) {
      errorMsg = 'Network error: ' + err.message;
      console.error('Rewrite exception:', err);
    } finally {
      // Clean up loading interval if still running
      if (loadingInterval) {
        clearInterval(loadingInterval);
        loadingInterval = null;
      }

      // Wait for loading bar to complete before hiding overlay
      const elapsed = Date.now() - rewindLoadingStartTime;
      const remainingTime = Math.max(0, rewindLoadingDuration - elapsed);

      if (remainingTime > 0) {
        // Continue loading bar until it reaches 100%
        finishInterval = setInterval(() => {
          const currentElapsed = Date.now() - rewindLoadingStartTime;
          const progress = Math.min((currentElapsed / rewindLoadingDuration) * 100, 100);
          rewindLoadingProgress = progress;

          if (progress >= 100) {
            clearInterval(finishInterval);
            finishInterval = null;
          }
        }, 16);

        // Wait for loading to complete
        await new Promise(resolve => setTimeout(resolve, remainingTime + 200));
        if (finishInterval) {
          clearInterval(finishInterval);
          finishInterval = null;
        }
      } else {
        // Ensure loading bar is at 100%
        rewindLoadingProgress = 100;
        await new Promise(resolve => setTimeout(resolve, 200));
      }

      isRewriting = false;
      rewindAnimationActive = false;
      rewindOldAgent = null;
      rewindNewAgent = null;
      rewindOldAgentId = null;
      rewindNewAgentId = null;
      rewindLoadingProgress = 0;
      rewindLoadingStartTime = 0;
    }
  }

  function getAgentForMessage(index) {
    return messageAgentMap[index] || messages[index]?.agentId || null;
  }

  function getMessageColor(agentId) {
    if (!agentId) return null;
    return AGENTS[agentId]?.color || null;
  }

  // Get transition message for switching between agents
  function getTransitionMessage(oldAgentId, newAgentId) {
    const transitions = {
      'trust_transparency': {
        'challenge_pacing': 'Let\'s switch it up. Challenge & Pacing would be better because Trust & Transparency might be too cautious.',
        'reflection_coach': 'Let\'s switch it up. Reflection Coach would be better because Trust & Transparency might be too direct.',
        'transfer_to_world': 'Let\'s switch it up. Transfer to World would be better because Trust & Transparency might be too theoretical.'
      },
      'challenge_pacing': {
        'trust_transparency': 'Let\'s switch it up. Trust & Transparency would be better because Challenge & Pacing might be too pushy.',
        'reflection_coach': 'Let\'s switch it up. Reflection Coach would be better because Challenge & Pacing might be too confrontational.',
        'transfer_to_world': 'Let\'s switch it up. Transfer to World would be better because Challenge & Pacing might be too focused on friction.'
      },
      'reflection_coach': {
        'trust_transparency': 'Let\'s switch it up. Trust & Transparency would be better because Reflection Coach might be too introspective.',
        'challenge_pacing': 'Let\'s switch it up. Challenge & Pacing would be better because Reflection Coach might be too passive.',
        'transfer_to_world': 'Let\'s switch it up. Transfer to World would be better because Reflection Coach might be too abstract.'
      },
      'transfer_to_world': {
        'trust_transparency': 'Let\'s switch it up. Trust & Transparency would be better because Transfer to World might be too action-focused.',
        'challenge_pacing': 'Let\'s switch it up. Challenge & Pacing would be better because Transfer to World might be too solution-oriented.',
        'reflection_coach': 'Let\'s switch it up. Reflection Coach would be better because Transfer to World might be too practical.'
      }
    };

    if (!oldAgentId || !newAgentId) {
      return 'Let\'s switch it up. A fresh perspective might help.';
    }

    return transitions[oldAgentId]?.[newAgentId] || 'Let\'s switch it up. A different approach might be what you need.';
  }

  // Generate agent-specific placeholder text that cycles through stages
  function generateAgentPlaceholder(agentId, stage = 0) {
    const placeholders = {
      'trust_transparency': [
        'Being transparent about transparency...',
        'Honestly, I\'m thinking about what to say honestly...',
        'Let me be clear about my limitations...',
        'Here\'s what I can confidently not say yet...',
        'Processing with full disclosure...',
        'Transparently processing transparency...'
      ],
      'challenge_pacing': [
        'Gently preparing to challenge you gently...',
        'Finding the right amount of productive friction...',
        'Calibrating pushback intensity...',
        'Measuring discomfort-to-growth ratio...',
        'Preparing a thoughtful counterpoint...',
        'Balancing challenge with care...'
      ],
      'reflection_coach': [
        'Reflecting on reflection...',
        'Thinking about how you\'re thinking...',
        'Contemplating contemplation...',
        'Digging deeper into depth...',
        'Preparing a mirror for your thoughts...',
        'Reflecting on reflecting on reflection...'
      ],
      'transfer_to_world': [
        'Connecting thoughts to actions...',
        'Bridging ideas to reality...',
        'Translating insight to practice...',
        'Making the abstract concrete...',
        'Preparing actionable wisdom...',
        'Grounding concepts in the world...'
      ]
    };

    const defaultPlaceholders = [
      'Processing your message...',
      'Thinking deeply...',
      'Crafting a response...',
      'Considering carefully...',
      'Formulating thoughts...',
      'Engaging with your words...'
    ];

    const agentPlaceholders = agentId ? placeholders[agentId] : defaultPlaceholders;
    if (!agentPlaceholders) return defaultPlaceholders[0];

    return agentPlaceholders[stage % agentPlaceholders.length];
  }

  // Generate blurry placeholder text (lorem ipsum style gibberish for visual effect)
  function generateBlurryPlaceholder(length) {
    const words = [
      'lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing',
      'elit', 'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore',
      'et', 'dolore', 'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam',
      'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip'
    ];

    let text = '';
    let wordCount = Math.ceil(length / 6);

    for (let i = 0; i < wordCount; i++) {
      const word = words[Math.floor(Math.random() * words.length)];
      text += (i > 0 ? ' ' : '') + word;
      if (text.length >= length) break;
    }

    return text.substring(0, length);
  }

  // Start animated placeholder that cycles through agent-specific messages
  function startAnimatedPlaceholder(messageIndex, agentId = null) {
    // Clear any existing stage timer
    if (placeholderStageTimers[messageIndex]) {
      clearInterval(placeholderStageTimers[messageIndex]);
    }

    placeholderStages = { ...placeholderStages, [messageIndex]: 0 };

    // Start with first stage message IMMEDIATELY - no delay!
    const stageMessage = generateAgentPlaceholder(agentId, 0);
    typingMessages = { ...typingMessages, [messageIndex]: stageMessage };

    // Cycle through stages every 1.2 seconds (faster for more activity)
    placeholderStageTimers[messageIndex] = setInterval(() => {
      const currentStage = (placeholderStages[messageIndex] || 0) + 1;
      placeholderStages = { ...placeholderStages, [messageIndex]: currentStage };
      const newStageMessage = generateAgentPlaceholder(agentId, currentStage);

      // Smooth transition: fade out old, fade in new - trigger reactivity
      typingMessages = { ...typingMessages, [messageIndex]: newStageMessage };
    }, 1200); // Faster cycling for more visual activity
  }

  // Typewriter effect for messages
  function startTypewriterEffect(messageIndex, fullText, speed = 20, usePlaceholder = true) {
    // Clear any existing timer for this message
    if (messageTimers[messageIndex]) {
      clearInterval(messageTimers[messageIndex]);
    }

    // Start with blurry placeholder if requested
    if (usePlaceholder && fullText.length > 0) {
      const placeholderLength = Math.max(fullText.length, 100);
      placeholderMessages[messageIndex] = generateBlurryPlaceholder(placeholderLength);

      // Type out placeholder first (faster, blurry)
      let placeholderIndex = 0;
      const placeholderChars = placeholderMessages[messageIndex].split('');

      const placeholderTimer = setInterval(() => {
        if (placeholderIndex < placeholderChars.length) {
          // Trigger reactivity
          typingMessages = { ...typingMessages, [messageIndex]: placeholderChars.slice(0, placeholderIndex + 1).join('') };
          placeholderIndex++;
        } else {
          clearInterval(placeholderTimer);
          // Now switch to real text
          startRealTextTyping(messageIndex, fullText, speed);
        }
      }, speed * 0.5);

      messageTimers[messageIndex] = placeholderTimer;
    } else {
      // Direct to real text
      startRealTextTyping(messageIndex, fullText, speed);
    }
  }

  // Type out the real text
  function startRealTextTyping(messageIndex, fullText, speed) {
    // Clear placeholder animations
    if (placeholderStageTimers[messageIndex]) {
      clearInterval(placeholderStageTimers[messageIndex]);
      delete placeholderStageTimers[messageIndex];
    }
    delete placeholderMessages[messageIndex];
    delete placeholderStages[messageIndex];

    // Start typing real text - trigger reactivity immediately
    typingMessages = { ...typingMessages };
    typingMessages[messageIndex] = '';
    typingMessages = { ...typingMessages };

    let currentIndex = 0;
    const chars = fullText.split('');

    // Clear old timer if exists
    if (messageTimers[messageIndex]) {
      clearInterval(messageTimers[messageIndex]);
    }

    // Start with first character immediately
    if (chars.length > 0) {
      typingMessages = { ...typingMessages, [messageIndex]: chars[0] };
      currentIndex = 1;
    }

    messageTimers[messageIndex] = setInterval(() => {
      if (currentIndex < chars.length) {
        // Update typingMessages with new object to trigger reactivity
        typingMessages = { ...typingMessages, [messageIndex]: chars.slice(0, currentIndex + 1).join('') };
        currentIndex++;
      } else {
        // Typing complete
        clearInterval(messageTimers[messageIndex]);
        delete messageTimers[messageIndex];
        // Ensure full text is shown - trigger reactivity
        typingMessages = { ...typingMessages, [messageIndex]: fullText };
      }
    }, speed);
  }

  // Cleanup timers on component destroy
  onDestroy(() => {
    Object.values(messageTimers).forEach(timer => clearInterval(timer));
    Object.values(placeholderStageTimers).forEach(timer => clearInterval(timer));
  });
</script>

<style>
  :global(:root) {
    /* Dark Frutiger Aero Color Palette - Purple, Red, Black */
    --dark-purple: #6B46C1;
    --purple: #8B5CF6;
    --light-purple: #A78BFA;
    --dark-red: #DC2626;
    --red: #EF4444;
    --light-red: #F87171;
    --black: #0A0A0A;
    --dark-gray: #1A1A1A;
    --gray: #2D2D2D;
    --bg: linear-gradient(135deg, #0A0A0A 0%, #1A0A1A 25%, #2D0A2D 50%, #1A0A0A 75%, #0A0A0A 100%);
    --card: rgba(26, 26, 26, 0.85);
    --card-muted: rgba(26, 26, 26, 0.6);
    --border: rgba(139, 92, 246, 0.4);
    --text: #E5E5E5;
    --muted: #A3A3A3;
    --primary: #8B5CF6;
    --primary-600: #6B46C1;
    --shadow-soft: 0 8px 32px rgba(139, 92, 246, 0.2);
    --shadow-medium: 0 12px 40px rgba(220, 38, 38, 0.3);
  }

  :global(html, body) {
    height: 100%;
    margin: 0;
    padding: 0;
    background:
      radial-gradient(circle at 20% 30%, rgba(220, 38, 38, 0.2) 0%, transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(139, 92, 246, 0.3) 0%, transparent 50%),
      radial-gradient(circle at 50% 50%, rgba(107, 70, 193, 0.15) 0%, transparent 70%),
      linear-gradient(135deg, #0A0A0A 0%, #1A0A1A 25%, #2D0A2D 50%, #1A0A0A 75%, #0A0A0A 100%);
    background-attachment: fixed;
    color: var(--text);
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    overflow: hidden;
  }

  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }

  .container {
    max-width: 100%;
    width: 100%;
    height: 100vh;
    margin: 0;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  h1 {
    color: var(--text);
    letter-spacing: 0.3px;
    margin: 0 0 0.5rem 0;
    font-weight: 600;
    font-size: 1.75rem;
    text-shadow: 0 2px 8px rgba(135, 206, 235, 0.3);
  }
  .subtle {
    color: var(--muted);
    font-size: 0.9rem;
    margin-bottom: 0.75rem;
    font-weight: 300;
  }

  .row { display: flex; gap: 0.75rem; align-items: center; }

  .input-row {
    gap: 0.5rem;
  }

  .chat {
    border-radius: 24px;
    padding: 1.5rem;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: var(--card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border: 2px solid var(--border);
    box-shadow: var(--shadow-soft);
    -webkit-overflow-scrolling: touch;
    margin-bottom: 1rem;
    scroll-behavior: smooth;
  }
  .flexcol { display: flex; flex-direction: column; gap: 0.75rem; }
  .bubble {
    padding: 1rem 1.25rem;
    border-radius: 20px;
    margin: 0.5rem 0;
    max-width: 80%;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: break-word;
    line-height: 1.6;
    transition: all 0.3s ease;
    position: relative;
    overflow: visible;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 16px rgba(139, 92, 246, 0.2);
    color: var(--text);
  }

  .bubble.user {
    background: linear-gradient(135deg, rgba(220, 38, 38, 0.3) 0%, rgba(239, 68, 68, 0.25) 100%);
    border: 2px solid rgba(220, 38, 38, 0.5);
    margin-left: auto;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    font-weight: 400;
    color: #FFE5E5;
  }

  .bubble.assistant {
    background: linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(107, 70, 193, 0.2) 100%);
    border: 2px solid rgba(139, 92, 246, 0.4);
    margin-right: auto;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    font-weight: 400;
    color: var(--text);
  }

  /* Polaroid reveal effect */
  .bubble.revealing {
    animation: polaroidReveal 0.8s ease-out forwards;
  }

  @keyframes polaroidReveal {
    0% {
      opacity: 0;
      transform: scale(0.95) translateY(10px);
      filter: brightness(0.5) contrast(0.5);
    }
    50% {
      opacity: 0.7;
      transform: scale(1.02) translateY(-2px);
      filter: brightness(0.8) contrast(0.8);
    }
    100% {
      opacity: 1;
      transform: scale(1) translateY(0);
      filter: brightness(1) contrast(1);
    }
  }

  /* Typewriter cursor effect */
  .typewriter-text::after {
    content: '▊';
    animation: blinkCursor 1s infinite;
    color: currentColor;
    opacity: 0.7;
  }

  .typewriter-text.complete::after {
    display: none;
  }

  @keyframes blinkCursor {
    0%, 50% { opacity: 0.7; }
    51%, 100% { opacity: 0; }
  }

  /* Blurry placeholder text */
  .typewriter-text.blurry {
    filter: blur(4px);
    opacity: 0.6;
    color: rgba(0, 0, 0, 0.4);
    user-select: none;
    transition: filter 0.3s ease, opacity 0.3s ease, color 0.3s ease;
  }

  .typewriter-text:not(.blurry) {
    filter: blur(0);
    opacity: 1;
    color: inherit;
  }

  /* Animated placeholder text (agent-specific messages) */
  .typewriter-text.animated-placeholder {
    font-style: italic;
    opacity: 0.85;
    transition: opacity 0.4s ease;
    animation: subtlePulse 2s ease-in-out infinite;
  }

  @keyframes subtlePulse {
    0%, 100% { opacity: 0.85; }
    50% { opacity: 0.95; }
  }

  /* Active placeholder bubble animation */
  .bubble.active-placeholder {
    animation: placeholderGlow 2s ease-in-out infinite;
    border-left-width: 4px;
    border-left-style: solid;
    border-left-color: rgba(37, 99, 235, 0.5);
  }

  @keyframes placeholderGlow {
    0%, 100% {
      box-shadow: 0 2px 8px rgba(37, 99, 235, 0.1);
      border-left-color: rgba(37, 99, 235, 0.3);
    }
    50% {
      box-shadow: 0 4px 16px rgba(37, 99, 235, 0.2);
      border-left-color: rgba(37, 99, 235, 0.6);
    }
  }

  .user {
    background: #e8f0ff;
    color: #0b1a3a;
    align-self: flex-end;
    border: 1px solid #c7d2fe;
  }
  .assistant {
    background: #f5f7fb;
    color: #0f172a;
    align-self: flex-start;
    border: 1px solid #e5e7eb;
  }
  .bubble:hover { outline: 2px solid transparent; box-shadow: 0 1px 0 rgba(2,6,23,0.04); }

  /* Agent color coding - Dark Frutiger Aero style */
  .bubble.agent-trust {
    border-left: 5px solid var(--purple);
    background: linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(139, 92, 246, 0.3) 100%);
    border-color: rgba(139, 92, 246, 0.5);
    color: var(--text);
  }
  .bubble.agent-challenge {
    border-left: 5px solid var(--red);
    background: linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(220, 38, 38, 0.25) 100%);
    border-color: rgba(220, 38, 38, 0.5);
    color: #FFE5E5;
  }
  .bubble.agent-reflection {
    border-left: 5px solid var(--light-purple);
    background: linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(167, 139, 250, 0.25) 100%);
    border-color: rgba(167, 139, 250, 0.5);
    color: var(--text);
  }
  .bubble.agent-transfer {
    border-left: 5px solid var(--light-red);
    background: linear-gradient(135deg, rgba(26, 26, 26, 0.95) 0%, rgba(248, 113, 113, 0.25) 100%);
    border-color: rgba(248, 113, 113, 0.5);
    color: #FFE5E5;
  }

  /* Rewind animation */
  .bubble.rewinding {
    animation: explodeAndRewind 1s ease-out forwards;
    z-index: 100;
  }

  @keyframes explodeAndRewind {
    0% {
      transform: scale(1);
      opacity: 1;
    }
    30% {
      transform: scale(1.2) rotate(5deg);
      opacity: 0.9;
    }
    60% {
      transform: scale(0.8) rotate(-5deg);
      opacity: 0.7;
    }
    100% {
      transform: scale(0) rotate(360deg);
      opacity: 0;
    }
  }

  .rewind-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.85);
    z-index: 999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    animation: rewindFadeIn 0.3s ease-out forwards;
  }

  .rewind-loading-bar-container {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 64px; /* 4x thicker than before (was 16px, originally 4px) */
    background: rgba(255, 255, 255, 0.1);
    overflow: hidden;
  }

  .rewind-loading-bar {
    height: 100%;
    background: linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899);
    transition: width 0.1s linear;
    box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
  }

  @keyframes rewindFadeIn {
    0% {
      opacity: 0;
    }
    100% {
      opacity: 1;
    }
  }

  .rewind-content {
    display: flex;
    align-items: center;
    gap: 3rem;
    max-width: 800px;
    width: 100%;
    padding: 2rem;
    padding-top: 10rem; /* Lower everything down */
  }

  .rewind-agent {
    flex: 1;
    text-align: center;
    color: rgba(255, 255, 255, 0.9);
  }

  .rewind-agent-name {
    font-size: 1.5rem;
    font-weight: 600;
    margin-bottom: 0.5rem;
    opacity: 0.7;
    transition: opacity 0.5s ease;
  }

  .rewind-agent-name.active {
    opacity: 1;
    font-size: 1.75rem;
  }

  .rewind-arrow-container {
    position: relative;
    width: 120px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 3rem; /* Space between text and arrow */
  }

  .rewind-arrow-wrapper {
    width: 80px;
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  .rewind-spinner {
    position: absolute;
    top: 32px; /* Center of loading bar (64px / 2 = 32px) */
    left: 50%;
    margin-left: -1.25rem; /* Center horizontally (half of font-size) */
    margin-top: -1.25rem; /* Center vertically (half of font-size) */
    font-size: 2.5rem;
    color: rgba(255, 255, 255, 0.6);
    animation: spin 2s linear infinite;
    z-index: 1000;
    width: 2.5rem;
    height: 2.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }

  .rewind-arrow {
    font-size: 4rem;
    color: rgba(255, 255, 255, 0.9);
    transform: rotate(0deg);
    transform-origin: 50% 50%; /* Rotate around exact center */
    transition: transform ease-in-out; /* Duration set dynamically via inline style */
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1em;
    height: 1em;
    line-height: 1;
    position: relative;
    z-index: 2;
  }

  .rewind-arrow.rotated {
    transform: rotate(180deg);
  }

  .rewind-transition-message {
    font-size: 1rem;
    color: rgba(255, 255, 255, 0.8);
    text-align: center;
    max-width: 400px;
    line-height: 1.5;
    font-style: italic;
    opacity: 0;
    animation: messageFadeIn 0.5s ease-out 0.5s forwards;
  }

  @keyframes messageFadeIn {
    0% {
      opacity: 0;
      transform: translateY(10px);
    }
    100% {
      opacity: 0.8;
      transform: translateY(0);
    }
  }

  .rewind-overlay.fade-out {
    animation: rewindFadeOut 0.5s ease-out forwards;
  }

  @keyframes rewindFadeOut {
    0% {
      opacity: 1;
    }
    100% {
      opacity: 0;
    }
  }
  .meta { color: var(--muted); font-size: 0.8rem; margin-bottom: 0.15rem; }

  .toolbar { display: flex; gap: 1rem; align-items: center; justify-content: space-between; margin: 0 0 0.5rem 0; flex-shrink: 0; }

  .frutiger-input {
    flex: 1;
    padding: 0.9rem 1.2rem;
    border-radius: 20px;
    border: 2px solid var(--border);
    background: var(--card);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    outline: none;
    transition: all 0.3s ease;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    color: var(--text);
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.2);
  }

  .frutiger-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 4px rgba(139, 92, 246, 0.3), 0 4px 16px rgba(139, 92, 246, 0.3);
    transform: translateY(-1px);
  }

  .frutiger-input::placeholder {
    color: var(--muted);
    opacity: 0.6;
  }

  .send-button {
    padding: 0.9rem 1.8rem;
    border: none;
    border-radius: 20px;
    background: linear-gradient(135deg, var(--primary) 0%, var(--dark-purple) 100%);
    color: white;
    cursor: pointer;
    font-weight: 600;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    box-shadow: 0 4px 16px rgba(139, 92, 246, 0.4);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .send-button:hover:not(:disabled) {
    background: linear-gradient(135deg, var(--primary-600) 0%, var(--primary) 100%);
    box-shadow: 0 6px 20px rgba(139, 92, 246, 0.5);
    transform: translateY(-2px);
  }

  .send-button:active:not(:disabled) {
    transform: translateY(0);
  }

  .send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .rewind-button {
    padding: 0.9rem 1.5rem;
    border: 2px solid var(--red);
    border-radius: 20px;
    background: linear-gradient(135deg, rgba(220, 38, 38, 0.8) 0%, rgba(239, 68, 68, 0.7) 100%);
    color: #FFE5E5;
    cursor: pointer;
    font-weight: 600;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    box-shadow: 0 4px 16px rgba(220, 38, 38, 0.4);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
  }

  .rewind-button:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(220, 38, 38, 1) 0%, rgba(239, 68, 68, 0.9) 100%);
    box-shadow: 0 6px 20px rgba(220, 38, 38, 0.5);
    transform: translateY(-2px) scale(1.02);
    border-color: var(--light-red);
  }

  .rewind-button:active:not(:disabled) {
    transform: translateY(0) scale(1);
  }

  .rewind-button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  :global(button.secondary) {
    padding: 0.7rem 1.2rem;
    border: 2px solid var(--border);
    border-radius: 18px;
    background: var(--card);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    color: var(--text);
    cursor: pointer;
    font-weight: 500;
    font-family: 'Comfortaa', sans-serif;
    box-shadow: 0 2px 8px rgba(135, 206, 235, 0.15);
    transition: all 0.3s ease;
  }

  :global(button.secondary:hover) {
    background: var(--card-muted);
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
    transform: translateY(-1px);
  }

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
    background: linear-gradient(135deg, rgba(220, 38, 38, 0.3) 0%, rgba(239, 68, 68, 0.25) 100%);
    color: #FFE5E5;
    border: 2px solid var(--red);
    padding: 1rem 1.25rem;
    border-radius: 20px;
    margin: 0.5rem 0 0.75rem 0;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 4px 16px rgba(220, 38, 38, 0.3);
  }

  .typing { display: inline-flex; gap: 8px; align-items: center; }
  .dot {
    width: 10px;
    height: 10px;
    background: var(--primary);
    border-radius: 50%;
    animation: blink 1.4s infinite both;
    box-shadow: 0 2px 4px rgba(139, 92, 246, 0.3);
  }
  .dot:nth-child(2) { animation-delay: .2s; background: var(--purple); }
  .dot:nth-child(3) { animation-delay: .4s; background: var(--red); }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal {
    background: var(--card);
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
    border-radius: 24px;
    padding: 2rem;
    max-width: 600px;
    width: 100%;
    box-shadow: var(--shadow-medium);
    border: 2px solid var(--border);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .modal-title {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
  }

  .modal-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--muted);
    padding: 0;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
  }

  .modal-close:hover {
    background: var(--card-muted);
    color: var(--text);
  }

  .agent-info {
    background: var(--card-muted);
    padding: 0.75rem;
    border-radius: 8px;
    margin-bottom: 1rem;
    border-left: 3px solid var(--primary);
  }

  .agent-info-label {
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 0.25rem;
  }

  .agent-info-value {
    font-weight: 600;
    color: var(--text);
  }

  .agent-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .agent-card {
    padding: 1.25rem;
    border: 2px solid var(--border);
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.3s ease;
    background: var(--card);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    box-shadow: 0 2px 8px rgba(135, 206, 235, 0.15);
  }

  .agent-card:hover {
    border-color: var(--primary);
    box-shadow: 0 6px 20px rgba(139, 92, 246, 0.4);
    transform: translateY(-3px) scale(1.02);
  }

  .agent-card.selected {
    border-color: var(--primary);
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(107, 70, 193, 0.15) 100%);
    box-shadow: 0 4px 16px rgba(139, 92, 246, 0.3);
  }

  .agent-card-name {
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--text);
  }

  .agent-card-description {
    font-size: 0.85rem;
    color: var(--muted);
    line-height: 1.4;
  }

  .agent-card-indicator {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    margin-right: 0.5rem;
  }

  .header-section {
    flex-shrink: 0;
    margin-bottom: 0.5rem;
  }

  @media (max-width: 640px) {
    .bubble { max-width: 92%; }
    .toolbar { gap: 0.5rem; }
    .container { padding: 0.75rem; }
    .agent-grid {
      grid-template-columns: 1fr;
    }
    h1 { font-size: 1.25rem; }
  }
</style>

<div class="container">
  <div class="header-section">
    <h1>MentorAI</h1>
    <div class="toolbar">
      <button class="secondary" on:click={clearConversation}>Clear</button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error" role="alert" style="flex-shrink: 0; margin-bottom: 0.5rem;">
      {errorMsg}
    </div>
  {/if}

  <div class="chat flexcol" bind:this={chatContainer}>
    {#each messages as m, i}
      {@const agentId = getAgentForMessage(i)}
      {@const agentClass = agentId ? `agent-${agentId.split('_')[0]}` : ''}
      {@const isRewinding = rewindAnimationActive && i === messages.length - 1 && m.role === 'assistant'}
      {@const isTyping = typingMessages[i] !== undefined && typingMessages[i] !== m.content}
      {@const hasBlurryPlaceholder = placeholderMessages[i] !== undefined}
      {@const isAnimatedPlaceholder = m.isPlaceholder && typingMessages[i] && !placeholderMessages[i]}
      {@const displayText = typingMessages[i] !== undefined ? typingMessages[i] : m.content}
      {@const isRevealing = m.role === 'assistant' && (i === messages.length - 1 || isTyping)}
      {@const isBlurry = hasBlurryPlaceholder && isTyping}
      <div
        class="bubble {m.role} {agentClass}"
        class:rewinding={isRewinding}
        class:revealing={isRevealing && !isRewinding}
        class:active-placeholder={m.isPlaceholder}
        style={agentId && getMessageColor(agentId) ? `border-left-color: ${getMessageColor(agentId)};` : ''}
      >
        <div class="meta">
          {m.role}
          {#if agentId && AGENTS[agentId]}
            <span style="margin-left: 0.5rem; font-size: 0.7rem; opacity: 0.7;">
              ({AGENTS[agentId].name})
            </span>
          {/if}
        </div>
        <div
          class="typewriter-text"
          class:complete={!isTyping}
          class:blurry={isBlurry}
          class:animated-placeholder={isAnimatedPlaceholder}
        >
          {displayText}
        </div>
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

  <div class="row input-row" style="margin-top: 0; flex-shrink: 0;">
    <input
      type="text"
      placeholder="Type a message..."
      bind:value={input}
      on:keydown={(e) => e.key === 'Enter' && send()}
      class="frutiger-input"
      disabled={isLoading || isRewriting}
    />
    <button
      class="rewind-button"
      on:click={openRewindModal}
      disabled={isLoading || isRewriting || !messages.some(m => m.role === 'assistant')}
      title="Rewind and rewrite last response with different agent"
    >
      ⏪ Rewind
    </button>
    <button class="send-button" on:click={send} disabled={isLoading || isRewriting}>Send</button>
  </div>
</div>

{#if debugOpen && debugInfo}
  <div style="max-width: 960px; margin: 0 auto; padding: 0 1rem;">
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
          <div style="margin-bottom: 0.5rem;">
            <strong>All {debugInfo.agent_responses.length} Agent Responses Generated in Parallel:</strong>
            <div style="font-size: 0.85em; color: #666; margin-top: 0.25rem;">
              ✓ All personas responded, but only
              <strong style="color: #4CAF50;">{debugInfo.plan?.selected_agent_id || 'one'}</strong>
              is shown to the user
            </div>
          </div>
          {#each debugInfo.agent_responses as response}
            <div style="margin-top: 0.5rem; padding: 0.5rem; background: {response.is_selected ? '#e8f5e9' : '#f5f5f5'}; border-radius: 4px; border-left: 3px solid {response.is_selected ? '#4CAF50' : '#ccc'};">
              <strong style="color: {response.is_selected ? '#4CAF50' : '#333'};">
                {response.agent} {response.is_selected ? '← SELECTED (shown to user)' : '(generated but hidden)'}
              </strong>
              <div style="margin-top: 0.25rem; font-size: 0.9em; color: #555;">
                {response.full_text || response.draft}
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if rewindModalOpen}
  <div class="modal-overlay" on:click={() => !isRewriting && closeRewindModal()} on:keydown={(e) => e.key === 'Escape' && !isRewriting && closeRewindModal()}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">Rewind & Rewrite Response</div>
        <button class="modal-close" on:click={() => !isRewriting && closeRewindModal()} disabled={isRewriting}>×</button>
      </div>

      {#if getLastAgentUsed()}
        <div class="agent-info">
          <div class="agent-info-label">Last response used:</div>
          <div class="agent-info-value">
            {AGENTS[getLastAgentUsed()]?.name || getLastAgentUsed()}
          </div>
        </div>
      {/if}

      <div style="margin-bottom: 0.75rem; color: var(--text);">
        Select a different agent to rewrite the last response:
      </div>

      {#if isRewriting}
        <div style="text-align: center; padding: 2rem; color: var(--muted);">
          <div class="typing" style="justify-content: center; margin-bottom: 0.5rem;">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
          </div>
          <div>Rewriting response...</div>
        </div>
      {:else}
        <div class="agent-grid">
          {#each Object.values(AGENTS) as agent}
            <div
              class="agent-card"
              class:selected={getLastAgentUsed() === agent.id}
              on:click={() => rewriteWithAgent(agent.id)}
              role="button"
              tabindex="0"
              on:keydown={(e) => e.key === 'Enter' && rewriteWithAgent(agent.id)}
            >
              <div class="agent-card-name">
                <span class="agent-card-indicator" style="background: {agent.color};"></span>
                {agent.name}
              </div>
              <div class="agent-card-description">{agent.description}</div>
              {#if getLastAgentUsed() === agent.id}
                <div style="margin-top: 0.5rem; font-size: 0.75rem; color: var(--primary); font-weight: 600;">
                  (Currently used)
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
{/if}

{#if rewindAnimationActive}
  <div class="rewind-overlay" class:fade-out={!isRewriting && rewindAnimationActive}>
    <!-- Loading bar at the top -->
    <div class="rewind-loading-bar-container">
      <div class="rewind-loading-bar" style="width: {rewindLoadingProgress}%"></div>
    </div>

    <!-- Spinning loader at the top -->
    <div class="rewind-spinner">⟳</div>

    <div class="rewind-content">
      <div class="rewind-agent">
        <div class="rewind-agent-name" class:active={!isRewriting}>
          {rewindOldAgent || 'Previous Agent'}
        </div>
      </div>
      <div class="rewind-arrow-container">
        <!-- Arrow above text -->
        <div class="rewind-arrow-wrapper">
          <div class="rewind-arrow" class:rotated={isRewriting} style="transition-duration: {rewindLoadingDuration}ms;">←</div>
        </div>
        <!-- Text below arrow -->
        <div class="rewind-transition-message">
          {rewindOldAgentId && rewindNewAgentId ? getTransitionMessage(rewindOldAgentId, rewindNewAgentId) : 'Let\'s switch it up. A fresh perspective might help.'}
        </div>
      </div>
      <div class="rewind-agent">
        <div class="rewind-agent-name" class:active={isRewriting}>
          {rewindNewAgent || 'New Agent'}
        </div>
      </div>
    </div>
  </div>
{/if}

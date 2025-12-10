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
  let placeholderInterval = null; // Timer for rotating placeholder text
  let currentPlaceholderIndex = 0; // For rotating placeholder text
  let showSuggestions = true; // Show suggestions when no messages
  let loadingReflectionPrompt = ''; // Reflective prompt shown during loading
  let loadingReflectionIndex = 0; // Index for rotating reflection prompts
  let reflectionInterval = null; // Timer for rotating reflection prompts during loading
  let rewindProgressInterval = null; // Timer for rewind loading bar progress

  // Reflection prompts for new users - statements to share, not questions to ask
  const reflectionPrompts = [
    "I'm struggling with a decision and need honest perspective...",
    "I want to examine an assumption I've been holding...",
    "I feel intellectually stuck and need someone to push back...",
    "There's a pattern in my thinking I want to understand better...",
    "I believe something but haven't fully examined it...",
    "I feel stuck in my growth and need clarity...",
    "I've been avoiding feedback about something important...",
    "I hold a belief that might be limiting me..."
  ];

  // Reflective prompts shown during loading to keep users engaged
  const loadingReflectionPrompts = [
    "While I think, what's one assumption you're making about this situation?",
    "Take a moment: what would you tell a friend facing this?",
    "What's the question behind your question?",
    "What would change if you looked at this from a different angle?",
    "What do you already know but haven't fully acknowledged?",
    "If you were completely honest with yourself, what would you say?",
    "What would you want to understand better if you had more clarity?",
    "What's one thing you're avoiding thinking about here?"
  ];

  // Rotating placeholder text suggestions
  const placeholderSuggestions = [
    "Share what's on your mind—I'll help you think through it...",
    "Tell me about something you're wrestling with...",
    "What assumption or belief would you like to examine?",
    "Describe a decision, pattern, or challenge you're facing...",
    "What do you want clarity on but haven't fully explored?",
    "What would you like to reflect on or get honest feedback about?"
  ];

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
        // Hide suggestions if there are existing messages
        if (messages.length > 0) {
          showSuggestions = false;
        }
      } catch (e) {
        console.error('Failed to load saved state:', e);
      }
    }

    // Rotate placeholder text every 4 seconds
    placeholderInterval = setInterval(() => {
      if (messages.length === 0 && !input) {
        currentPlaceholderIndex = (currentPlaceholderIndex + 1) % placeholderSuggestions.length;
      }
    }, 4000);
  });

  async function send() {
    const content = input.trim();
    if (!content) return;

    // Hide suggestions once conversation starts
    if (showSuggestions) {
      showSuggestions = false;
    }

    // Add the user message immediately
    messages = [...messages, { role: 'user', content }];

    // Update UI state
    input = '';
    isLoading = true;
    errorMsg = '';
    debugInfo = null;

    // Start showing reflective prompts during loading
    loadingReflectionIndex = Math.floor(Math.random() * loadingReflectionPrompts.length);
    loadingReflectionPrompt = loadingReflectionPrompts[loadingReflectionIndex];

    // Clear any existing reflection interval
    if (reflectionInterval) {
      clearInterval(reflectionInterval);
    }

    // Rotate reflection prompts every 3 seconds while loading
    reflectionInterval = setInterval(() => {
      if (isLoading) {
        loadingReflectionIndex = (loadingReflectionIndex + 1) % loadingReflectionPrompts.length;
        loadingReflectionPrompt = loadingReflectionPrompts[loadingReflectionIndex];
      } else {
        clearInterval(reflectionInterval);
        reflectionInterval = null;
      }
    }, 3000);

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
        loadingReflectionPrompt = '';
        if (reflectionInterval) {
          clearInterval(reflectionInterval);
          reflectionInterval = null;
        }
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

          // Replace with real message - set content to empty initially for typewriter effect
          messages = messages.map((m, idx) => {
            if (idx === placeholderIndex) {
              return { role: 'assistant', content: '', agentId }; // Start empty for typewriter
            }
            return m;
          });
          messageAgentMap[placeholderIndex] = agentId;

          // Force reactivity update
          messages = messages;

          // Start typewriter effect immediately - this will populate the content
          startRealTextTyping(placeholderIndex, data.assistantMessage, 15);
        } else {
          // Fallback: add new message with empty content for typewriter
          const newMessage = { role: 'assistant', content: '', agentId }; // Start empty
          messages = [...messages, newMessage];
          const messageIndex = messages.length - 1;
          messageAgentMap[messageIndex] = agentId;
          setTimeout(() => {
            startRealTextTyping(messageIndex, data.assistantMessage, 15);
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

            // Only sync if the message count matches AND we're not currently typing
            // Check if we're typing the last message
            const lastMessageIndex = messages.length - 1;
            const isTypingLastMessage = lastMessageIndex >= 0 &&
              typingMessages[lastMessageIndex] !== undefined &&
              typingMessages[lastMessageIndex] !== messages[lastMessageIndex]?.content;

            if ((syncedMessages.length === messages.length || syncedMessages.length === messages.length - 1) && !isTypingLastMessage) {
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
      loadingReflectionPrompt = '';
      if (reflectionInterval) {
        clearInterval(reflectionInterval);
        reflectionInterval = null;
      }
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
    showSuggestions = true; // Show suggestions again when cleared
    localStorage.removeItem('mentorai_state');
  }

  function useSuggestion(prompt) {
    input = prompt;
    // Focus the input after a brief delay
    setTimeout(() => {
      const inputEl = document.querySelector('.frutiger-input');
      if (inputEl) {
        inputEl.focus();
      }
    }, 100);
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

    // Fixed 2 second duration for smooth animation
    rewindLoadingDuration = 2000; // 2000ms = 2 seconds
    rewindLoadingStartTime = Date.now();
    rewindAnimationActive = true;
    isRewriting = true;

    // Animate loading bar progress
    const startProgress = Date.now();
    if (rewindProgressInterval) {
      clearInterval(rewindProgressInterval);
    }
    rewindProgressInterval = setInterval(() => {
      const elapsed = Date.now() - startProgress;
      rewindLoadingProgress = Math.min(100, (elapsed / rewindLoadingDuration) * 100);

      if (rewindLoadingProgress >= 100) {
        clearInterval(rewindProgressInterval);
        rewindProgressInterval = null;
      }
    }, 16); // ~60fps

    // Store response data - will update message after animation
    let responseData = null;

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

      if (!res.ok || data?.error) {
        errorMsg = data?.error || data?.details || 'Rewrite failed';
        console.error('Rewrite error:', data);
        responseData = null; // Mark as error
      } else {
        // Store response data - will update message after animation
        responseData = data;
      }
    } catch (err) {
      errorMsg = 'Network error: ' + err.message;
      console.error('Rewrite exception:', err);
      responseData = null;
    } finally {
      // Wait for animation to complete (minimum 2 seconds)
      const elapsed = Date.now() - rewindLoadingStartTime;
      const remainingTime = Math.max(0, rewindLoadingDuration - elapsed);

      if (remainingTime > 0) {
        // Wait for minimum duration (2 seconds total)
        await new Promise(resolve => setTimeout(resolve, remainingTime));
      }

      // Ensure loading bar is at 100%
      rewindLoadingProgress = 100;

      // Now update the message (overlay is still showing)
      if (responseData?.assistantMessage) {
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

          // Set content to empty initially for typewriter effect
          const newMessage = {
            role: 'assistant',
            content: '', // Start empty for typewriter
            agentId: selectedAgentId
          };
          newMessages[lastAssistantIndex] = newMessage;
          // Update agent map
          messageAgentMap[lastAssistantIndex] = selectedAgentId;
          messages = newMessages;

          // Clear any existing typing state to prevent conflicts
          if (messageTimers[lastAssistantIndex]) {
            clearInterval(messageTimers[lastAssistantIndex]);
            delete messageTimers[lastAssistantIndex];
          }
          delete typingMessages[lastAssistantIndex];

          debugInfo = responseData.debug || null;
          conversationState = responseData.state || null;

          // Persist state
          if (conversationState) {
            localStorage.setItem('mentorai_state', JSON.stringify(conversationState));
          }

          // Start typewriter effect for rewritten message (no blurry placeholder)
          setTimeout(() => {
            startRealTextTyping(lastAssistantIndex, responseData.assistantMessage, 15);
          }, 100);
        } else {
          // Fallback: just add it with empty content for typewriter
          const newMessage = { role: 'assistant', content: '', agentId: selectedAgentId };
          messages = [...messages, newMessage];
          const messageIndex = messages.length - 1;
          messageAgentMap[messageIndex] = selectedAgentId;

          debugInfo = responseData.debug || null;
          conversationState = responseData.state || null;

          // Persist state
          if (conversationState) {
            localStorage.setItem('mentorai_state', JSON.stringify(conversationState));
          }

          // Start typewriter effect
          setTimeout(() => {
            startRealTextTyping(messageIndex, responseData.assistantMessage, 15);
          }, 100);
        }
      } else if (responseData && !responseData.assistantMessage) {
        errorMsg = 'No assistant message in response';
        console.error('No assistantMessage in response:', responseData);
      }

      // Fade out overlay (triggered by setting isRewriting = false)
      // Wait a tiny bit for message to render (if we have one), then fade out
      if (responseData?.assistantMessage) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      isRewriting = false;

      // Wait for fade-out animation to complete (500ms)
      await new Promise(resolve => setTimeout(resolve, 500));
      rewindAnimationActive = false;
      rewindOldAgent = null;
      rewindNewAgent = null;
      rewindOldAgentId = null;
      rewindNewAgentId = null;
      rewindLoadingProgress = 0;
      rewindLoadingStartTime = 0;
      if (rewindProgressInterval) {
        clearInterval(rewindProgressInterval);
        rewindProgressInterval = null;
      }
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
  function startTypewriterEffect(messageIndex, fullText, speed = 20, usePlaceholder = false) {
    // Clear any existing timer for this message
    if (messageTimers[messageIndex]) {
      clearInterval(messageTimers[messageIndex]);
    }

    // Direct to real text (no placeholder)
    startRealTextTyping(messageIndex, fullText, speed);
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
    if (placeholderInterval) {
      clearInterval(placeholderInterval);
      placeholderInterval = null;
    }
    if (reflectionInterval) {
      clearInterval(reflectionInterval);
      reflectionInterval = null;
    }
    if (rewindProgressInterval) {
      clearInterval(rewindProgressInterval);
      rewindProgressInterval = null;
    }
  });
</script>

<style>
  :global(:root) {
    /* Warm, Inviting Color Palette - Cream, Beige, Soft Pastels */
    --warm-cream: #FEF9F3;
    --soft-beige: #F5EDE0;
    --warm-white: #FFFBF7;
    --light-cream: #FAF6F0;
    --warm-gray: #E8E0D5;
    --soft-purple: #B8A9D9;
    --warm-purple: #9B7ED8;
    --soft-pink: #E8B8C8;
    --warm-pink: #D99BA8;
    --soft-coral: #F4C2A1;
    --warm-coral: #E8A87C;
    --text-dark: #3A3429;
    --text-medium: #5A5245;
    --text-light: #7A7265;
    --muted: #9A9285;
    --primary: #9B7ED8;
    --primary-600: #7B5EB8;
    --bg: linear-gradient(135deg, #FEF9F3 0%, #F5EDE0 25%, #FAF6F0 50%, #F5EDE0 75%, #FEF9F3 100%);
    --card: rgba(255, 251, 247, 0.95);
    --card-muted: rgba(255, 251, 247, 0.7);
    --border: rgba(155, 126, 216, 0.3);
    --text: #3A3429;
    --shadow-soft: 0 8px 32px rgba(155, 126, 216, 0.15);
    --shadow-medium: 0 12px 40px rgba(232, 184, 200, 0.2);
  }

  :global(html, body) {
    height: 100%;
    margin: 0;
    padding: 0;
    background:
      radial-gradient(circle at 20% 30%, rgba(232, 184, 200, 0.15) 0%, transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(155, 126, 216, 0.2) 0%, transparent 50%),
      radial-gradient(circle at 50% 50%, rgba(244, 194, 161, 0.1) 0%, transparent 70%),
      linear-gradient(135deg, #FEF9F3 0%, #F5EDE0 25%, #FAF6F0 50%, #F5EDE0 75%, #FEF9F3 100%);
    background-attachment: fixed;
    color: var(--text);
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    overflow: hidden;
    /* Improve touch experience on mobile */
    -webkit-tap-highlight-color: transparent;
  }

  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }

  .container {
    max-width: 100%;
    width: 100%;
    height: 100vh;
    height: 100dvh; /* Dynamic viewport height for mobile browsers */
    margin: 0;
    padding: 1.5rem;
    padding-top: max(1.5rem, env(safe-area-inset-top));
    padding-bottom: max(1.5rem, env(safe-area-inset-bottom));
    padding-left: max(1.5rem, env(safe-area-inset-left));
    padding-right: max(1.5rem, env(safe-area-inset-right));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
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
    flex-shrink: 0;
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
    flex-shrink: 1;
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
    background: linear-gradient(135deg, rgba(232, 184, 200, 0.4) 0%, rgba(217, 155, 168, 0.3) 100%);
    border: 2px solid rgba(217, 155, 168, 0.5);
    border-left: 5px solid var(--warm-pink);
    margin-left: auto;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    font-weight: 400;
    color: var(--text-dark);
  }

  .bubble.assistant {
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.98) 0%, rgba(245, 237, 224, 0.95) 100%);
    border: 2px solid rgba(155, 126, 216, 0.3);
    margin-right: auto;
    font-family: 'Caveat', 'Comfortaa', sans-serif;
    font-size: 1.15rem;
    font-weight: 500;
    color: var(--text-dark);
    box-shadow: 0 2px 12px rgba(155, 126, 216, 0.15);
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

  /* Agent color coding - Warm, inviting style */
  .bubble.agent-trust {
    border-left: 5px solid var(--warm-purple);
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.98) 0%, rgba(184, 169, 217, 0.2) 100%);
    border-color: rgba(155, 126, 216, 0.4);
    color: var(--text-dark);
  }
  .bubble.agent-challenge {
    border-left: 5px solid var(--warm-coral);
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.98) 0%, rgba(244, 194, 161, 0.25) 100%);
    border-color: rgba(232, 168, 124, 0.4);
    color: var(--text-dark);
  }
  .bubble.agent-reflection {
    border-left: 5px solid var(--soft-purple);
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.98) 0%, rgba(184, 169, 217, 0.2) 100%);
    border-color: rgba(184, 169, 217, 0.4);
    color: var(--text-dark);
  }
  .bubble.agent-transfer {
    border-left: 5px solid var(--warm-pink);
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.98) 0%, rgba(232, 184, 200, 0.2) 100%);
    border-color: rgba(217, 155, 168, 0.4);
    color: var(--text-dark);
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
    padding-top: max(1rem, env(safe-area-inset-top));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
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
    flex-direction: column;
    align-items: center;
    gap: 1.5rem;
    max-width: 500px;
    width: 100%;
    padding: 2rem;
  }

  .rewind-loading-bar-container {
    width: 100%;
    height: 4px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 2px;
    overflow: hidden;
  }

  .rewind-loading-bar {
    height: 100%;
    background: linear-gradient(90deg, var(--warm-purple), var(--warm-coral));
    border-radius: 2px;
    transition: width 0.1s linear;
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
    -webkit-appearance: none; /* Remove iOS default styling */
    appearance: none;
    touch-action: manipulation; /* Improve touch responsiveness */
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
    border: 2px solid var(--primary);
    border-radius: 20px;
    background: linear-gradient(135deg, var(--warm-purple) 0%, var(--primary-600) 100%);
    color: white;
    cursor: pointer;
    font-weight: 600;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    line-height: 1.2;
    box-shadow: 0 4px 16px rgba(155, 126, 216, 0.3);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    min-width: 140px;
    min-height: 44px; /* Minimum touch target */
    height: 48px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation; /* Improve touch responsiveness */
    -webkit-tap-highlight-color: transparent; /* Remove tap highlight on mobile */
  }

  .send-button:hover:not(:disabled) {
    background: linear-gradient(135deg, var(--primary-600) 0%, var(--warm-purple) 100%);
    box-shadow: 0 6px 20px rgba(155, 126, 216, 0.4);
    transform: translateY(-2px) scale(1.02);
    border-color: var(--soft-purple);
  }

  .send-button:active:not(:disabled) {
    transform: translateY(0) scale(1);
  }

  .send-button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .rewind-button {
    padding: 0.9rem 1.8rem;
    border: 2px solid var(--warm-coral);
    border-radius: 20px;
    background: linear-gradient(135deg, rgba(232, 168, 124, 0.9) 0%, rgba(244, 194, 161, 0.8) 100%);
    color: var(--text-dark);
    cursor: pointer;
    font-weight: 600;
    font-family: 'Comfortaa', sans-serif;
    font-size: 1rem;
    line-height: 1.2;
    box-shadow: 0 4px 16px rgba(232, 168, 124, 0.3);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    min-width: 140px;
    min-height: 44px; /* Minimum touch target */
    height: 48px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    touch-action: manipulation; /* Improve touch responsiveness */
    -webkit-tap-highlight-color: transparent; /* Remove tap highlight on mobile */
  }

  .rewind-button:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(244, 194, 161, 1) 0%, rgba(232, 168, 124, 0.95) 100%);
    box-shadow: 0 6px 20px rgba(232, 168, 124, 0.4);
    transform: translateY(-2px) scale(1.02);
    border-color: var(--warm-coral);
  }

  .rewind-button:active:not(:disabled) {
    transform: translateY(0) scale(1);
  }

  .rewind-button:disabled {
    opacity: 0.5;
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
    min-height: 44px; /* Minimum touch target */
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
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
    background: linear-gradient(135deg, rgba(232, 184, 200, 0.4) 0%, rgba(217, 155, 168, 0.3) 100%);
    color: var(--text-dark);
    border: 2px solid var(--warm-pink);
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
  .dot:nth-child(2) { animation-delay: .2s; background: var(--warm-purple); }
  .dot:nth-child(3) { animation-delay: .4s; background: var(--warm-coral); }
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
    padding-top: max(1rem, env(safe-area-inset-top));
    padding-bottom: max(1rem, env(safe-area-inset-bottom));
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
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
    min-height: 44px; /* Minimum touch target */
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
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

  /* Welcome message for first-time users */
  .welcome-container {
    margin-bottom: 1rem;
    flex-shrink: 0;
    animation: fadeInUp 0.5s ease-out;
    max-height: 60vh;
    overflow-y: auto;
  }

  .welcome-message {
    text-align: center;
    padding: 1.5rem 1.25rem;
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.98) 0%, rgba(245, 237, 224, 0.95) 100%);
    border: 2px solid rgba(155, 126, 216, 0.3);
    border-radius: 24px;
    box-shadow: 0 4px 20px rgba(155, 126, 216, 0.15);
    margin-bottom: 1rem;
  }

  .welcome-icon {
    font-size: 2rem;
    margin-bottom: 0.5rem;
    animation: wave 2s ease-in-out infinite;
  }

  @keyframes wave {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(20deg); }
    75% { transform: rotate(-20deg); }
  }

  .welcome-title {
    font-family: 'Caveat', 'Comfortaa', sans-serif;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-dark);
    margin: 0 0 0.5rem 0;
  }

  .welcome-description {
    font-family: 'Comfortaa', sans-serif;
    font-size: 0.9rem;
    color: var(--text-medium);
    line-height: 1.5;
    margin: 0 0 1rem 0;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .privacy-notice {
    font-family: 'Comfortaa', sans-serif;
    font-size: 0.8rem;
    color: var(--text-light);
    line-height: 1.4;
    margin-top: 1rem;
    padding: 0.75rem;
    background: rgba(155, 126, 216, 0.1);
    border: 1px solid rgba(155, 126, 216, 0.2);
    border-radius: 12px;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .privacy-notice strong {
    color: var(--text-dark);
  }

  .suggestions-container {
    margin-bottom: 1rem;
    padding: 1rem;
    background: var(--card);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 2px solid var(--border);
    border-radius: 20px;
    box-shadow: var(--shadow-soft);
    flex-shrink: 0;
    animation: fadeInUp 0.6s ease-out 0.2s both;
  }

  @keyframes fadeInUp {
    0% {
      opacity: 0;
      transform: translateY(10px);
    }
    100% {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .suggestions-label {
    font-size: 0.85rem;
    color: var(--muted);
    margin-bottom: 0.75rem;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .suggestions-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
  }

  .suggestion-chip {
    padding: 0.75rem 1rem;
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(107, 70, 193, 0.1) 100%);
    border: 2px solid rgba(139, 92, 246, 0.3);
    border-radius: 16px;
    color: var(--text);
    font-family: 'Comfortaa', sans-serif;
    font-size: 0.9rem;
    cursor: pointer;
    transition: all 0.3s ease;
    text-align: left;
    line-height: 1.4;
    box-shadow: 0 2px 8px rgba(139, 92, 246, 0.15);
    min-height: 44px; /* Minimum touch target */
    touch-action: manipulation;
    -webkit-tap-highlight-color: transparent;
  }

  .suggestion-chip:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(139, 92, 246, 0.25) 0%, rgba(107, 70, 193, 0.2) 100%);
    border-color: var(--primary);
    box-shadow: 0 4px 16px rgba(139, 92, 246, 0.3);
    transform: translateY(-2px);
  }

  .suggestion-chip:active:not(:disabled) {
    transform: translateY(0);
  }

  .suggestion-chip:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* Loading reflection prompt - appears during loading to keep users engaged */
  .loading-reflection {
    margin: 1rem 0;
    padding: 1.25rem 1.5rem;
    background: linear-gradient(135deg, rgba(255, 251, 247, 0.95) 0%, rgba(245, 237, 224, 0.9) 100%);
    border: 2px solid rgba(155, 126, 216, 0.3);
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 4px 16px rgba(155, 126, 216, 0.15);
    animation: fadeInUp 0.4s ease-out;
    flex-shrink: 0;
  }

  .loading-reflection-icon {
    font-size: 1.5rem;
    animation: pulse 2s ease-in-out infinite;
  }

  .loading-reflection-text {
    flex: 1;
    font-family: 'Caveat', 'Comfortaa', sans-serif;
    font-size: 1.1rem;
    color: var(--text-dark);
    font-weight: 500;
    line-height: 1.5;
    font-style: italic;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.7; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }

  /* Mobile-first responsive design */
  @media (max-width: 480px) {
    /* Small phones */
    .container {
      padding: 0.5rem;
      padding-bottom: max(0.5rem, env(safe-area-inset-bottom));
      height: 100vh;
      height: 100dvh; /* Dynamic viewport height for mobile browsers */
    }

    h1 {
      font-size: 1.25rem;
      margin-bottom: 0.25rem;
    }

    .toolbar {
      gap: 0.5rem;
      flex-wrap: wrap;
    }

    .chat {
      padding: 1rem;
      border-radius: 16px;
      margin-bottom: 0.75rem;
    }

    .bubble {
      max-width: 92%;
      padding: 0.75rem 1rem;
      font-size: 0.95rem;
      border-radius: 16px;
    }

    .bubble.assistant {
      font-size: 1rem;
    }

    .input-row {
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.5rem 0;
    }

    .frutiger-input {
      width: 100%;
      padding: 0.875rem 1rem;
      font-size: 16px; /* Prevents zoom on iOS */
      border-radius: 16px;
    }

    .send-button,
    .rewind-button {
      width: 100%;
      min-width: auto;
      padding: 0.875rem 1.5rem;
      font-size: 0.9rem;
      height: 44px; /* Minimum touch target size */
    }

    .welcome-container {
      margin-bottom: 1rem;
      max-height: 50vh;
    }

    .welcome-message {
      padding: 1rem;
      border-radius: 16px;
    }

    .welcome-icon {
      font-size: 1.5rem;
    }

    .welcome-title {
      font-size: 1.25rem;
    }

    .welcome-description {
      font-size: 0.85rem;
      margin-bottom: 0.75rem;
    }

    .privacy-notice {
      font-size: 0.75rem;
      padding: 0.625rem;
      margin-top: 0.75rem;
    }

    .suggestions-container {
      padding: 0.75rem;
      border-radius: 16px;
    }

    .suggestions-grid {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }

    .suggestion-chip {
      padding: 0.875rem 1rem;
      font-size: 0.85rem;
      border-radius: 12px;
      min-height: 44px; /* Touch-friendly */
    }

    .agent-grid {
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }

    .agent-card {
      padding: 1rem;
      border-radius: 16px;
    }

    .modal {
      max-width: 95%;
      padding: 1.5rem;
      border-radius: 20px;
      margin: 1rem;
    }

    .modal-title {
      font-size: 1.1rem;
    }

    .loading-reflection {
      padding: 1rem;
      border-radius: 16px;
      margin: 0.75rem 0;
    }

    .loading-reflection-text {
      font-size: 1rem;
    }
  }

  @media (min-width: 481px) and (max-width: 768px) {
    /* Large phones and small tablets */
    .container {
      padding: 1rem;
      padding-bottom: max(1rem, env(safe-area-inset-bottom));
    }

    h1 {
      font-size: 1.5rem;
    }

    .chat {
      padding: 1.25rem;
      border-radius: 20px;
    }

    .bubble {
      max-width: 85%;
      padding: 0.875rem 1.125rem;
    }

    .input-row {
      gap: 0.5rem;
    }

    .send-button,
    .rewind-button {
      min-width: 120px;
      padding: 0.875rem 1.5rem;
      font-size: 0.95rem;
    }

    .suggestions-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .agent-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .modal {
      max-width: 90%;
      padding: 1.75rem;
    }
  }

  @media (max-width: 640px) {
    /* General mobile adjustments */
    .bubble {
      max-width: 92%;
    }

    .toolbar {
      gap: 0.5rem;
    }

    .suggestions-grid {
      grid-template-columns: 1fr;
    }

    .agent-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (min-width: 769px) and (max-width: 1024px) {
    /* Tablets */
    .container {
      padding: 1.25rem;
      max-width: 900px;
      margin: 0 auto;
    }

    .suggestions-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .agent-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  /* Touch device optimizations */
  @media (hover: none) and (pointer: coarse) {
    /* Touch devices */
    .send-button,
    .rewind-button,
    .suggestion-chip,
    .agent-card,
    :global(button.secondary) {
      min-height: 44px; /* Minimum touch target */
    }

    .send-button:hover:not(:disabled),
    .rewind-button:hover:not(:disabled) {
      transform: none; /* Disable hover transforms on touch */
    }

    .bubble {
      padding: 1rem 1.25rem; /* Slightly larger for easier reading */
    }
  }

  /* Landscape mobile adjustments */
  @media (max-width: 896px) and (orientation: landscape) {
    .welcome-container {
      max-height: 40vh;
    }

    .welcome-message {
      padding: 1rem 1.25rem;
    }

    .welcome-icon {
      font-size: 1.5rem;
      margin-bottom: 0.25rem;
    }

    .welcome-title {
      font-size: 1.25rem;
      margin-bottom: 0.25rem;
    }

    .welcome-description {
      font-size: 0.85rem;
      margin-bottom: 0.5rem;
    }

    .privacy-notice {
      font-size: 0.75rem;
      padding: 0.5rem;
      margin-top: 0.5rem;
    }
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

  {#if messages.length === 0}
    <div class="welcome-container">
      <div class="welcome-message">
        <div class="welcome-icon">👋</div>
        <h2 class="welcome-title">Welcome to MentorAI</h2>
        <p class="welcome-description">
          I'm here to help you think through decisions, examine assumptions, and gain clarity.
          Choose a prompt below to get started, or share what's on your mind.
        </p>
        <div class="privacy-notice">
          <strong>Privacy:</strong> Your conversations are stored locally in your browser only.
          No account required. No data is sent to external servers except for generating responses via Google's Gemini API.
          You can clear your data anytime using the "Clear" button.
        </div>
      </div>
      {#if showSuggestions}
        <div class="suggestions-container">
          <div class="suggestions-label">Get started with:</div>
          <div class="suggestions-grid">
            {#each reflectionPrompts.slice(0, 4) as prompt}
              <button
                class="suggestion-chip"
                on:click={() => useSuggestion(prompt)}
                disabled={isLoading || isRewriting}
              >
                {prompt}
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if isLoading && loadingReflectionPrompt}
    <div class="loading-reflection">
      <div class="loading-reflection-icon">💭</div>
      <div class="loading-reflection-text">{loadingReflectionPrompt}</div>
    </div>
  {/if}

  <div class="row input-row">
    <input
      type="text"
      placeholder={placeholderSuggestions[currentPlaceholderIndex]}
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
    <button class="send-button" on:click={send} disabled={isLoading || isRewriting}>→ Send</button>
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
    <div class="rewind-content">
      <div class="rewind-transition-message">
        {rewindOldAgentId && rewindNewAgentId ? getTransitionMessage(rewindOldAgentId, rewindNewAgentId) : 'Rewriting with a fresh perspective...'}
      </div>
      <!-- Simple loading bar only -->
      <div class="rewind-loading-bar-container">
        <div class="rewind-loading-bar" style="width: {rewindLoadingProgress}%;"></div>
      </div>
    </div>
  </div>
{/if}

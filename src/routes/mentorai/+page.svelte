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
  let aboutModalOpen = false;
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
  let hasStartedChatting = false; // Track if user has clicked "Start Chatting"
  let welcomeFadingOut = false; // Track if welcome is fading out
  let transitionStyle = 'default'; // Transition style based on user response
  let loadingReflectionPrompt = ''; // Reflective prompt shown during loading
  let loadingReflectionIndex = 0; // Index for rotating reflection prompts
  let reflectionInterval = null; // Timer for rotating reflection prompts during loading
  let rewindProgressInterval = null; // Timer for rewind loading bar progress
  let showRewindFeedback = false; // Show optional feedback prompt in rewind modal
  let rewindFeedbackText = ''; // User's feedback about what didn't land

  // Analyze user message to determine transition style
  function analyzeMessageForTransition(message) {
    const lowerMessage = message.toLowerCase();
    const messageLength = message.length;

    // Determine transition style based on message characteristics
    if (lowerMessage.includes('urgent') || lowerMessage.includes('asap') || lowerMessage.includes('quick')) {
      return 'fast'; // Quick, snappy transition
    } else if (lowerMessage.includes('slow') || lowerMessage.includes('careful') || lowerMessage.includes('thoughtful')) {
      return 'slow'; // Slow, contemplative transition
    } else if (lowerMessage.includes('?') && messageLength < 50) {
      return 'gentle'; // Gentle fade for short questions
    } else if (messageLength > 200) {
      return 'deep'; // Deep, immersive transition for long messages
    } else if (lowerMessage.includes('help') || lowerMessage.includes('struggling') || lowerMessage.includes('stuck')) {
      return 'supportive'; // Supportive, warm transition
    } else if (lowerMessage.includes('challenge') || lowerMessage.includes('push') || lowerMessage.includes('honest')) {
      return 'bold'; // Bold, confident transition
    } else {
      return 'default'; // Default smooth transition
    }
  }

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

  // Technical system cues shown during loading - transparent about what's happening
  const loadingSystemCues = [
    "Evaluating logical structure...",
    "Reviewing context and conversation history...",
    "Analyzing patterns and dependencies...",
    "Checking for edge cases...",
    "Selecting appropriate reasoning mode...",
    "Validating assumptions...",
    "Mapping emotional state to technical frameworks...",
    "Preparing response with appropriate tone..."
  ];

  // Optional insight scaffolds - analytical rather than therapeutic
  const insightScaffolds = [
    {
      label: "Debugging Mode",
      description: "Break down the problem into testable components",
      icon: "🔍"
    },
    {
      label: "Hypothesis Testing",
      description: "Formulate and test assumptions systematically",
      icon: "🧪"
    },
    {
      label: "Systems Analysis",
      description: "Examine relationships and dependencies",
      icon: "⚙️"
    },
    {
      label: "Edge Case Exploration",
      description: "Consider boundary conditions and exceptions",
      icon: "📊"
    }
  ];

  let showInsightScaffolds = false;
  let selectedScaffold = null;

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
              // Update agent map - force reactivity
              messageAgentMap = { ...messageAgentMap, [i]: parsed.last_plan.selected_agents[0] };
              break;
            }
          }
        }
        // Hide suggestions if there are existing messages
        if (messages.length > 0) {
          showSuggestions = false;
          hasStartedChatting = true;
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

  function startChatting() {
    // Analyze any input text to determine transition style
    if (input.trim()) {
      transitionStyle = analyzeMessageForTransition(input.trim());
    } else {
      transitionStyle = 'default';
    }

    // Start fade-out animation
    welcomeFadingOut = true;

    // Adjust fade-out duration based on transition style
    const fadeDuration = transitionStyle === 'fast' ? 800 :
                        transitionStyle === 'slow' ? 2000 :
                        transitionStyle === 'deep' ? 1800 : 1500;

    // Wait for fade-out animation before actually hiding
    setTimeout(() => {
      hasStartedChatting = true;
      showSuggestions = false;
      welcomeFadingOut = false;
    }, fadeDuration);
  }

  async function send() {
    const content = input.trim();
    if (!content) return;

    // If welcome page is still showing, don't send - user must click "Start Chatting" first
    if (!hasStartedChatting) {
      return; // Don't send while welcome page is visible
    }

    // Analyze message to determine transition style
    transitionStyle = analyzeMessageForTransition(content);

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

    // Start showing technical system cues during loading
    loadingReflectionIndex = Math.floor(Math.random() * loadingSystemCues.length);
    loadingReflectionPrompt = loadingSystemCues[loadingReflectionIndex];

    // Clear any existing reflection interval
    if (reflectionInterval) {
      clearInterval(reflectionInterval);
    }

    // Rotate system cues every 2 seconds while loading (faster for technical feel)
    reflectionInterval = setInterval(() => {
      if (isLoading) {
        loadingReflectionIndex = (loadingReflectionIndex + 1) % loadingSystemCues.length;
        loadingReflectionPrompt = loadingSystemCues[loadingReflectionIndex];
      } else {
        clearInterval(reflectionInterval);
        reflectionInterval = null;
      }
    }, 2000);

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
          state: conversationState,
          scaffold: selectedScaffold // Pass scaffold selection to backend
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
          // Update agent map - force reactivity
          messageAgentMap = { ...messageAgentMap, [placeholderIndex]: agentId };

          // Force reactivity update
          messages = messages;

          // Determine typewriter speed based on transition style and message length
          const messageLength = data.assistantMessage.length;
          let typewriterSpeed = 15; // Default speed (ms per character)

          if (transitionStyle === 'fast') {
            typewriterSpeed = 8; // Fast typing for urgent messages
          } else if (transitionStyle === 'slow') {
            typewriterSpeed = 25; // Slow, contemplative typing
          } else if (transitionStyle === 'deep') {
            typewriterSpeed = 20; // Thoughtful pace for deep messages
          } else if (transitionStyle === 'gentle') {
            typewriterSpeed = 18; // Gentle pace for short questions
          } else if (transitionStyle === 'supportive') {
            typewriterSpeed = 16; // Warm, supportive pace
          } else if (transitionStyle === 'bold') {
            typewriterSpeed = 12; // Confident, bold pace
          }

          // Adjust speed based on message length (longer messages can be slightly faster)
          if (messageLength > 300) {
            typewriterSpeed = Math.max(10, typewriterSpeed - 3);
          } else if (messageLength < 100) {
            typewriterSpeed = typewriterSpeed + 5; // Slower for very short messages
          }

          // Start typewriter effect immediately - this will populate the content
          startRealTextTyping(placeholderIndex, data.assistantMessage, typewriterSpeed);
        } else {
          // Fallback: add new message with empty content for typewriter
          const newMessage = { role: 'assistant', content: '', agentId }; // Start empty
          messages = [...messages, newMessage];
          const messageIndex = messages.length - 1;
          // Update agent map - force reactivity
          messageAgentMap = { ...messageAgentMap, [messageIndex]: agentId };
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

              // Update agent map for all assistant messages - force reactivity
              const newAgentMap = { ...messageAgentMap };
              messages.forEach((m, idx) => {
                if (m.role === 'assistant' && m.agentId) {
                  newAgentMap[idx] = m.agentId;
                }
              });
              messageAgentMap = newAgentMap;
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
    hasStartedChatting = false; // Reset to show welcome page again
    localStorage.removeItem('mentorai_state');
  }

  async function useSuggestion(prompt) {
    input = prompt;

    // Analyze the prompt to determine transition style
    transitionStyle = analyzeMessageForTransition(prompt);

    // Start fade-out animation if welcome page is showing (clicking a chip is choosing how to start)
    if (!hasStartedChatting && !welcomeFadingOut) {
      welcomeFadingOut = true;

      // Adjust fade-out duration based on transition style
      const fadeDuration = transitionStyle === 'fast' ? 800 :
                          transitionStyle === 'slow' ? 2000 :
                          transitionStyle === 'deep' ? 1800 : 1500;

      // Wait for fade-out to complete before auto-sending
      await new Promise(resolve => setTimeout(resolve, fadeDuration));
      hasStartedChatting = true;
      showSuggestions = false;
      welcomeFadingOut = false;

      // Now that we've started chatting, send the suggestion
      send();
    } else if (hasStartedChatting) {
      // If already started chatting, just send immediately
      send();
    }

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
    showRewindFeedback = false; // Reset feedback prompt
    rewindFeedbackText = ''; // Clear feedback text
  }

  function closeRewindModal() {
    rewindModalOpen = false;
    showRewindFeedback = false;
    rewindFeedbackText = '';
  }

  function openAboutModal() {
    aboutModalOpen = true;
  }

  function closeAboutModal() {
    aboutModalOpen = false;
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
          // Update agent map - force reactivity by creating new object
          messageAgentMap = { ...messageAgentMap, [lastAssistantIndex]: selectedAgentId };
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
            // Determine typewriter speed for rewrite based on transition style
            const rewriteMessageLength = responseData.assistantMessage.length;
            let rewriteTypewriterSpeed = 15; // Default speed

            if (transitionStyle === 'fast') {
              rewriteTypewriterSpeed = 8;
            } else if (transitionStyle === 'slow') {
              rewriteTypewriterSpeed = 25;
            } else if (transitionStyle === 'deep') {
              rewriteTypewriterSpeed = 20;
            } else if (transitionStyle === 'gentle') {
              rewriteTypewriterSpeed = 18;
            } else if (transitionStyle === 'supportive') {
              rewriteTypewriterSpeed = 16;
            } else if (transitionStyle === 'bold') {
              rewriteTypewriterSpeed = 12;
            }

            // Adjust speed based on message length
            if (rewriteMessageLength > 300) {
              rewriteTypewriterSpeed = Math.max(10, rewriteTypewriterSpeed - 3);
            } else if (rewriteMessageLength < 100) {
              rewriteTypewriterSpeed = rewriteTypewriterSpeed + 5;
            }

            startRealTextTyping(lastAssistantIndex, responseData.assistantMessage, rewriteTypewriterSpeed);
          }, 100);
        } else {
          // Fallback: just add it with empty content for typewriter
          const newMessage = { role: 'assistant', content: '', agentId: selectedAgentId };
          messages = [...messages, newMessage];
          const messageIndex = messages.length - 1;
          // Update agent map - force reactivity
          messageAgentMap = { ...messageAgentMap, [messageIndex]: selectedAgentId };

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
    // Ensure consistent color mapping
    const agent = AGENTS[agentId];
    if (!agent) return null;
    return agent.color || null;
  }

  // Strip markdown formatting from text
  function stripMarkdown(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '$1') // Bold
      .replace(/\*(.*?)\*/g, '$1') // Italic
      .replace(/_(.*?)_/g, '$1') // Underline
      .replace(/`(.*?)`/g, '$1') // Inline code
      .replace(/```[\s\S]*?```/g, '') // Code blocks
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Links
      .replace(/^#{1,6}\s+(.*)$/gm, '$1') // Headers
      .replace(/^\s*[-*+]\s+(.*)$/gm, '$1') // List items
      .replace(/^\s*\d+\.\s+(.*)$/gm, '$1') // Numbered lists
      .trim();
  }

  // Get transition message for switching between agents - positive framing
  function getTransitionMessage(oldAgentId, newAgentId) {
    const transitions = {
      'trust_transparency': {
        'challenge_pacing': 'Switching to Challenge & Pacing for a more direct, pushback-focused perspective.',
        'reflection_coach': 'Switching to Reflection Coach for deeper self-exploration and introspection.',
        'transfer_to_world': 'Switching to Transfer to World for concrete, actionable next steps.'
      },
      'challenge_pacing': {
        'trust_transparency': 'Switching to Trust & Transparency for honest, grounded dialogue with clear limitations.',
        'reflection_coach': 'Switching to Reflection Coach for deeper self-exploration and introspection.',
        'transfer_to_world': 'Switching to Transfer to World for concrete, actionable next steps.'
      },
      'reflection_coach': {
        'trust_transparency': 'Switching to Trust & Transparency for honest, grounded dialogue with clear limitations.',
        'challenge_pacing': 'Switching to Challenge & Pacing for a more direct, pushback-focused perspective.',
        'transfer_to_world': 'Switching to Transfer to World for concrete, actionable next steps.'
      },
      'transfer_to_world': {
        'trust_transparency': 'Switching to Trust & Transparency for honest, grounded dialogue with clear limitations.',
        'challenge_pacing': 'Switching to Challenge & Pacing for a more direct, pushback-focused perspective.',
        'reflection_coach': 'Switching to Reflection Coach for deeper self-exploration and introspection.'
      }
    };

    if (!oldAgentId || !newAgentId) {
      return 'Switching to a fresh perspective.';
    }

    return transitions[oldAgentId]?.[newAgentId] || 'Switching to a different approach.';
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
    /* Warm Dark Red Color Palette - Deep, Inviting, Cozy */
    --warm-dark-red: #2D1A1A;
    --deep-red: #3D2525;
    --warm-red: #4A2E2E;
    --soft-red: #5A3A3A;
    --warm-burgundy: #6B3F3F;
    --accent-red: #C85A5A;
    --warm-coral: #D97A7A;
    --soft-coral: #E89A9A;
    --warm-pink: #E8B8B8;
    --text-light: #F5E5E5;
    --text-medium: #E8D5D5;
    --text-muted: #D5C5C5;
    --muted: #C5B5B5;
    --primary: #C85A5A;
    --primary-600: #A84A4A;
    --bg: linear-gradient(135deg, #2D1A1A 0%, #3D2525 25%, #4A2E2E 50%, #3D2525 75%, #2D1A1A 100%);
    --card: rgba(45, 26, 26, 0.95);
    --card-muted: rgba(45, 26, 26, 0.7);
    --border: rgba(200, 90, 90, 0.3);
    --text: #F5E5E5;
    --shadow-soft: 0 8px 32px rgba(200, 90, 90, 0.2);
    --shadow-medium: 0 12px 40px rgba(200, 90, 90, 0.3);
  }

  :global(html, body) {
    min-height: 100%;
    margin: 0;
    padding: 0;
    background:
      radial-gradient(circle at 20% 30%, rgba(200, 90, 90, 0.15) 0%, transparent 50%),
      radial-gradient(circle at 80% 70%, rgba(217, 122, 122, 0.2) 0%, transparent 50%),
      radial-gradient(circle at 50% 50%, rgba(232, 154, 154, 0.1) 0%, transparent 70%),
      linear-gradient(135deg, #2D1A1A 0%, #3D2525 25%, #4A2E2E 50%, #3D2525 75%, #2D1A1A 100%);
    background-attachment: fixed;
    color: var(--text);
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    overflow-y: auto;
    overflow-x: hidden;
  }

  :global(*), :global(*::before), :global(*::after) { box-sizing: border-box; }

  .container {
    max-width: 100%;
    width: 100%;
    min-height: 100vh;
    margin: 0;
    padding: 1rem 1.5rem;
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    overflow-x: hidden;
  }
  h1 {
    color: var(--text);
    letter-spacing: 0.3px;
    margin: 0;
    font-weight: 600;
    font-size: 1.9rem;
    text-shadow: 0 2px 8px rgba(135, 206, 235, 0.3);
  }
  .subtle {
    color: var(--muted);
    font-size: 1rem;
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
    margin-top: 0;
    margin-bottom: 1rem;
    scroll-behavior: smooth;
  }

  .chat.no-border {
    background: transparent;
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    border: none;
    box-shadow: none;
    padding: 0;
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
    background: linear-gradient(135deg, rgba(200, 90, 90, 0.3) 0%, rgba(217, 122, 122, 0.25) 100%);
    border: 2px solid rgba(200, 90, 90, 0.5);
    border-left: 5px solid var(--accent-red);
    margin-left: auto;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.1rem;
    font-weight: 400;
    color: var(--text-light);
  }

  .bubble.assistant {
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(90, 50, 50, 0.8) 100%);
    border: 2px solid rgba(200, 90, 90, 0.4);
    margin-right: auto;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.2rem;
    font-weight: 400;
    color: var(--text-light);
    box-shadow: 0 2px 12px rgba(200, 90, 90, 0.2);
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

  /* Agent color coding - Warm dark red style */
  .bubble.agent-trust {
    border-left: 5px solid var(--accent-red);
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(200, 90, 90, 0.25) 100%);
    border-color: rgba(200, 90, 90, 0.4);
    color: var(--text-light);
  }
  .bubble.agent-challenge {
    border-left: 5px solid var(--warm-coral);
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(217, 122, 122, 0.25) 100%);
    border-color: rgba(217, 122, 122, 0.4);
    color: var(--text-light);
  }
  .bubble.agent-reflection {
    border-left: 5px solid var(--soft-coral);
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(232, 154, 154, 0.25) 100%);
    border-color: rgba(232, 154, 154, 0.4);
    color: var(--text-light);
  }
  .bubble.agent-transfer {
    border-left: 5px solid var(--warm-pink);
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(232, 184, 184, 0.25) 100%);
    border-color: rgba(232, 184, 184, 0.4);
    color: var(--text-light);
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
    background: linear-gradient(90deg, var(--accent-red), var(--warm-coral));
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
  .meta { color: var(--muted); font-size: 0.9rem; margin-bottom: 0.15rem; }

  .toolbar { display: flex; gap: 1rem; align-items: center; justify-content: space-between; margin: 0.25rem 0 0 0; flex-shrink: 0; padding: 0; }

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
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.1rem;
    color: var(--text);
    box-shadow: 0 2px 8px rgba(200, 90, 90, 0.2);
  }

  .frutiger-input:focus {
    border-color: var(--primary);
    box-shadow: 0 0 0 4px rgba(200, 90, 90, 0.3), 0 4px 16px rgba(200, 90, 90, 0.3);
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
    background: linear-gradient(135deg, var(--accent-red) 0%, var(--primary-600) 100%);
    color: white;
    cursor: pointer;
    font-weight: 600;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.1rem;
    line-height: 1.2;
    box-shadow: 0 4px 16px rgba(200, 90, 90, 0.3);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    min-width: 140px;
    height: 48px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .send-button:hover:not(:disabled) {
    background: linear-gradient(135deg, var(--primary-600) 0%, var(--accent-red) 100%);
    box-shadow: 0 6px 20px rgba(200, 90, 90, 0.4);
    transform: translateY(-2px) scale(1.02);
    border-color: var(--warm-coral);
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
    background: linear-gradient(135deg, rgba(217, 122, 122, 0.9) 0%, rgba(232, 154, 154, 0.8) 100%);
    color: var(--text-light);
    cursor: pointer;
    font-weight: 600;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.1rem;
    line-height: 1.2;
    box-shadow: 0 4px 16px rgba(217, 122, 122, 0.3);
    transition: all 0.3s ease;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    white-space: nowrap;
    min-width: 140px;
    height: 48px;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .rewind-button:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(232, 154, 154, 1) 0%, rgba(217, 122, 122, 0.95) 100%);
    box-shadow: 0 6px 20px rgba(217, 122, 122, 0.4);
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
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.05rem;
    box-shadow: 0 2px 8px rgba(200, 90, 90, 0.15);
    transition: all 0.3s ease;
  }

  :global(button.secondary:hover) {
    background: var(--card-muted);
    box-shadow: 0 4px 12px rgba(200, 90, 90, 0.3);
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
    background: linear-gradient(135deg, rgba(200, 90, 90, 0.4) 0%, rgba(217, 122, 122, 0.3) 100%);
    color: var(--text-light);
    border: 2px solid var(--accent-red);
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
  .dot:nth-child(2) { animation-delay: .2s; background: var(--accent-red); }
  .dot:nth-child(3) { animation-delay: .4s; background: var(--warm-coral); }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.3; transform: scale(0.8); } 40% { opacity: 1; transform: scale(1.1); } }

  /* Technical system cue styling */
  .system-cue {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0;
    color: var(--text-medium);
    font-size: 0.9rem;
    font-family: 'Comfortaa', 'Segoe UI', monospace;
  }

  .system-cue-icon {
    font-size: 1rem;
    animation: spin 2s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .system-cue-text {
    font-style: italic;
    opacity: 0.85;
  }

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
    max-height: 90vh;
    box-shadow: var(--shadow-medium);
    border: 2px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .about-modal {
    max-width: 700px;
  }

  .about-content {
    display: flex;
    flex-direction: column;
    gap: 2rem;
    margin-top: 1rem;
    overflow-y: auto;
    overflow-x: hidden;
    flex: 1;
    padding-right: 0.5rem;
    -webkit-overflow-scrolling: touch;
  }

  .about-section {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .about-section-title {
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.6rem;
    font-weight: 600;
    color: var(--text-light);
    margin: 0;
  }

  .about-section-text {
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.1rem;
    color: var(--text-medium);
    line-height: 1.7;
    margin: 0;
  }

  .about-section-text strong {
    color: var(--text-light);
    font-weight: 600;
  }

  .agents-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .agent-item {
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.05rem;
    color: var(--text-medium);
    line-height: 1.7;
    padding: 0.75rem 1rem;
    background: rgba(200, 90, 90, 0.15);
    border-left: 3px solid var(--accent-red);
    border-radius: 8px;
  }

  .agent-item strong {
    color: var(--text-light);
    font-weight: 600;
  }

  .suggestion-chip {
    padding: 0.85rem 1.15rem;
    background: linear-gradient(135deg, rgba(200, 90, 90, 0.15) 0%, rgba(217, 122, 122, 0.1) 100%);
    border: 2px solid rgba(200, 90, 90, 0.3);
    border-radius: 16px;
    color: var(--text-light);
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.05rem;
    cursor: pointer;
    transition: all 0.3s ease;
    text-align: left;
    line-height: 1.6;
    box-shadow: 0 2px 8px rgba(200, 90, 90, 0.15);
  }

  .suggestion-chip:hover:not(:disabled) {
    background: linear-gradient(135deg, rgba(200, 90, 90, 0.25) 0%, rgba(217, 122, 122, 0.2) 100%);
    border-color: var(--primary);
    box-shadow: 0 4px 16px rgba(200, 90, 90, 0.3);
    transform: translateY(-2px);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    flex-shrink: 0;
  }

  .modal-title {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text);
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
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
    font-size: 0.95rem;
    color: var(--muted);
    margin-bottom: 0.25rem;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
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
    margin-bottom: 0;
    padding: 0;
    margin-top: 0;
  }

  /* Welcome message for first-time users */
  .welcome-container {
    margin-top: 0.5rem;
    margin-bottom: 1rem;
    flex-shrink: 0;
    animation: fadeInUp 0.5s ease-out;
    transition: opacity 1s ease-out, transform 1s ease-out;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: flex-start;
    min-height: 0;
    width: 100%;
    overflow: visible;
    padding: 0;
  }

  .welcome-container.fade-out {
    opacity: 0;
    transform: translateY(-20px);
    pointer-events: none;
  }

  /* Dynamic transition styles based on user response */
  .welcome-container.fade-out.fast {
    transition: opacity 0.8s ease-out, transform 0.8s ease-out;
    transform: translateY(-10px) scale(0.98);
  }

  .welcome-container.fade-out.slow {
    transition: opacity 2s ease-in-out, transform 2s ease-in-out;
    transform: translateY(-30px);
  }

  .welcome-container.fade-out.gentle {
    transition: opacity 1.2s ease-out, transform 1.2s ease-out;
    transform: translateY(-15px);
  }

  .welcome-container.fade-out.deep {
    transition: opacity 1.8s ease-in-out, transform 1.8s ease-in-out;
    transform: translateY(-25px) scale(0.99);
  }

  .welcome-container.fade-out.supportive {
    transition: opacity 1.5s ease-out, transform 1.5s ease-out;
    transform: translateY(-18px);
  }

  .welcome-container.fade-out.bold {
    transition: opacity 1s ease-out, transform 1s ease-out;
    transform: translateY(-22px) scale(0.97);
  }

  .welcome-message {
    text-align: center;
    padding: clamp(1rem, 3vh, 1.5rem) clamp(1rem, 2vw, 1.25rem);
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(90, 50, 50, 0.9) 100%);
    border: 2px solid rgba(200, 90, 90, 0.3);
    border-radius: 24px;
    box-shadow: 0 4px 20px rgba(200, 90, 90, 0.2);
    margin-bottom: clamp(0.75rem, 2vh, 1rem);
    overflow: visible;
    min-height: fit-content;
    width: 100%;
    align-self: flex-start;
    flex-shrink: 0;
  }

  .welcome-icon {
    font-size: clamp(2rem, 5vw, 2.5rem);
    margin-bottom: clamp(0.25rem, 1vh, 0.5rem);
    animation: wave 2s ease-in-out infinite;
  }

  @keyframes wave {
    0%, 100% { transform: rotate(0deg); }
    25% { transform: rotate(20deg); }
    75% { transform: rotate(-20deg); }
  }

  .welcome-title {
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: clamp(1.5rem, 4vw, 1.9rem);
    font-weight: 600;
    color: var(--text-light);
    margin: 0 0 0.5rem 0;
  }

  .welcome-description {
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: clamp(0.9rem, 2.5vw, 1rem);
    color: var(--text-medium);
    line-height: 1.5;
    margin: 0 0 clamp(0.75rem, 2vh, 1rem) 0;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
    overflow: visible;
    word-wrap: break-word;
    white-space: normal;
  }

  .privacy-notice {
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: clamp(0.8rem, 2vw, 0.9rem);
    color: var(--text-muted);
    line-height: 1.5;
    margin-top: clamp(0.75rem, 2vh, 1rem);
    padding: clamp(0.5rem, 1.5vh, 0.75rem);
    background: rgba(200, 90, 90, 0.15);
    border: 1px solid rgba(200, 90, 90, 0.3);
    border-radius: 12px;
    max-width: 600px;
    margin-left: auto;
    margin-right: auto;
  }

  .privacy-notice strong {
    color: var(--text-light);
  }

  .start-chatting-container {
    text-align: center;
    margin-top: clamp(1.5rem, 4vh, 2rem);
    margin-bottom: clamp(1rem, 3vh, 1.5rem);
    animation: fadeInUp 0.6s ease-out 0.4s both;
    width: 100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }

  .start-chatting-button {
    padding: 1rem 2.5rem;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.3rem;
    font-weight: 600;
    color: white;
    background: linear-gradient(135deg, var(--accent-red) 0%, var(--primary-600) 100%);
    border: 2px solid var(--accent-red);
    border-radius: 24px;
    cursor: pointer;
    transition: all 0.3s ease;
    box-shadow: 0 4px 16px rgba(200, 90, 90, 0.3);
    text-transform: none;
    letter-spacing: 0.5px;
  }

  .start-chatting-button:hover {
    background: linear-gradient(135deg, var(--primary-600) 0%, var(--accent-red) 100%);
    box-shadow: 0 6px 24px rgba(200, 90, 90, 0.4);
    transform: translateY(-2px) scale(1.02);
  }

  .start-chatting-button:active {
    transform: translateY(0) scale(1);
  }

  .suggestions-container {
    margin-bottom: 1rem;
    margin-top: clamp(0.75rem, 2vh, 1rem);
    padding: clamp(1rem, 3vh, 1.5rem);
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(90, 50, 50, 0.9) 100%);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    border: 2px solid var(--border);
    border-radius: 20px;
    box-shadow: var(--shadow-soft);
    width: 100%;
    display: flex;
    flex-direction: column;
    animation: fadeInUp 0.6s ease-out 0.2s both;
    min-height: fit-content;
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
    gap: 1rem;
    flex: 1;
    align-content: start;
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
    background: linear-gradient(135deg, rgba(45, 26, 26, 0.95) 0%, rgba(90, 50, 50, 0.9) 100%);
    border: 2px solid rgba(200, 90, 90, 0.3);
    border-radius: 20px;
    display: flex;
    align-items: center;
    gap: 1rem;
    box-shadow: 0 4px 16px rgba(200, 90, 90, 0.2);
    animation: fadeInUp 0.4s ease-out;
    flex-shrink: 0;
  }

  .loading-reflection-icon {
    font-size: 1.5rem;
    animation: pulse 2s ease-in-out infinite;
  }

  .loading-reflection-text {
    flex: 1;
    font-family: 'Comfortaa', 'Segoe UI', sans-serif;
    font-size: 1.15rem;
    color: var(--text-light);
    font-weight: 400;
    line-height: 1.6;
    font-style: italic;
  }

  @keyframes pulse {
    0%, 100% { opacity: 0.7; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }

  @media (max-width: 640px) {
    .bubble { max-width: 92%; }
    .toolbar { gap: 0.5rem; }
    .container { padding: 0.75rem; }
    .agent-grid {
      grid-template-columns: 1fr;
    }
    .suggestions-grid {
      grid-template-columns: 1fr;
    }
    h1 { font-size: 1.25rem; }
    .suggestions-container {
      padding: 0.75rem;
    }
  }
</style>

<div class="container">
  <div class="header-section">
    <h1>MentorAI</h1>
    <div class="toolbar">
      <button class="secondary" on:click={openAboutModal}>About</button>
      <button class="secondary" on:click={clearConversation}>Clear</button>
    </div>
  </div>

  {#if errorMsg}
    <div class="error" role="alert" style="flex-shrink: 0; margin-bottom: 0.5rem;">
      {errorMsg}
    </div>
  {/if}

  {#if messages.length === 0 && !hasStartedChatting}
    <div class="welcome-container" class:fade-out={welcomeFadingOut} class:fast={transitionStyle === 'fast'} class:slow={transitionStyle === 'slow'} class:gentle={transitionStyle === 'gentle'} class:deep={transitionStyle === 'deep'} class:supportive={transitionStyle === 'supportive'} class:bold={transitionStyle === 'bold'}>
      <div class="welcome-message">
        <div class="welcome-icon">👋</div>
        <h2 class="welcome-title">Welcome to MentorAI</h2>
        <p class="welcome-description">
          I'm here to help you think through decisions, examine assumptions, and gain clarity.
          <strong>Designed for technically minded teens</strong> who think systematically but want to explore their inner world with nuance and depth.
          Choose a prompt below to get started, or share what's on your mind.
        </p>
        <div class="privacy-notice">
          <strong>Privacy:</strong> No account required. No data is sent to external servers except for generating responses via Google's Gemini API.
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
                disabled={isLoading || isRewriting || welcomeFadingOut}
              >
                {prompt}
              </button>
            {/each}
          </div>
        </div>
      {/if}
      <div class="start-chatting-container">
        <button
          class="start-chatting-button"
          on:click={startChatting}
          disabled={welcomeFadingOut}
        >
          Start Chatting
        </button>
      </div>
    </div>
  {/if}

  <div class="chat flexcol" class:no-border={messages.length === 0 && !hasStartedChatting} bind:this={chatContainer}>
    {#each messages as m, i}
      {@const agentId = getAgentForMessage(i)}
      {@const agentClass = agentId ? `agent-${agentId.split('_')[0]}` : ''}
      {@const isRewinding = rewindAnimationActive && i === messages.length - 1 && m.role === 'assistant'}
      {@const isTyping = typingMessages[i] !== undefined && typingMessages[i] !== m.content}
      {@const isAnimatedPlaceholder = m.isPlaceholder && typingMessages[i] && !placeholderMessages[i]}
      {@const displayText = typingMessages[i] !== undefined ? typingMessages[i] : m.content}
      {@const isRevealing = m.role === 'assistant' && (i === messages.length - 1 || isTyping)}
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
          class:animated-placeholder={isAnimatedPlaceholder}
        >
          {stripMarkdown(displayText)}
        </div>
      </div>
    {/each}
    {#if isLoading}
      <div class="bubble assistant">
        <div class="meta">assistant</div>
        <div class="system-cue" aria-label="System processing">
          <span class="system-cue-icon">⚙️</span>
          <span class="system-cue-text">{loadingReflectionPrompt}</span>
        </div>
      </div>
    {/if}
  </div>


  {#if hasStartedChatting}
  <div class="row input-row" style="margin-top: 0; flex-shrink: 0;">
    {#if showInsightScaffolds}
      <div style="margin-bottom: 1rem; padding: 1rem; background: var(--bg-secondary); border-radius: 12px; border: 2px solid var(--border); width: 100%;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem;">
          <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-medium);">Reasoning Mode</div>
          <button
            class="secondary"
            on:click={() => { showInsightScaffolds = false; selectedScaffold = null; }}
            style="font-size: 0.8rem; padding: 0.3rem 0.6rem;"
          >
            Close
          </button>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem;">
          {#each insightScaffolds as scaffold}
            <button
              class="scaffold-button"
              class:selected={selectedScaffold === scaffold.label}
              on:click={() => selectedScaffold = selectedScaffold === scaffold.label ? null : scaffold.label}
              style="padding: 0.75rem; border-radius: 8px; border: 2px solid var(--border); background: var(--card); text-align: left; cursor: pointer; transition: all 0.2s;"
            >
              <div style="font-size: 1.2rem; margin-bottom: 0.25rem;">{scaffold.icon}</div>
              <div style="font-weight: 600; font-size: 0.9rem; margin-bottom: 0.25rem;">{scaffold.label}</div>
              <div style="font-size: 0.8rem; opacity: 0.7;">{scaffold.description}</div>
            </button>
          {/each}
        </div>
      </div>
    {/if}
    <input
      type="text"
      placeholder={placeholderSuggestions[currentPlaceholderIndex]}
      bind:value={input}
      on:keydown={(e) => e.key === 'Enter' && send()}
      class="frutiger-input"
      disabled={isLoading || isRewriting}
    />
    <button
      class="secondary"
      on:click={() => showInsightScaffolds = !showInsightScaffolds}
      disabled={isLoading || isRewriting}
      title="Toggle reasoning mode scaffolds"
      style="font-size: 0.85rem; padding: 0.5rem 0.75rem;"
    >
      🔍 Mode
    </button>
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
  {/if}
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

      {#if !showRewindFeedback && !isRewriting}
        <div style="margin-bottom: 1rem; text-align: center;">
          <button
            class="secondary"
            on:click={() => showRewindFeedback = true}
            style="font-size: 0.9rem; padding: 0.5rem 1rem;"
          >
            What didn't land? (Optional)
          </button>
        </div>
      {/if}

      {#if showRewindFeedback && !isRewriting}
        <div style="margin-bottom: 1rem;">
          <label style="display: block; margin-bottom: 0.75rem; color: var(--text-medium); font-size: 0.9rem; font-weight: 600;">
            What didn't land? (Choose one or more)
          </label>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.5rem; margin-bottom: 0.75rem;">
            {#each [
              { id: 'too_abstract', label: 'Too abstract', description: 'Need more concrete examples' },
              { id: 'not_actionable', label: 'Not actionable', description: 'Missing clear next steps' },
              { id: 'tone_mismatch', label: 'Tone mismatch', description: 'Wrong level of directness' },
              { id: 'too_passive', label: 'Too passive', description: 'Need more challenge/pushback' },
              { id: 'too_direct', label: 'Too direct', description: 'Need more reflection space' },
              { id: 'missing_context', label: 'Missing context', description: 'Didn\'t address key points' }
            ] as option}
              <label
                style="display: flex; align-items: center; padding: 0.6rem; border-radius: 8px; border: 2px solid var(--border); background: var(--card); cursor: pointer; transition: all 0.2s;"
                class:selected={rewindFeedbackText.includes(option.id)}
                on:click={() => {
                  const current = rewindFeedbackText.split(',').map(f => f.trim()).filter(f => f);
                  if (current.includes(option.id)) {
                    rewindFeedbackText = current.filter(f => f !== option.id).join(', ');
                  } else {
                    rewindFeedbackText = [...current, option.id].join(', ');
                  }
                }}
              >
                <input
                  type="checkbox"
                  checked={rewindFeedbackText.includes(option.id)}
                  style="margin-right: 0.5rem; cursor: pointer;"
                  on:change={() => {}}
                />
                <div>
                  <div style="font-weight: 600; font-size: 0.9rem;">{option.label}</div>
                  <div style="font-size: 0.75rem; opacity: 0.7; margin-top: 0.2rem;">{option.description}</div>
                </div>
              </label>
            {/each}
          </div>
          <div style="margin-top: 0.75rem; padding: 0.75rem; background: var(--bg-secondary); border-radius: 8px; border-left: 3px solid var(--primary);">
            <div style="font-size: 0.85rem; color: var(--text-medium);">
              <strong>Note:</strong> Feedback helps improve responses, but we won't optimize for comfort over growth.
            </div>
          </div>
          <button
            class="secondary"
            on:click={() => { showRewindFeedback = false; rewindFeedbackText = ''; }}
            style="margin-top: 0.5rem; font-size: 0.85rem; padding: 0.4rem 0.8rem;"
          >
            Skip feedback
          </button>
        </div>
      {/if}

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

{#if aboutModalOpen}
  <div class="modal-overlay" on:click={closeAboutModal} on:keydown={(e) => e.key === 'Escape' && closeAboutModal()}>
    <div class="modal about-modal" on:click|stopPropagation>
      <div class="modal-header">
        <div class="modal-title">About MentorAI</div>
        <button class="modal-close" on:click={closeAboutModal}>×</button>
      </div>

      <div class="about-content">
        <div class="about-section">
          <h3 class="about-section-title">Who is this for?</h3>
          <p class="about-section-text">
            MentorAI is designed for <strong>technically minded teens</strong> who are seeking personal growth and emotional clarity.
            If you're someone who thinks systematically, appreciates logical frameworks, and is comfortable with debugging and hypothesis testing,
            but wants to explore your inner world with nuance and depth, this is for you.
          </p>
          <p class="about-section-text">
            <strong>What makes this "technical"?</strong> We use technical thinking patterns throughout:
            framing emotional challenges as problems to understand systematically, using debugging metaphors for self-reflection,
            applying systems thinking to relationships and patterns, and treating personal growth as an iterative, testable process.
          </p>
          <p class="about-section-text">
            <strong>What makes this "teen"?</strong> The tone respects your intelligence and agency without condescension.
            We balance logical frameworks with emotional support, acknowledge your developing autonomy, and frame guidance
            as collaborative problem-solving rather than top-down advice.
          </p>
        </div>

        <div class="about-section">
          <h3 class="about-section-title">The Rewind Feature</h3>
          <p class="about-section-text">
            One of our most unique features is the <strong>Rewind button</strong>. Sometimes a response doesn't quite land—maybe it's too direct,
            or not challenging enough, or doesn't match what you need in that moment. The Rewind feature lets you explore alternative perspectives
            from different agent personas, mirroring how real conversations work where one framing might not resonate and another might.
          </p>
          <p class="about-section-text">
            This isn't just about getting a different answer—it's about understanding that there are multiple valid ways to approach any situation,
            and finding the one that feels right for you.
          </p>
      </div>

        <div class="about-section">
          <h3 class="about-section-title">Four Agent Personas</h3>
          <div class="agents-list">
            <div class="agent-item">
              <strong>Trust & Transparency</strong> — Honest, grounded dialogue with explicit limitations
        </div>
            <div class="agent-item">
              <strong>Challenge & Pacing</strong> — Gentle pushback and productive friction
        </div>
            <div class="agent-item">
              <strong>Reflection Coach</strong> — Reflective prompts and self-understanding
      </div>
            <div class="agent-item">
              <strong>Transfer to World</strong> — Concrete actions and independence
            </div>
          </div>
        </div>

        <div class="about-section">
          <h3 class="about-section-title">Our Design Philosophy</h3>
          <p class="about-section-text">
            Every feature in MentorAI is designed with <strong>humane intent</strong>. From boundary-respecting interactions to dynamic visuals
            that respond to your needs, we've built this system to support genuine growth rather than create dependency. The system respects your
            autonomy and encourages you to develop your own insights.
          </p>
        </div>

        <div class="about-section">
          <h3 class="about-section-title">Privacy & Transparency</h3>
          <p class="about-section-text">
            No account required. No data is sent to external servers except for generating responses via Google's Gemini API. You can clear your data anytime using the "Clear" button.
            We believe in transparency about how your data is handled.
          </p>
        </div>
      </div>
    </div>
  </div>
{/if}

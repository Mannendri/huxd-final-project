# Active Listening Integration - Implementation Summary

## Overview

Active listening principles from "Active Listening and Reflective Responses" by JoAnne Yates have been integrated into the MentorAI multi-agent system. The implementation follows the PDF's core principles while maintaining compatibility with the existing architecture.

## What Was Implemented

### 1. Listening Utilities Module (`src/lib/listening/`)

#### `activeListening.js`
- **`shouldUseActiveListening()`** - Determines when active listening mode should be activated based on:
  - User expressing uncertainty or confusion
  - Strong emotions detected
  - Early in conversation (need to establish understanding)
  - High dependency risk
  - User seeking help but hasn't fully explained situation

- **`determineResponseMode()`** - Decides between:
  - **Reflective mode**: Early in conversation or when user needs understanding
  - **Directive mode**: After understanding is established
  - **Mixed mode**: Combines both approaches

- **`generateActiveListeningGuidance()`** - Creates comprehensive prompt guidance including:
  - Adopting speaker's point of view
  - Reflecting thoughts and feelings
  - Responding rather than leading
  - Responding to feelings rather than content

- **`generateReflectiveResponse()`** - Helper for creating reflective responses
- **`generateOpenEndedQuestions()`** - Generates open-ended questions per PDF guidelines

#### `emotionInference.js`
- **`inferFeelings()`** - Infers emotions from user messages:
  - Detects explicit emotions (anxious, frustrated, angry, sad, etc.)
  - Infers uncertainty, seeking support
  - Determines emotional tone and intensity

- **`extractPersonalPoints()`** - Extracts personal/specific points (per PDF: "specific, personal points rather than abstract generalizations")

### 2. Type System Updates (`src/lib/core/types.js`)

Added:
- **`ListeningDirectives`** type with:
  - `mode`: "reflective" | "directive" | "mixed"
  - `use_active_listening`: boolean
  - `inferredFeelings`: object with feelings, tone, intensity
  - `personalPoints`: array of specific points to focus on

- **`listening_effectiveness`** metric added to `HumaneMetrics` (0-1 scale)

### 3. Orchestrator Updates (`src/lib/core/Orchestrator.js`)

- Determines when to use active listening based on context
- Infers feelings from user messages
- Extracts personal points for focused responses
- Adds `listening_directives` to orchestration plan
- Passes listening directives to all agents

### 4. Agent Integration

All four specialized agents now support active listening:

#### **Reflection Coach Agent**
- Primary agent for active listening (most aligned with PDF principles)
- Full integration with active listening guidance
- Uses reflective mode extensively
- Focuses on feelings, personal points, and open-ended questions

#### **Trust & Transparency Agent**
- Uses active listening to validate feelings first, then be transparent
- Approach: Understanding + Honesty = Trust

#### **Challenge & Pacing Agent**
- Uses active listening to understand before challenging
- Approach: Understanding + Gentle Pushback = Productive Friction

#### **Transfer-to-World Agent**
- Uses active listening to understand needs before suggesting actions
- Approach: Understanding + Appropriate Action = Effective Transfer

### 5. Evaluator Updates (`src/lib/core/Evaluator.js`)

- Tracks **`listening_effectiveness`** metric (0-1):
  - Higher when user seems understood/validated
  - Lower when missing feelings or perspective
  - Considers: reflecting feelings, adopting frame of reference, responding rather than leading

- Updated evaluation schema and prompts to include listening quality assessment

### 6. State Management (`src/lib/core/state.js`)

- Initial state includes `listening_effectiveness: 0.5` (baseline)

## Key Principles Implemented (from PDF)

### Active Listening Components
1. ✅ **Looks and sounds interested** - Adapted for text: acknowledgment, validation
2. ✅ **Adopts speaker's point of view** - Empathize, listen from their frame of reference
3. ✅ **Clarifies thoughts and feelings** - Limit talking, ask open-ended questions, use reflective responses

### Reflective Response Techniques
1. ✅ **Reflect thoughts and feelings** - Restate to check understanding, reflect inferred feelings, use questioning tone
2. ✅ **Respond rather than lead** - Stay in speaker's frame of reference, don't guide to new topics
3. ✅ **Respond to feelings, rather than content** - Focus on personal, specific points over abstract generalizations

### When to Use
- ✅ First stage of interaction
- ✅ When you need to understand feelings more completely
- ✅ When person hasn't revealed thoughts/feelings yet
- ✅ When person isn't sure of true feelings
- ✅ Then shift to directive mode after understanding is established

## How It Works

1. **Orchestrator analyzes** user message and conversation context
2. **Determines** if active listening should be used (based on indicators)
3. **Infers feelings** and extracts personal points from user message
4. **Sets listening mode** (reflective/directive/mixed)
5. **Passes directives** to selected agents
6. **Agents incorporate** active listening guidance into their prompts
7. **Evaluator tracks** listening effectiveness and adjusts weights

## Integration Points

- **Orchestrator**: Decides when/how to use active listening
- **Agents**: Incorporate active listening into their responses
- **Evaluator**: Tracks effectiveness and adjusts
- **State**: Maintains listening effectiveness metric

## Testing Recommendations

1. Test with emotional/uncertain user messages to see reflective mode
2. Test with clear, action-oriented messages to see directive mode
3. Verify feeling inference accuracy
4. Check that agents adopt user's frame of reference
5. Verify evaluator tracks listening effectiveness appropriately

## Future Enhancements

- More sophisticated emotion inference (NLP-based)
- Learning from user feedback on listening quality
- Adaptive listening intensity based on conversation history
- More nuanced mode transitions

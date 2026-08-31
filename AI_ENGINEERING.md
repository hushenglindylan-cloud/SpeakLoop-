# AI Engineering Layer — SpeakLoop

This document describes the AI architecture, retrieval contracts, and prompt engineering decisions in SpeakLoop. It serves as the single source of truth for the AI engineering layer.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Next.js API Layer                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐  │
│  │ /api/stt     │  │ /api/follow-up│  │ /api/evaluate-interview│ │
│  │ Qwen3-ASR   │  │ qwen3.5-flash│  │ qwen3.5-flash + rubric │ │
│  └──────────────┘  └──────────────┘  └───────────────────────┘  │
│                                                                  │
│  ┌────────────────────┐  ┌──────────────────────────────────┐   │
│  │ /api/interview-    │  │ /api/practice-questions          │   │
│  │ questions          │  │ RAG + weakness targeting          │   │
│  │ RAG + LLM select   │  │                                   │   │
│  └────────────────────┘  └──────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────┐  ┌──────────────────────────────────┐   │
│  │ /api/final-        │  │ /api/analyze-progress            │   │
│  │ evaluation         │  │ Before/After comparison           │   │
│  │ Dual evaluation    │  │                                   │   │
│  └────────────────────┘  └──────────────────────────────────┘   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│  Unified Provider: src/lib/ai/provider.ts                       │
│  - transcribeAudio() → Qwen3-ASR-Flash                         │
│  - llmChat() → qwen3.5-flash                                   │
│  - Endpoint: dashscope.aliyuncs.com/compatible-mode/v1         │
└─────────────────────────────────────────────────────────────────┘
```

## Single Source of Truth

| Asset | Location | Format |
|-------|----------|--------|
| Question Bank | `src/data/questions.json` | 1014 Part 3 questions, parsed from IELTS 2019-2020 |
| Band Descriptors | `src/data/rubric.ts` | Official IELTS Speaking public band descriptors (Band 2-9) |
| RAG Retrieval | `src/lib/rag/retrieval.ts` | Metadata-based filtering (topic, difficulty, questionType) |
| AI Provider | `src/lib/ai/provider.ts` | Unified DashScope API wrapper |

## Retrieval Contract

### Question Bank Schema
```json
{
  "id": "p3-001",
  "part": 3,
  "topic": "Environment",
  "source": "Cambridge IELTS 14",
  "difficulty": "Standard",  // Easy | Standard | Challenging
  "questionType": "discuss",  // Verb tag: discuss, compare, evaluate, agree/disagree, etc.
  "question": "the impact of pollution on marine life"  // Prompt, NOT a finished question
}
```

### Retrieval Parameters
```typescript
retrieveQuestions({
  count: number,          // How many to return
  difficulty?: string,    // Filter by difficulty level
  topic?: string,         // Filter by topic
  excludeIds?: string[],  // Avoid repeats
  questionType?: string,  // Filter by verb tag
})
```

### RAG Strategy: Plan A (Metadata Filtering)
- No vector embeddings — pure structured metadata filtering
- Sufficient for MVP with 1014 questions across 373 topics
- Random shuffle within filtered set for variety
- LLM selects 3 diverse questions from 9 candidates

## Prompt → Question Conversion

The question bank stores **prompts** (examiner cue cards), not finished questions. The LLM converts them:

| Verb Tag | Conversion Pattern |
|----------|-------------------|
| agree/disagree | "To what extent do you agree or disagree that..." |
| compare | "How do X and Y compare?" |
| evaluate | "How would you evaluate..." |
| consider | "When you consider..., what are your thoughts?" |
| discuss | "What are your thoughts on..." |
| describe | "Can you describe..." |
| comment on | "What's your view on..." |

## Evaluation Pipeline

### Input
- Transcripts: Array of { question, questionType, answer }
- Examiner context: { name, personality, difficulty }

### Output (Structured JSON)
```json
{
  "scores": {
    "fluencyCoherence": { "band": 6, "evidence": "...", "rationale": "..." },
    "lexicalResource": { "band": 5.5, "evidence": "...", "rationale": "..." },
    "grammaticalRangeAccuracy": { "band": 6, "evidence": "...", "rationale": "..." },
    "pronunciation": { "band": 6, "audioEvidenceAvailable": false }
  },
  "overallBand": 6,
  "mainWeakness": "Lexical Resource",
  "improvementFocus": "...",
  "improvedAnswers": [...]
}
```

### Rubric Injection
The full official band descriptors are injected into the evaluation prompt via `formatRubricForPrompt()`. This ensures the LLM evaluates against the actual IELTS criteria, not a simplified version.

## Follow-up Generation

### Context Window
- Main question text
- Candidate's transcript answer
- Topic
- Examiner personality (affects tone)

### Rules
1. Must be a real question (ending with ?)
2. Reference something specific the candidate said
3. Probe deeper: elaborate, example, different angle, reasoning
4. Concise (1-2 sentences), natural spoken English
5. Never repeat the main question

## Personality System

| Personality | Effect on Questions | Effect on Follow-ups |
|-------------|-------------------|---------------------|
| Strict | Formal, precise wording | Direct, structured probes |
| Friendly | Conversational, warm | Encouraging elaboration |
| Encouraging | Supportive phrasing | Gentle deepening |
| Challenging | Abstract, multi-layered | Critical thinking probes |

## Difficulty Levels

| Level | Question Characteristics |
|-------|------------------------|
| Easy | Simple language, concrete topics, common vocabulary |
| Standard | IELTS-level, mix of concrete and abstract |
| Challenging | Sophisticated language, abstract concepts, multi-layered |

## Reusable Skill: IELTS Speaking Evaluation

This system can be extracted as a reusable skill for:
1. **IELTS Speaking evaluation** — given transcripts, produce band scores with evidence
2. **Question generation** — given topic/difficulty, generate natural Part 3 questions
3. **Follow-up generation** — given Q+A pair, generate contextual follow-ups
4. **Progress analysis** — compare two sets of transcripts, identify improvements

### Integration Points
- STT: Any ASR service that returns text (currently Qwen3-ASR-Flash)
- LLM: Any model supporting structured JSON output (currently qwen3.5-flash)
- Question Bank: Extensible to other exam formats (TOEFL, PTE)

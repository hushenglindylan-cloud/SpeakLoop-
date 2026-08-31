import { NextRequest, NextResponse } from 'next/server';
import {
  retrieveQuestions,
  getAvailableTopics,
  getQuestionStats,
} from '@/lib/rag/retrieval';

// GET /api/questions — retrieve questions from the RAG bank
//
// Query params:
//   count     — number of questions to return (default: 3)
//   topic     — filter by topic (partial match)
//   difficulty — Easy | Standard | Challenging
//   exclude   — comma-separated question IDs to exclude
//   action    — "topics" to list all topics, "stats" to get counts
//
// Examples:
//   GET /api/questions?count=3&difficulty=Standard
//   GET /api/questions?topic=technology&exclude=p3-001,p3-002
//   GET /api/questions?action=topics
//   GET /api/questions?action=stats

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    // Special actions
    if (action === 'topics') {
      return NextResponse.json({ topics: getAvailableTopics() });
    }
    if (action === 'stats') {
      return NextResponse.json(getQuestionStats());
    }

    // Standard retrieval
    const count = parseInt(searchParams.get('count') || '3', 10);
    const topic = searchParams.get('topic') || undefined;
    const difficulty = searchParams.get('difficulty') as
      | 'Easy'
      | 'Standard'
      | 'Challenging'
      | undefined;
    const excludeStr = searchParams.get('exclude') || '';
    const excludeIds = excludeStr
      ? excludeStr.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const result = retrieveQuestions({
      count,
      topic,
      difficulty,
      excludeIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Question retrieval error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

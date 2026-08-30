import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const audioBlob = formData.get('audio') as Blob;

    if (!audioBlob) {
      return NextResponse.json(
        { error: 'No audio provided' },
        { status: 400 }
      );
    }

    // Check if audio is empty or too small (less than 1KB = likely no voice)
    if (audioBlob.size < 1024) {
      return NextResponse.json(
        { error: 'We couldn\'t detect your voice. Please try again.' },
        { status: 422 }
      );
    }

    const groqKey = process.env.GROQ_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const apiKey = groqKey || openaiKey;

    if (!apiKey) {
      // Mock STT response for development without any API key configured
      const mockTranscripts = [
        "I think technology has definitely made our lives more complex in some ways, but also simpler in others. For example, smartphones allow us to access information instantly, which is convenient, but they also create expectations of constant connectivity.",
        "I believe the government should balance both priorities. Space exploration drives innovation and inspires future generations, but we can't ignore pressing problems like climate change and poverty that need immediate attention.",
        "Communication has changed dramatically over the past few decades. The internet and social media have made it possible to connect with anyone anywhere, but I think we've lost some of the depth that comes from face-to-face interaction.",
      ];

      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 1500));

      const randomIndex = Math.floor(Math.random() * mockTranscripts.length);
      return NextResponse.json({
        transcript: mockTranscripts[randomIndex],
        mock: true,
      });
    }

    // Real STT via an OpenAI-compatible transcription endpoint.
    // Prefer Groq (free tier: 2,000 requests/day, ~8 hours of audio/day,
    // ~9x cheaper than OpenAI beyond that) and fall back to OpenAI Whisper
    // if only OPENAI_API_KEY is configured.
    // Use the filename the client actually sent (it reflects the real
    // encoding it recorded in — e.g. Safari records mp4/aac, not webm)
    // so the API gets an accurate hint about the file format.
    const uploadedName = audioBlob instanceof File ? audioBlob.name : 'recording.webm';
    const transcriptionUrl = groqKey
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions';
    const transcriptionModel = groqKey ? 'whisper-large-v3-turbo' : 'whisper-1';

    const openaiFormData = new FormData();
    openaiFormData.append('file', audioBlob, uploadedName || 'recording.webm');
    openaiFormData.append('model', transcriptionModel);
    openaiFormData.append('language', 'en');

    const response = await fetch(transcriptionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
      body: openaiFormData,
    });

    if (!response.ok) {
      const rawText = await response.text().catch(() => '');
      let error: unknown = rawText;
      try {
        error = JSON.parse(rawText);
      } catch {
        // not JSON — keep the raw text
      }
      console.error(`STT provider error (${groqKey ? 'Groq' : 'OpenAI'}, status ${response.status}):`, error);
      return NextResponse.json(
        { error: `We couldn't process your answer (${groqKey ? 'Groq' : 'OpenAI'} ${response.status}). Please try again.` },
        { status: 500 }
      );
    }

    const data = await response.json();

    if (!data.text || data.text.trim().length === 0) {
      return NextResponse.json(
        { error: 'We couldn\'t detect your voice. Please try again.' },
        { status: 422 }
      );
    }

    return NextResponse.json({
      transcript: data.text,
    });
  } catch (error) {
    console.error('STT error:', error);
    return NextResponse.json(
      { error: 'We couldn\'t process your answer. Please try again.' },
      { status: 500 }
    );
  }
}

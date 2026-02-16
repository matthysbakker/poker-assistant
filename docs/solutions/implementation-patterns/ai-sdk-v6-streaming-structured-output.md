---
title: "Streaming Structured AI Output with AI SDK v6 + Claude Vision"
date: 2026-02-16
tags: ["ai-sdk", "streaming", "structured-output", "next.js", "anthropic", "vision", "zod"]
category: implementation-patterns
module: poker-assistant
symptoms:
  - "How to stream structured JSON from LLM to client"
  - "Real-time partial results while LLM generates"
  - "Share Zod schema between server streamObject and client useObject"
  - "Claude Vision with streaming structured output"
  - "AI SDK v6 streamObject toTextStreamResponse pattern"
  - "Zod 4 compatibility with AI SDK"
---

## Summary

Pattern for streaming structured AI output from Claude Vision to a Next.js client using AI SDK v6. Server uses `streamObject()` with a Zod schema; client uses `experimental_useObject` with the same schema. Fields render incrementally as they arrive.

## Architecture

```
Client: paste/drop image
  → resizeImage() (canvas, max 1568px, JPEG 85%)
  → useObject.submit({ image: base64 })
  → POST /api/analyze
Server:
  → Zod validate request
  → streamObject({ model, schema, messages: [image] })
  → result.toTextStreamResponse()
Client:
  ← useObject receives partial object
  ← Renders fields as they stream in
```

## Key Patterns

### 1. Shared Zod Schema (`lib/ai/schema.ts`)

Single schema used by both server and client. The `.describe()` calls guide the LLM's output.

```typescript
import { z } from "zod";

export const handAnalysisSchema = z.object({
  action: z.enum(["FOLD", "CHECK", "CALL", "BET", "RAISE"])
    .describe("Recommended action"),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"])
    .describe("Confidence level of the recommendation"),
  reasoning: z.string()
    .describe("Step-by-step reasoning, written for beginners"),
  concept: z.string()
    .describe("The key poker concept at play"),
  tip: z.string()
    .describe("A practical beginner-friendly tip"),
  // ... more fields
});

export type HandAnalysis = z.infer<typeof handAnalysisSchema>;
```

### 2. Server: `streamObject()` with Vision

```typescript
import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export function analyzeHand(imageBase64: string) {
  return streamObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: handAnalysisSchema,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Analyze this poker hand screenshot." },
          { type: "image", image: imageBase64 },
        ],
      },
    ],
  });
}
```

### 3. API Route: Validate + Stream

```typescript
export const maxDuration = 30;

const requestSchema = z.object({ image: z.string().min(1) });

export async function POST(req: Request) {
  const body = await req.json();
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const result = analyzeHand(parsed.data.image);
  return result.toTextStreamResponse();
}
```

### 4. Client: `useObject` Hook

```typescript
"use client";
import { useEffect, useRef } from "react";
import { experimental_useObject as useObject } from "@ai-sdk/react";

const { object, submit, isLoading, error } = useObject({
  api: "/api/analyze",
  schema: handAnalysisSchema, // Same schema as server
});

// Trigger submit via useEffect, not during render
const submittedRef = useRef<string | null>(null);
useEffect(() => {
  if (imageBase64 && imageBase64 !== submittedRef.current) {
    submittedRef.current = imageBase64;
    submit({ image: imageBase64 });
  }
}, [imageBase64, submit]);

// Render with optional chaining — fields arrive incrementally
return <span>{object?.action}</span>;
```

### 5. Image Resize for Claude Vision

```typescript
const MAX_DIMENSION = 1568;

export async function resizeImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const scale = MAX_DIMENSION / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  // Strip data URL prefix → raw base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
```

## Gotchas

- **Don't call `submit()` during render** — use `useEffect` with a ref to prevent infinite loops
- **`useObject` returns `DeepPartial`** — every field can be `undefined` during streaming, use optional chaining
- **Zod 4 works with AI SDK v6** — peer dependency is `^3.25.76 || ^4.1.8`
- **`maxDuration = 30`** — required on Vercel for AI routes; serverless default (10s) is too short
- **Image base64 must be raw** — strip the `data:image/jpeg;base64,` prefix before sending to the AI SDK `image` content part
- **1568px max dimension** — Claude Vision's optimal input size; larger images waste tokens

## Dependencies

```json
{
  "ai": "^6.0.86",
  "@ai-sdk/react": "^3.0.88",
  "@ai-sdk/anthropic": "^3.0.44",
  "zod": "^4.3.6"
}
```

## Related Files

- `lib/ai/schema.ts` — Shared Zod schema
- `lib/ai/analyze-hand.ts` — streamObject wrapper
- `app/api/analyze/route.ts` — API route
- `components/analyzer/AnalysisResult.tsx` — useObject consumer
- `lib/utils/image.ts` — Client-side image processing

## Cross-References

- [AI SDK Docs: streamObject](https://ai-sdk.dev/docs/reference/ai-sdk-core/stream-object)
- [AI SDK Docs: useObject](https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-object)
- [AI SDK Docs: Object Generation](https://ai-sdk.dev/docs/ai-sdk-ui/object-generation)
- `docs/plans/2026-02-16-feat-poker-assistant-mvp-plan.md` — Original MVP plan

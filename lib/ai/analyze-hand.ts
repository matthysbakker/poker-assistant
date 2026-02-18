import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { handAnalysisSchema } from "./schema";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_WITH_DETECTED_CARDS, buildOpponentContext } from "./system-prompt";

const MODELS = {
  continuous: "claude-haiku-4-5-20251001",
  manual: "claude-sonnet-4-20250514",
} as const;

interface OpponentHistoryEntry {
  username?: string;
  handsObserved: number;
  actions: string[];
  inferredType: string;
}

export function analyzeHand(
  imageBase64: string,
  opponentHistory?: Record<number, OpponentHistoryEntry>,
  detectedCards?: string,
  handContext?: string,
  captureMode: "manual" | "continuous" = "manual",
) {
  const opponentContext = opponentHistory
    ? buildOpponentContext(opponentHistory)
    : "";

  const hasDetectedCards = detectedCards && detectedCards.length > 0;

  let userText: string;
  if (hasDetectedCards) {
    userText = `Analyze this poker hand and recommend the best action.\n\nDetected cards: ${detectedCards}`;
  } else {
    userText = "Analyze this poker hand screenshot and recommend the best action.";
  }

  if (handContext) {
    userText += `\n\nHand history so far: ${handContext}`;
  }

  if (opponentContext) {
    userText += opponentContext;
  }

  if (captureMode === "continuous") {
    userText += "\n\nThis is a live game. Be concise — skip the concept and tip.";
  }

  const systemPrompt = hasDetectedCards
    ? SYSTEM_PROMPT_WITH_DETECTED_CARDS
    : SYSTEM_PROMPT;

  return streamObject({
    model: anthropic(MODELS[captureMode]),
    schema: handAnalysisSchema,
    messages: [
      {
        role: "system",
        content: systemPrompt,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userText,
          },
          {
            type: "image",
            image: imageBase64,
          },
        ],
      },
    ],
  });
}

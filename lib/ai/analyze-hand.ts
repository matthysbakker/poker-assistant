import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { handAnalysisSchema } from "./schema";
import { SYSTEM_PROMPT, SYSTEM_PROMPT_WITH_DETECTED_CARDS, buildOpponentContext } from "./system-prompt";

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

  if (opponentContext) {
    userText += opponentContext;
  }

  return streamObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: handAnalysisSchema,
    system: hasDetectedCards ? SYSTEM_PROMPT_WITH_DETECTED_CARDS : SYSTEM_PROMPT,
    messages: [
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

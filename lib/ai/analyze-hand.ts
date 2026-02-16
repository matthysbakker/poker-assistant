import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { handAnalysisSchema } from "./schema";
import { SYSTEM_PROMPT, buildOpponentContext } from "./system-prompt";

interface OpponentHistoryEntry {
  username?: string;
  handsObserved: number;
  actions: string[];
  inferredType: string;
}

export function analyzeHand(
  imageBase64: string,
  opponentHistory?: Record<number, OpponentHistoryEntry>,
) {
  const opponentContext = opponentHistory
    ? buildOpponentContext(opponentHistory)
    : "";

  const userText = opponentContext
    ? `Analyze this poker hand screenshot and recommend the best action.\n${opponentContext}`
    : "Analyze this poker hand screenshot and recommend the best action.";

  return streamObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: handAnalysisSchema,
    system: SYSTEM_PROMPT,
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

import { streamObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { handAnalysisSchema } from "./schema";
import { SYSTEM_PROMPT } from "./system-prompt";

export function analyzeHand(imageBase64: string) {
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
            text: "Analyze this poker hand screenshot and recommend the best action.",
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

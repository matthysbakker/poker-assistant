import type { HandAnalysis } from "@/lib/ai/schema";

export interface StoredHand {
  id: string;
  timestamp: number;
  thumbnail: string;
  analysis: HandAnalysis;
}

const STORAGE_KEY = "poker-hands";

export function getStoredHands(): StoredHand[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredHand[];
  } catch {
    return [];
  }
}

export function saveHand(
  thumbnail: string,
  analysis: HandAnalysis,
): StoredHand {
  const hand: StoredHand = {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    thumbnail,
    analysis,
  };

  const hands = getStoredHands();
  hands.unshift(hand);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hands));

  return hand;
}

export function deleteHand(id: string): void {
  const hands = getStoredHands().filter((h) => h.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(hands));
}

export function clearAllHands(): void {
  localStorage.removeItem(STORAGE_KEY);
}

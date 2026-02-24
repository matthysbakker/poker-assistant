/**
 * Card parsing utilities for the equity module.
 * Handles both "Ah" and "10h" (as well as legacy "Th") formats.
 */

export interface Card {
  rank: number; // 2–14
  suit: number; // 0=h, 1=d, 2=c, 3=s
}

const RANK_MAP: Record<string, number> = {
  "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8,
  "9": 9, "10": 10, "T": 10, "J": 11, "Q": 12, "K": 13, "A": 14,
};

const SUIT_MAP: Record<string, number> = { h: 0, d: 1, c: 2, s: 3 };

/**
 * Parse a card string into a Card.
 * Accepts "Ah", "10s", "Th", "2c", etc.
 * Returns null if the string is not a valid card.
 */
export function parseCard(card: string): Card | null {
  const s = card.trim();
  if (s.length < 2) return null;
  const suitChar = s[s.length - 1].toLowerCase();
  const suit = SUIT_MAP[suitChar];
  if (suit === undefined) return null;
  const rankStr = s.slice(0, -1).toUpperCase();
  const rank = RANK_MAP[rankStr];
  if (rank === undefined) return null;
  return { rank, suit };
}

/** Parse multiple card strings, silently skipping invalid ones. */
export function parseCards(cards: string[]): Card[] {
  return cards.map(parseCard).filter((c): c is Card => c !== null);
}

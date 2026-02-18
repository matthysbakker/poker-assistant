export type Suit = "c" | "d" | "h" | "s";
export type Rank =
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K"
  | "A";

export type CardCode = `${Rank}${Suit}`;

export interface CardRegion {
  name: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CardMatch {
  region: string;
  card: CardCode | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "NONE";
  matchScore: number;
  gap: number;
}

export type CardGroup = "hero" | "community";

export interface LocatedCard {
  /** Which group this card belongs to. */
  group: CardGroup;
  /** Bounding box in original image coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Card corner crop region (top-left portion for rank/suit identification). */
  corner: { x: number; y: number; width: number; height: number };
}

export interface DetectionResult {
  heroCards: CardMatch[];
  communityCards: CardMatch[];
  detectedText: string;
  heroTurn: boolean;
  timing: number;
}

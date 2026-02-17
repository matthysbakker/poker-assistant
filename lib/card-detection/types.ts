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

export interface DetectionResult {
  heroCards: CardMatch[];
  communityCards: CardMatch[];
  detectedText: string;
  timing: number;
}

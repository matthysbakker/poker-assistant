import type { Opponent } from "@/lib/ai/schema";

export interface OpponentProfile {
  seat: number;
  username?: string;
  handsObserved: number;
  actions: string[];
  inferredType: string;
  averageStack: string;
}

export interface PokerSession {
  id: string;
  startedAt: number;
  handCount: number;
  opponents: Record<number, OpponentProfile>;
}

const SESSION_KEY = "poker-session";

export function getSession(): PokerSession {
  if (typeof window === "undefined") {
    return createSession();
  }

  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw) as PokerSession;
  } catch {
    // Corrupted data — start fresh
  }

  const session = createSession();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

function createSession(): PokerSession {
  return {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    handCount: 0,
    opponents: {},
  };
}

export function updateOpponentProfiles(
  opponents: Opponent[],
): PokerSession {
  const session = getSession();
  session.handCount += 1;

  for (const opp of opponents) {
    const existing = session.opponents[opp.seat];

    if (existing) {
      existing.handsObserved += 1;
      existing.inferredType = opp.playerType;
      existing.averageStack = opp.stack;
      if (opp.username) existing.username = opp.username;
      if (opp.currentAction) {
        existing.actions.push(opp.currentAction);
        // Keep last 20 actions max
        if (existing.actions.length > 20) {
          existing.actions = existing.actions.slice(-20);
        }
      }
    } else {
      session.opponents[opp.seat] = {
        seat: opp.seat,
        username: opp.username,
        handsObserved: 1,
        actions: opp.currentAction ? [opp.currentAction] : [],
        inferredType: opp.playerType,
        averageStack: opp.stack,
      };
    }
  }

  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

export function getOpponentContext(): Record<
  number,
  { username?: string; handsObserved: number; actions: string[]; inferredType: string }
> | undefined {
  const session = getSession();
  if (Object.keys(session.opponents).length === 0) return undefined;

  const context: Record<
    number,
    { username?: string; handsObserved: number; actions: string[]; inferredType: string }
  > = {};

  for (const [seat, profile] of Object.entries(session.opponents)) {
    context[Number(seat)] = {
      username: profile.username,
      handsObserved: profile.handsObserved,
      actions: profile.actions,
      inferredType: profile.inferredType,
    };
  }

  return context;
}

export function resetSession(): PokerSession {
  const session = createSession();
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

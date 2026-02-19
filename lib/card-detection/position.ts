export type Position = "UTG" | "MP" | "CO" | "BTN" | "SB" | "BB";

/**
 * Position labels in clockwise order from dealer button.
 * Index 0 = dealer (BTN), 1 = SB, 2 = BB, 3 = UTG, 4 = MP, 5 = CO.
 */
const POSITIONS_6MAX: Position[] = ["BTN", "SB", "BB", "UTG", "MP", "CO"];

/**
 * Compute hero's position given the dealer button's seat number.
 *
 * Seats are numbered 0-5 clockwise from hero (seat 0 = hero).
 * Clockwise: 0=hero(bottom), 1=bottom-left, 2=top-left,
 * 3=top-center, 4=top-right, 5=bottom-right.
 *
 * Positions are assigned clockwise from the dealer:
 *   dealer = BTN, next clockwise = SB, next = BB, UTG, MP, CO.
 *
 * @param dealerSeat - Seat number where the dealer button is (0-5)
 * @returns Hero's position label
 */
export function heroPosition(dealerSeat: number): Position {
  // Hero is at seat 0. Offset = how many seats clockwise from dealer to hero.
  const offset = (6 - dealerSeat) % 6;
  return POSITIONS_6MAX[offset];
}

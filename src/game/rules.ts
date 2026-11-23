// What differs in the rules between the games this engine reads: History
// Line 1914-1918 and the three Battle Isle games it grew out of.
//
// The rules themselves (state.ts, movement.ts, combat.ts) are History Line's,
// as the hl1914-18 project's notes describe them. Battle Isle's program is
// the older version of the same one and its data files have the same
// layouts, so its battles are played by the same rules with the numbers
// below. How far Battle Isle's own program agrees with History Line's in the
// rest has not been checked.

/** The terrain numbers a construction unit's work leaves behind. They come from a game's AMOK.DAT. */
export interface WorkGround {
  /**
   * Ground prepared for a depot: the field its entrance will be on, then the
   * fields to its lower right, below it and to its lower left.
   */
  preparedGround: readonly number[];
  /** A depot's fields other than its entrance: to the entrance's lower right, below it and to its lower left. */
  depotGround: readonly number[];
}

export interface Rules extends WorkGround {
  /**
   * The unit kinds both armies can build. Kinds before the first are for the
   * first side only and kinds after the last for the second side only. Null
   * if every kind is for both.
   */
  sharedKinds: { first: number; last: number } | null;
  /** The budget of a unit that leaves a transport or a building. */
  leavingBudget: number;
  /** The same for a unit that pays a flat cost for every field. */
  leavingBudgetFlat: number;
}

/**
 * History Line's rules. The ground numbers are bytes 24 to 27 and 29 to 31
 * of its AMOK.DAT; the first ten unit kinds are German and those after the
 * 36th French.
 */
export const HISTORYLINE_RULES: Rules = {
  sharedKinds: { first: 10, last: 35 },
  leavingBudget: 8,
  leavingBudgetFlat: 4,
  preparedGround: [0x15, 0x18, 0x16, 0x17],
  depotGround: [0x14, 0x12, 0x13],
};

/**
 * Battle Isle's rules, less the ground numbers, which differ between its
 * three games and are read from each one's AMOK.DAT.
 *
 * Both armies have the same unit kinds. Battle Isle's terrain costs are half
 * of History Line's (open ground 3 against 6, a road 2 against 4), and so
 * the budget for leaving a building is taken to be half as well: enough for
 * one field of open ground or two of road. That is an assumption, not
 * something read from the program.
 */
export const BATTLE_ISLE_RULES: Omit<Rules, keyof WorkGround> = {
  sharedKinds: null,
  leavingBudget: 4,
  leavingBudgetFlat: 2,
};

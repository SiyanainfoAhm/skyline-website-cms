/** University levels offered above the school levels. Each counts as "Year 12 or equivalent" for reporting. */
export const DEGREE_LEVELS = ["Doctorate (PhD)", "Master's degree", "Bachelor's degree"];
const YEAR_12 = "Year 12 or equivalent - 12";

/** The school level reported for a chosen education level: any degree means school was completed to Year 12. */
export function schoolLevelFor(choice: string): string {
  return DEGREE_LEVELS.includes(choice) ? YEAR_12 : choice;
}

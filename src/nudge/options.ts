import { option } from "pastel";
import { z } from "zod";
import { NUDGE_DAYS } from "./nudge.ts";

export const days = z
  .number()
  .int()
  .nonnegative()
  .default(NUDGE_DAYS)
  .describe(option({ description: "How near is near, in days", valueDescription: "n" }));

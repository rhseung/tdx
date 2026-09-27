import { option } from "pastel";
import { z } from "zod";
import { t } from "../i18n/index.ts";
import { NUDGE_DAYS } from "./nudge.ts";

export const days = z
  .number()
  .int()
  .nonnegative()
  .default(NUDGE_DAYS)
  .describe(option({ description: t.help.days, valueDescription: "n" }));

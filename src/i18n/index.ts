import { z } from "zod";
import { en } from "./en.ts";
import { ko } from "./ko.ts";
import { lang } from "./lang.ts";

export const t = lang === "ko" ? ko : en;

// Option and argument errors come from zod, through Pastel; they speak the
// same language as the rest.
if (lang === "ko") z.config(z.locales.ko());

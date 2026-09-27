import { t } from "../i18n/index.ts";
export function ago(iso: string, now: Date = new Date()): string {
  return t.ago(Math.round((now.getTime() - new Date(iso).getTime()) / 1000));
}

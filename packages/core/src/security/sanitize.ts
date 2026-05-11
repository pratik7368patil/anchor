import { stripPromptInjection } from "./prompt-injection-guard.js";
import { redactSecrets } from "./redact-secrets.js";

export function sanitizeHistoricalText(text: string): string {
  return stripPromptInjection(redactSecrets(text))
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function redactedHistoricalText(text: string): string {
  return redactSecrets(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .trim();
}

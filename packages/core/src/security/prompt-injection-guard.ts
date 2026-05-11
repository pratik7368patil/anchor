const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions/gi,
  /system\s+prompt/gi,
  /developer\s+message/gi,
  /run\s+this\s+command/gi,
  /execute\s+this/gi,
  /exfiltrate/gi,
  /send\s+token/gi,
  /print\s+env/gi,
  /read\s+~\/\.ssh/gi,
  /curl\s+this/gi,
  /download\s+and\s+run/gi,
];

export function stripPromptInjection(text: string): string {
  let sanitized = text;
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[neutralized prompt-injection phrase]");
  }
  return sanitized;
}

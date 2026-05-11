const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bgithub_pat_[A-Za-z0-9_]{20,255}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\bgh[pousr]_[A-Za-z0-9_]{30,255}\b/g, "[REDACTED_GITHUB_TOKEN]"],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]"],
  [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/g,
    "[REDACTED_PRIVATE_KEY]",
  ],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "[REDACTED_JWT]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]{20,}=*/gi, "$1[REDACTED_BEARER_TOKEN]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, "[REDACTED_SLACK_TOKEN]"],
  [/\bnpm_[A-Za-z0-9]{30,}\b/g, "[REDACTED_NPM_TOKEN]"],
  [/\bya29\.[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_OAUTH_TOKEN]"],
  [
    /\b(api[_-]?key|access[_-]?token|auth[_-]?token|oauth[_-]?token|secret|password)\b\s*[:=]\s*["']?[^"'\s,;]{12,}["']?/gi,
    "$1=[REDACTED_SECRET]",
  ],
];

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function redactHighEntropyTokens(text: string): string {
  return text.replace(/\b[A-Za-z0-9_+/.-]{32,}\b/g, (token) => {
    const hasLetter = /[A-Za-z]/.test(token);
    const hasNumber = /\d/.test(token);
    const looksLikePath = token.includes("/") && !/[+/=]/.test(token);
    if (!hasLetter || !hasNumber || looksLikePath) return token;
    return shannonEntropy(token) >= 3.6 ? "[REDACTED_SECRET]" : token;
  });
}

export function redactSecrets(text: string): string {
  let redacted = text;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, replacement);
  }
  return redactHighEntropyTokens(redacted);
}

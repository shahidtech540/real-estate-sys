import pino from "pino";

/**
 * Structured logging — `ARCHITECTURE.md` §14.8 and §15.2, `AGENTS.md` §5.10.
 *
 * JSON lines to stdout, collected by Docker's json-file driver. Redaction is
 * configured here so a stray object cannot leak a credential or PII: passwords,
 * session tokens, cookies, CNIC and phone never reach a log line.
 */
const redactPaths = [
  "req.headers.cookie",
  "password",
  "passwordHash",
  "currentPassword",
  "newPassword",
  "temporaryPassword",
  "token",
  "tokenHash",
  "cnic",
  "phone",
  "secretCiphertext",
  "authorization",
];

export const logger = pino({
  level:
    process.env.LOG_LEVEL ??
    (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: { paths: redactPaths, censor: "[redacted]" },
  base: { service: "spm" },
  timestamp: pino.stdTimeFunctions.isoTime,
});

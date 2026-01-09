export function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...data,
  };
  console.error(JSON.stringify(logEntry));
}

export const logger = {
  info: (msg, data) => log("INFO", msg, data),
  error: (msg, data) => log("ERROR", msg, data),
  warn: (msg, data) => log("WARN", msg, data),
  debug: (msg, data) => log("DEBUG", msg, data),
};


type LogLevel = "debug" | "info" | "warn" | "error";

const RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function currentLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function write(level: LogLevel, message: string, extra?: unknown): void {
  if (RANK[level] < RANK[currentLevel()]) return;
  // 通常実行では info も出さない（debug 指定時のみ詳細表示）
  if (level === "info" && currentLevel() !== "debug") return;

  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}`;
  if (extra !== undefined) {
    if (currentLevel() !== "debug" && level !== "error") {
      console.error(line);
      return;
    }
    const payload = extra instanceof Error ? { message: extra.message, stack: extra.stack } : extra;
    console.error(`${line} ${JSON.stringify(payload)}`);
    return;
  }
  if (level === "error" || level === "warn") {
    console.error(line);
    return;
  }
  console.error(line);
}

export const logger = {
  debug: (message: string, extra?: unknown) => write("debug", message, extra),
  info: (message: string, extra?: unknown) => write("info", message, extra),
  warn: (message: string, extra?: unknown) => write("warn", message, extra),
  error: (message: string, extra?: unknown) => write("error", message, extra),
};

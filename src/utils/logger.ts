type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  tool_name?: string;
  api_path?: string;
  duration_ms?: number;
  status?: number;
  [key: string]: unknown;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const envLevel = process.env.OMOPHUB_LOG_LEVEL;
const currentLevel: LogLevel = envLevel && envLevel in LOG_LEVELS ? (envLevel as LogLevel) : 'info';

function log(entry: LogEntry): void {
  if (LOG_LEVELS[entry.level] < LOG_LEVELS[currentLevel]) return;

  const timestamp = new Date().toISOString();
  const { level, message, ...fields } = entry;
  const extra = Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : '';

  // All logs to stderr — stdout is reserved for JSON-RPC in stdio mode
  process.stderr.write(`[${timestamp}] ${level.toUpperCase()} ${message}${extra}\n`);
}

export const logger = {
  debug: (message: string, fields?: Omit<LogEntry, 'level' | 'message'>) =>
    log({ level: 'debug', message, ...fields }),
  info: (message: string, fields?: Omit<LogEntry, 'level' | 'message'>) =>
    log({ level: 'info', message, ...fields }),
  warn: (message: string, fields?: Omit<LogEntry, 'level' | 'message'>) =>
    log({ level: 'warn', message, ...fields }),
  error: (message: string, fields?: Omit<LogEntry, 'level' | 'message'>) =>
    log({ level: 'error', message, ...fields }),
};

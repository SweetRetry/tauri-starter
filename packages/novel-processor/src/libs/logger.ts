import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

class Logger {
  private logDir: string
  private logFile: string
  private currentLevel: LogLevel = LogLevel.INFO

  constructor() {
    // 默认存放在 packages/novel-processor/logs 目录下
    this.logDir = join(process.cwd(), "logs")
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    this.logFile = join(this.logDir, `process_${timestamp}.log`)

    try {
      mkdirSync(this.logDir, { recursive: true })
    } catch (_e) {
      // 忽略目录已存在的错误
    }
  }

  setLevel(level: LogLevel) {
    this.currentLevel = level
  }

  private formatMessage(level: string, message: string): string {
    const ts = new Date().toISOString()
    return `[${ts}] [${level}] ${message}\n`
  }

  private log(level: LogLevel, levelName: string, message: string) {
    const formatted = this.formatMessage(levelName, message)

    // 始终写入文件 (同步写入以确保并行时不丢日志)
    try {
      appendFileSync(this.logFile, formatted, "utf-8")
    } catch (_e) {
      // 忽略文件写入错误
    }

    // 控制台输出控制：DEBUG 不输出，其他级别按 currentLevel 过滤
    if (level < this.currentLevel || level === LogLevel.DEBUG) return

    if (level === LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`)
    } else if (level === LogLevel.WARN) {
      console.warn(`[WARN] ${message}`)
    } else {
      // INFO 级别直接输出内容，保持整洁
      console.log(message)
    }
  }

  debug(message: string) {
    this.log(LogLevel.DEBUG, "DEBUG", message)
  }

  info(message: string) {
    this.log(LogLevel.INFO, "INFO", message)
  }

  warn(message: string) {
    this.log(LogLevel.WARN, "WARN", message)
  }

  error(message: string, error?: unknown) {
    const err = error instanceof Error ? error : (error as { message?: string; stack?: string })
    const msg = err ? `${message} | Error: ${err.message || String(err)}` : message
    this.log(LogLevel.ERROR, "ERROR", msg)
    if (err && "stack" in err && err.stack) {
      appendFileSync(this.logFile, `[STACK] ${err.stack}\n`, "utf-8")
    }
  }
}

export const logger = new Logger()

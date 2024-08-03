export enum LogLevel {
  DEBUG,
  INFO,
  WARN,
  ERROR,
  NONE,
}

let logLevel = LogLevel.INFO;

export function setLoggerLevel(level: LogLevel) {
  logLevel = level;
}

export default class Logger {
  private moduleName: string;
  constructor(moduleName: string) {
    this.moduleName = moduleName;
    this.error = this.error.bind(this);
    this.warn = this.warn.bind(this);
    this.log = this.log.bind(this);
    this.message = this.message.bind(this);
  }
  log(...args: unknown[]) {
    if (logLevel <= LogLevel.INFO)
      console.log(`Log on ${this.moduleName}:\n`, ...args);
  }
  warn(...args: unknown[]) {
    if (logLevel <= LogLevel.WARN)
      console.warn(`Warning on ${this.moduleName}:\n`, ...args);
  }
  error(...args: unknown[]) {
    if (logLevel <= LogLevel.ERROR)
      console.error(`Error on ${this.moduleName}:\n`, ...args);
  }
  message(...args: unknown[]) {
    console.log(`Message on ${this.moduleName}:\n`, ...args);
  }
}

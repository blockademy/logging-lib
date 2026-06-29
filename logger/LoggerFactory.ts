import { destination, Level, Logger as PinoLoggerImpl, pino } from 'pino';
import { pinoLambdaDestination, ILogFormatter, LogData } from 'pino-lambda';
import { pinoCaller } from 'pino-caller';
import { PinoPretty as pretty } from 'pino-pretty';
import { getLoggerPackage } from './PackageLoggers';

/**
 * Same line layout as pino-lambda's default CloudwatchLogFormatter
 * (`<time> <requestId> <LEVEL> <msg> <json>`) but omitting `msg` from the
 * trailing JSON payload, since it is already present in the text column.
 * This avoids logging the (often large) message twice on every log line.
 */
export class CloudwatchDedupedFormatter implements ILogFormatter {
    private static readonly LEVEL_LABELS: Record<number, string> = {
        10: 'TRACE',
        20: 'DEBUG',
        30: 'INFO',
        40: 'WARN',
        50: 'ERROR',
        60: 'FATAL',
    };

    private static formatLevel(level: string | number): string {
        return typeof level === 'number'
            ? (CloudwatchDedupedFormatter.LEVEL_LABELS[level] ?? String(level))
            : String(level).toUpperCase();
    }

    format(data: LogData): string {
        const { msg, ...rest } = data as LogData & Record<string, unknown>;
        const time = new Date().toISOString();
        const levelTag = CloudwatchDedupedFormatter.formatLevel(data.level);
        return `${time}${data.awsRequestId ? `\t${data.awsRequestId}` : ''}\t${levelTag}\t${msg ?? ''}\t${JSON.stringify(rest)}`;
    }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Logger {
    trace(msg?: string, ...args: any[]): void;
    trace(obj?: unknown, msg?: string, ...args: any[]): void;
    debug(msg?: string, ...args: any[]): void;
    debug(obj?: unknown, msg?: string, ...args: any[]): void;
    info(msg?: string, ...args: any[]): void;
    info(obj?: unknown, msg?: string, ...args: any[]): void;
    warn(msg?: string, ...args: any[]): void;
    warn(obj?: unknown, msg?: string, ...args: any[]): void;
    error(msg?: string, ...args: any[]): void;
    error(obj?: unknown, msg?: string, ...args: any[]): void;
    flush(): void;
}

class PinoLogger implements Logger {
    constructor(readonly pinoLogger: PinoLoggerImpl) {}

    trace(obj?: unknown, msg?: string, ...args: any[]): void {
        this.pinoLogger.trace(obj, msg, ...args);
    }

    debug(obj?: unknown, msg?: string, ...args: any[]): void {
        this.pinoLogger.debug(obj, msg, ...args);
    }

    info(obj?: unknown, msg?: string, ...args: any[]): void {
        this.pinoLogger.info(obj, msg, ...args);
    }

    warn(obj?: unknown, msg?: string, ...args: any[]): void {
        this.pinoLogger.warn(obj, msg, ...args);
    }

    error(obj?: unknown, msg?: string, ...args: any[]): void {
        this.pinoLogger.error(obj, msg, ...args);
    }

    flush = () => this.pinoLogger.flush();
}

export type LoggerOptions = {
    level?: Level;
    redact?: string[];
};

export interface LoggerManager {
    create(name: string, opts?: LoggerOptions): Logger;
    createRoot(name?: string): PinoLogger;
    addLevelMapping(name: string, level: Level | string): void;
    setLevel(name: string, level: Level | string): void;
    setChildrenLevel(name: string, level: Level | string): number;
}

export class DevLoggerManager implements LoggerManager {
    static readonly ROOT_LOGGER_NAME = '__ROOT__';
    private readonly rootLogger: PinoLogger;
    private levelMappings: { name: string; level: string }[] = [];
    private loggers: Map<string, PinoLogger> = new Map();
    constructor(
        private readonly defaultLevel: Level,
        private readonly logDestination: string | undefined,
        private readonly enablePretty: boolean,
        private readonly enableCaller: boolean,
        private readonly enablePackagePrefix: boolean,
    ) {
        this.rootLogger = this.createRoot(DevLoggerManager.ROOT_LOGGER_NAME);
    }

    setLevel(name: string, level: Level | string): void {
        if (this.isPrefixMatch(name)) {
            this.setChildrenLevel(name, level);
        } else {
            const logger = this.findLogger(name);
            if (logger) {
                logger.pinoLogger.level = level;
            }
        }
    }

    // TODO: watch out performance on large number of loggers
    setChildrenLevel(name: string, level: Level | string): number {
        const prefix = this.normalizePrefixMatch(name);
        const loggers = [...this.loggers.entries()].filter(([lgName]) => lgName.startsWith(prefix));
        loggers.forEach(([, lg]) => {
            lg.pinoLogger.level = level;
        });
        return loggers.length;
    }

    addLevelMapping(name: string, level: Level | string): void {
        this.levelMappings.push({ name, level });
        if (this.isPrefixMatch(name)) {
            this.setChildrenLevel(name, level);
        } else {
            this.setLevel(name, level);
        }
    }

    private isPrefixMatch(name: string): boolean {
        return name.endsWith('/*');
    }

    private normalizePrefixMatch(name: string): string {
        return name.endsWith('/*') ? name.slice(0, -1) : name.endsWith('/') ? name : `${name}/`;
    }

    private findLogger(name: string): PinoLogger | undefined {
        return this.loggers.get(name);
    }

    createRoot(name?: string): PinoLogger {
        let pinoLogger: PinoLoggerImpl;
        if (this.enablePretty) {
            const transport = pretty({
                minimumLevel: this.defaultLevel,
                colorize: true,
                sync: true,
                destination: this.logDestination,
            });
            pinoLogger = pino(transport);
        } else {
            pinoLogger = pino({ name: name }, destination(this.logDestination));
        }

        return new PinoLogger(
            this.enableCaller
                ? pinoCaller(pinoLogger, {
                      relativeTo: process.cwd(),
                      stackAdjustment: 1,
                  })
                : pinoLogger,
        );
    }

    private findMappingLevel(name: string): string | undefined {
        const mapping = this.levelMappings.find((e) => {
            if (e.name.endsWith('/*')) {
                return name.startsWith(e.name.slice(0, -1));
            }

            return e.name === name;
        });

        if (mapping) {
            return mapping.level;
        }

        return undefined;
    }

    create(name: string, opts?: LoggerOptions): Logger {
        let _rootLogger = this.rootLogger;
        if (this.enablePackagePrefix) {
            const packageLoggerAndName = this.getOrCreatePackageLogger();
            if (packageLoggerAndName) {
                const { logger: packageLogger, name: packageLoggerName } = packageLoggerAndName;
                name = `${packageLoggerName}/${name}`;
                _rootLogger = packageLogger;
            }
        }

        const level = opts?.level || this.findMappingLevel(name) || this.defaultLevel;

        const redactOpts = opts?.redact
            ? {
                  paths: opts?.redact,
                  remove: true,
              }
            : undefined;

        const pinoChildLogger = _rootLogger.pinoLogger.child(
            {
                name: name,
            },
            {
                level: level,
                redact: redactOpts,
            },
        );

        const newLogger = new PinoLogger(pinoChildLogger);
        this.loggers.set(name, newLogger);
        return newLogger;
    }

    private getOrCreatePackageLogger(): { logger: PinoLogger; name: string } | undefined {
        let packageName = getLoggerPackage();
        if (packageName?.startsWith('@') && packageName.includes('/')) {
            packageName = packageName.substring(packageName.indexOf('/') + 1);
            packageName = packageName.replaceAll('/', '_');
        }

        if (!packageName) return;

        // see if we need to create a new logger already
        let cachedLogger = this.findLogger(packageName);
        if (!cachedLogger) {
            cachedLogger = this.createRoot(packageName);
            this.loggers.set(packageName, cachedLogger);
        }
        return { logger: cachedLogger, name: packageName };
    }
}

export class LiveLoggerManager implements LoggerManager {
    readonly rootLogger: PinoLogger;
    constructor(private readonly defaultLevel: Level) {
        this.rootLogger = this.createRoot();
    }

    setLevel(): void {
        this.rootLogger.warn('Unexpected LoggerFactory setting - setLevel is not supported for LIVE loggers');
    }

    addLevelMapping(): void {
        this.rootLogger.warn('Unexpected LoggerFactory setting - addLevelMapping is not supported for LIVE loggers');
    }

    setChildrenLevel(): number {
        this.rootLogger.warn('Unexpected LoggerFactory setting - setLevelCascade is not supported for LIVE loggers');
        return -1;
    }

    createRoot(): PinoLogger {
        return new PinoLogger(
            pino({ level: this.defaultLevel }, pinoLambdaDestination({ formatter: new CloudwatchDedupedFormatter() })),
        );
    }

    create(name: string, opts?: LoggerOptions): Logger {
        const level = opts?.level || this.defaultLevel;

        const redactOpts = opts?.redact
            ? {
                  paths: opts?.redact,
                  remove: true,
              }
            : undefined;

        const pinoChildLogger = this.rootLogger.pinoLogger.child(
            {
                name: name,
            },
            {
                level: level,
                redact: redactOpts,
            },
        );

        return new PinoLogger(pinoChildLogger);
    }
}

export class LoggerFactory {
    private static manager = LoggerFactory.createManager();

    private static createManager(): LoggerManager {
        const devMode = process.env.NODE_ENV === 'development';
        const defaultLevel = (process.env['LOG_LEVEL'] || 'info') as Level;

        if (!devMode) {
            return new LiveLoggerManager(defaultLevel);
        } else {
            const enableCaller = process.env['LOG_CALLER'] === 'true';
            const enablePackagePrefix = process.env['LOG_PACKAGE'] !== 'false';
            const enablePretty =
                process.env['LOG_TRANSPORT'] === undefined || process.env['LOG_TRANSPORT'] === 'pretty';
            const destination: string | undefined = process.env['LOG_DESTINATION'];
            return new DevLoggerManager(defaultLevel, destination, enablePretty, enableCaller, enablePackagePrefix);
        }
    }

    static setLoggerManager(m: LoggerManager): void {
        if (process.env.NODE_ENV !== 'development') {
            throw new Error('LoggerFactory.setLoggerManager is only allowed in development mode');
        }
        LoggerFactory.manager = m;
    }

    static getLoggerManager(): LoggerManager {
        return LoggerFactory.manager;
    }

    static create(name: string, opts?: LoggerOptions): Logger {
        return LoggerFactory.manager.create(name, opts);
    }
}

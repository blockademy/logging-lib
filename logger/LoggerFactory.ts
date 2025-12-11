import {destination, Level, Logger as PinoLoggerImpl, pino} from 'pino';
import { pinoLambdaDestination } from 'pino-lambda';
import { pinoCaller } from 'pino-caller';
import { PinoPretty as pretty } from 'pino-pretty'
import {getLoggerPackage} from "./PackageLoggers";

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
    constructor(readonly pinoLogger: PinoLoggerImpl) { }

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
}

interface LoggerManager {
    rootLogger: Logger;
    create(name: string, opts?: LoggerOptions): Logger;
    createRoot(name?: string): PinoLogger;
    addLevelMapping(name: string, level: Level | string): void;
    setLevel(name: string, level: Level | string): void;
}

class DevLoggerManager implements LoggerManager {
    readonly rootLogger: PinoLogger;
    private levelMappings: { name: string; level: string }[] = [];
    private loggers: Map<string, PinoLogger> = new Map();
    constructor(
        private readonly defaultLevel: Level,
        private readonly logDestination: string | undefined,
        private readonly enablePretty: boolean,
        private readonly enableCaller: boolean,
        private readonly enablePackagePrefix: boolean,

    ) {
        this.rootLogger = this.createRoot()
    }

    setLevel(name: string, level: string): void {
        const logger = this.findLogger(name);
        if (logger) {
            logger.pinoLogger.level = level;
        }
    }

    addLevelMapping(name: string, level: Level): void {
        this.levelMappings.push({ name, level });
        this.setLevel(name, level);
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
                destination: this.logDestination
            });
            pinoLogger = pino(transport || destination(this.logDestination));
        } else {
            pinoLogger = pino({ name: name }, destination(this.logDestination));
        }

        return new PinoLogger(this.enableCaller ? pinoCaller(pinoLogger, { relativeTo: process.cwd(), stackAdjustment: 1 }) : pinoLogger);
    }

    create(name: string, opts?: LoggerOptions): Logger {
        let _rootLogger = this.rootLogger;
        if (this.enablePackagePrefix) {
            const { logger: packageLogger, name: packageLoggerName } = this.getOrCreatePackageLogger();
            name = `${packageLoggerName}/${name}`;
            _rootLogger = packageLogger;
        }

        const level = opts?.level || this.levelMappings.find((e) => e.name === name)?.level || this.defaultLevel;

        const redactOpts = opts?.redact ? {
            paths: opts?.redact,
            remove: true,
        } : undefined;

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


    getOrCreatePackageLogger(): { logger: PinoLogger, name: string } | undefined {
        let packageName = getLoggerPackage();
        if (packageName?.startsWith('@') && packageName.includes('/')) {
            packageName = packageName.substring(packageName.indexOf('/') + 1);
            packageName = packageName.replaceAll('/', '_');
        }

        // if we can't find a package name, just use the root logger
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

class LiveLoggerManager implements LoggerManager {
    readonly rootLogger: PinoLogger
    constructor(
        private readonly defaultLevel: Level,
    ) {
        this.rootLogger = this.createRoot();
    }

    setLevel(): void {
        this.rootLogger.warn('Unexpected LoggerFactory setting - setLevel is not supported for LIVE loggers');
    }

    addLevelMapping(): void {
        this.rootLogger.warn('Unexpected LoggerFactory setting - level mapping is not supported for LIVE loggers');
    }

    createRoot(): PinoLogger {
        return new PinoLogger(pino({ level: this.defaultLevel }, pinoLambdaDestination()));
    }

    create(name: string, opts?: LoggerOptions): Logger {
        const level = opts?.level || this.defaultLevel;

        const redactOpts = opts?.redact ? {
            paths: opts?.redact,
            remove: true,
        } : undefined;

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
    static readonly manager = LoggerFactory.createManager();

    private static createManager(): LoggerManager {
        const devMode = process.env.NODE_ENV === 'development';
        const defaultLevel = (process.env['LOG_LEVEL'] || 'info') as Level;
        if (!devMode) {
            return new LiveLoggerManager(defaultLevel);
        } else {
            const destination: string | undefined = process.env['LOG_DESTINATION'];
            return new DevLoggerManager(defaultLevel, destination, true, false, true);
        }
    }

    static addLevelMapping(name: string, level: Level | string): void {
        LoggerFactory.manager.addLevelMapping(name, level)
    }

    static setLevel(name: string, level: Level | string): void {
        LoggerFactory.manager.setLevel(name, level)
    }

    static create(name: string, opts?: LoggerOptions): Logger {
        return LoggerFactory.manager.create(name, opts);
    }
}

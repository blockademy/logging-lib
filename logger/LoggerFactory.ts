import { Level, Logger as PinoLoggerImpl, pino } from 'pino';
import { pinoLambdaDestination } from 'pino-lambda';
import { pinoCaller } from 'pino-caller';
import * as pretty from 'pino-pretty'

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Logger {
    trace(msg?: string, ...args: any[]): void;
    trace<T>(obj?: T, msg?: string, ...args: any[]): void;
    debug(msg?: string, ...args: any[]): void;
    debug<T>(obj?: T, msg?: string, ...args: any[]): void;
    info(msg?: string, ...args: any[]): void;
    info<T>(obj?: T, msg?: string, ...args: any[]): void;
    warn(msg?: string, ...args: any[]): void;
    warn<T>(obj?: T, msg?: string, ...args: any[]): void;
    error(msg?: string, ...args: any[]): void;
    error<T>(obj?: T, msg?: string, ...args: any[]): void;
    flush(): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
class PinoLogger implements Logger {
    constructor(readonly pinoLogger: PinoLoggerImpl) { }

    trace<T>(obj?: T, msg?: string, ...args: any[]): void {
        this.pinoLogger.trace(obj, msg, ...args);
    }

    debug<T>(obj?: T, msg?: string, ...args: any[]): void {
        this.pinoLogger.debug(obj, msg, ...args);
    }

    info<T>(obj?: T, msg?: string, ...args: any[]): void {
        this.pinoLogger.info(obj, msg, ...args);
    }

    warn<T>(obj?: T, msg?: string, ...args: any[]): void {
        this.pinoLogger.warn(obj, msg, ...args);
    }

    error<T>(obj?: T, msg?: string, ...args: any[]): void {
        this.pinoLogger.error(obj, msg, ...args);
    }

    flush = () => this.pinoLogger.flush();
}

export type LoggerOptions = {
    level?: Level;
    redact?: string[];
}

export class LoggerFactory {
    private static defaultLevel = (process.env['LOG_LEVEL'] || 'info') as Level;
    private static devMode = process.env.NODE_ENV === 'development';
    private static enablePretty = process.env['LOG_TRANSPORT'] === 'pretty' || this.devMode;
    private static enableCaller = !!process.env['LOG_CALLER'] || this.devMode;
    private static logDestination = process.env['LOG_DESTINATION'];

    private static _rootLogger: PinoLogger = this.createRoot();
    static rootLogger: Logger = this._rootLogger;

    private static levelMappings: { name: string; level: string }[] = [];

    static addLevelMapping(name: string, level: string): void {
        this.levelMappings.push({ name, level });
    }

    private static createRoot(): PinoLogger {
        if (this.devMode || this.enablePretty) {
            const pinoLogger = pino(pretty({
                minimumLevel: this.defaultLevel,
                colorize: true,
                sync: true,
                destination: this.logDestination,
            }));
            return new PinoLogger(this.enableCaller ? pinoCaller(pinoLogger, { relativeTo: process.cwd(), stackAdjustment: 1 }) : pinoLogger);
        } else {
            return new PinoLogger(pino({ level: this.defaultLevel }, pinoLambdaDestination()));
        }
    }

    static create(name: string, opts?: LoggerOptions): Logger {
        const level = opts?.level || LoggerFactory.levelMappings.find((e) => e.name === name)?.level || LoggerFactory.defaultLevel;

        const redactOpts = opts?.redact ? {
            paths: opts?.redact,
            remove: true,
        } : undefined;

        const pinoChildLogger = this._rootLogger.pinoLogger.child(
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

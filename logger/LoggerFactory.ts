import { Logger as PinoLoggerImpl, pino } from 'pino';
import { pinoLambdaDestination } from 'pino-lambda';
import { pinoCaller } from 'pino-caller';

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
}

export class LoggerFactory {
    private static defaultLevel = process.env['LOG_LEVEL'] || 'info';
    private static devMode = process.env.NODE_ENV === 'development';
    private static enablePretty = process.env['LOG_TRANSPORT'] === 'pretty' || this.devMode;
    private static enableCaller = !!process.env['LOG_CALLER'] || this.devMode;

    private static prettyTransportOptions = {
        target: 'pino-pretty',
        options: {
            colorize: true,
        },
    };

    private static _rootLogger: PinoLogger = this.createRoot();
    static rootLogger: Logger = this._rootLogger;

    private static levelMappings: { name: string; level: string }[] = [];

    static addLevelMapping(name: string, level: string): void {
        this.levelMappings.push({ name, level });
    }

    private static createRoot(): PinoLogger {
        let logger: PinoLogger;
        if (this.devMode || this.enablePretty) {
            // aka dev-mode - no lambda expected - just pretty print to stdout
            let pinoLogger = pino({
                level: this.defaultLevel,
                transport: LoggerFactory.prettyTransportOptions,
            });

            // we will never want to enable caller for non-dev
            if (this.enableCaller) {
                pinoLogger = pinoCaller(pinoLogger, { relativeTo: process.cwd(), stackAdjustment: 1 });
            }

            logger = new PinoLogger(pinoLogger);
        } else {
            // aka prod-mode - expected lambda runtime. Traces requests and format specifics for CloudWatch
            logger = new PinoLogger(pino({ level: this.defaultLevel }, pinoLambdaDestination()));
        }

        return logger;
    }

    static create(name: string): Logger {
        const level = LoggerFactory.levelMappings.find((e) => e.name === name)?.level || LoggerFactory.defaultLevel;

        const pinoChildLogger = this._rootLogger.pinoLogger.child(
            {
                name: name,
            },
            {
                level: level,
            },
        );

        return new PinoLogger(pinoChildLogger);
    }
}

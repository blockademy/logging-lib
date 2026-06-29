import { beforeEach, describe, it, jest, expect } from '@jest/globals';

import { mkdtempSync } from 'fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { CloudwatchDedupedFormatter, DevLoggerManager } from '../logger/LoggerFactory';

describe('CloudwatchDedupedFormatter', () => {
    const formatter = new CloudwatchDedupedFormatter();

    it('keeps msg in the text column but omits it from the JSON payload', () => {
        const output = formatter.format({
            awsRequestId: 'req-123',
            level: 20,
            msg: 'event: {"huge":"payload"}',
            name: 'OnCertificateChanged',
            foo: 'bar',
        } as never);

        const fields = output.split('\t');
        const json = JSON.parse(fields[fields.length - 1]);

        // text column still carries the message (4th field: time, reqId, LEVEL, msg)
        expect(fields[1]).toBe('req-123');
        expect(fields[2]).toBe('DEBUG');
        expect(fields[3]).toBe('event: {"huge":"payload"}');

        // ...but it is no longer duplicated inside the JSON payload
        expect(json.msg).toBeUndefined();

        // every other field is preserved
        expect(json.name).toBe('OnCertificateChanged');
        expect(json.foo).toBe('bar');
        expect(json.level).toBe(20);
    });

    it('omits the requestId tab when there is no awsRequestId', () => {
        const output = formatter.format({ level: 30, msg: 'hello' } as never);
        const fields = output.split('\t');

        // time, LEVEL, msg, json  -> no requestId field
        expect(fields[1]).toBe('INFO');
        expect(fields[2]).toBe('hello');
        expect(JSON.parse(fields[3]).msg).toBeUndefined();
    });
});

describe('LoggerFactory', () => {
    const oldEnv = { ...process.env };

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...oldEnv };
        process.env.LOG_TRANSPORT = 'pretty';
    });

    it('should log stuff with pretty', async () => {
        const logs = await testWithLogging('redaction', async () => {
            const module = await import('../logger/LoggerFactory');
            const logger = module.LoggerFactory.create('test-pretty');
            logger.info('test');
        });

        // pretty format has ansi colour codes and formatted segments
        const regex = /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-pretty\/[0-9]+\): \x1b\[36mtest\x1b\[39m/;

        expect(logs.trim()).toMatch(regex);
    });

    it('should log stuff with redaction', async () => {
        const logs = await testWithLogging('redaction', async () => {
            const module = await import('../logger/LoggerFactory');

            // same redact example as the one in Pino docs
            const logger = module.LoggerFactory.create('test-redact', {
                redact: ['key', 'path.to.key', 'stuff.thats[*].secret', 'path["with-hyphen"]'],
            });

            logger.info({
                key: 'redacted1',
                path: {
                    to: { key: 'redacted2', another: 'logged1' },
                },
                stuff: {
                    thats: [
                        { secret: 'redacted3', logme: 'logged2' },
                        { secret: 'redacted4', logme: 'logged3' },
                    ],
                },
            });
        });

        expect(logs).toContain('logged1');
        expect(logs).toContain('logged2');
        expect(logs).toContain('logged3');
        expect(logs).not.toContain('redacted1');
        expect(logs).not.toContain('redacted2');
        expect(logs).not.toContain('redacted3');
        expect(logs).not.toContain('redacted4');
    });

    it('should consider add-mapping', async () => {
        const logs = await testWithLogging('add-mapping', async () => {
            const module = await import('../logger/LoggerFactory');
            module.LoggerFactory.getLoggerManager().addLevelMapping('logging/test-mapping1', 'info');
            module.LoggerFactory.getLoggerManager().addLevelMapping('logging/test-mapping2', 'warn');

            const logger1 = module.LoggerFactory.create('test-mapping1');
            const logger2 = module.LoggerFactory.create('test-mapping2');

            logger1.info('logger1');
            logger2.info('logger2');
        });

        // pretty format has ansi colour codes and formatted segments
        const regex =
            /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-mapping1\/[0-9]+\): \x1b\[36mlogger1\x1b\[39m/;

        expect(logs.trim().split('\n')).toHaveLength(1);
        expect(logs.trim()).toMatch(regex);
    });

    it('should add-mapping for children', async () => {
        const logs = await testWithLogging('add-mapping-children', async () => {
            const module = await import('../logger/LoggerFactory');
            module.LoggerFactory.getLoggerManager().addLevelMapping('logging/*', 'warn');

            const logger1 = module.LoggerFactory.create('test-mapping1');
            const logger2 = module.LoggerFactory.create('test-mapping2');

            // all loggers were mapped to warn, info will not log
            logger1.info('logger1');
            logger2.info('logger2');
        });

        expect(logs).toBe('');
    });

    it('should support set-level', async () => {
        const logs = await testWithLogging('set-level', async () => {
            const module = await import('../logger/LoggerFactory');
            module.LoggerFactory.getLoggerManager().addLevelMapping('logging/test-mapping1', 'info');
            module.LoggerFactory.getLoggerManager().addLevelMapping('logging/test-mapping2', 'warn');

            // log with initial mapping info/warn - only first-logger1 should be logged
            const logger1 = module.LoggerFactory.create('test-mapping1');
            const logger2 = module.LoggerFactory.create('test-mapping2');
            logger1.info('first-logger1');
            logger2.info('first-logger2');

            // now log with altered level warn/info - only second-logger2 should be logged
            module.LoggerFactory.getLoggerManager().setLevel('logging/test-mapping1', 'warn');
            module.LoggerFactory.getLoggerManager().setLevel('logging/test-mapping2', 'info');
            logger1.info('second-logger1');
            logger2.info('second-logger2');
        });

        const lines = logs.trim().split('\n');
        // 2 lines - first-logger1 and second-logger2
        expect(lines).toHaveLength(2);

        // pretty format has ansi colour codes and formatted segments
        expect(lines[0]).toMatch(
            /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-mapping1\/[0-9]+\): \x1b\[36mfirst-logger1\x1b\[39m/,
        );
        expect(lines[1]).toMatch(
            /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-mapping2\/[0-9]+\): \x1b\[36msecond-logger2\x1b\[39m/,
        );
    });

    it('should support set-children-level', async () => {
        const logs = await testWithLogging('set-children-level', async () => {
            const module = await import('../logger/LoggerFactory');

            // log with the child (should be on info level by default)
            const loggerChild = module.LoggerFactory.create('test-child');
            loggerChild.info('logger-child-is-here');

            // now alter the parent level, see if it affects the child level
            // NOTE we know the parent is 'logging' because it will look up this library package.json name
            module.LoggerFactory.getLoggerManager().setChildrenLevel('logging', 'warn');
            loggerChild.info('logger-child-not-here');
        });

        const lines = logs.trim().split('\n');
        expect(lines).toHaveLength(1);

        // pretty format has ansi colour codes and formatted segments
        const regex =
            /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-child\/[0-9]+\): \x1b\[36mlogger-child-is-here\x1b\[39m/;
        expect(lines[0]).toMatch(regex);
    });

    it('should support programmatic customization', async () => {
        const logs = await testWithLogging('programmatic', async (dest) => {
            const lm = new DevLoggerManager('info', dest, true, false, true);
            const logger = lm.create('prog-logger', { level: 'warn' });
            logger.error('test-programmatic');
        });
        expect(logs).toContain('test-programmatic');
    });
});

async function testWithLogging(testName: string, thunk: (logDestination: string) => Promise<void>): Promise<string> {
    const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'LoggerFactory-test-'));
    const outputFile = path.join(tempDir, `test-logs-${testName}.log`);
    process.env.LOG_DESTINATION = outputFile;
    process.env.NODE_ENV = 'development';
    await thunk(outputFile);
    const logContents = await readFile(outputFile, 'utf-8');
    console.log(logContents);
    return logContents;
}

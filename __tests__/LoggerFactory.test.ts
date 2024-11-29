import { describe, it, beforeEach, jest } from '@jest/globals';

import {mkdtempSync} from "fs";
import {readFile} from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe('LoggerFactory', () => {

    const oldEnv = process.env;

    const tempDir: string = mkdtempSync(path.join(os.tmpdir(), 'LoggerFactory-test-'))

    beforeEach(() => {
        jest.resetModules()
        process.env = { ...oldEnv };
        process.env.LOG_TRANSPORT = 'pretty';
    });

    it('should log stuff with pretty', async () => {
        // the LOG_DESTINATION env-var allows us to write to a file
        const outputFile = path.join(tempDir, 'test-logs-with-pretty.log');
        process.env.LOG_DESTINATION = outputFile;

        const module = await import("../logger/LoggerFactory");
        const logger = module.LoggerFactory.create('test-pretty');
        logger.info('test');

        const fileContent = await readFile(outputFile, 'utf-8');
        expect(fileContent).toContain('test');
        expect(fileContent).toContain('INFO');
    })

    it('should log stuff with redaction', async () => {
        // the LOG_DESTINATION env-var allows us to write to a file
        const outputFile = path.join(tempDir, 'test-logs-with-redacted.log');
        process.env.LOG_DESTINATION = outputFile;

        const module = await import("../logger/LoggerFactory");

        // same redact example as the one in Pino docs
        const logger = module.LoggerFactory.create('test-redact', {
            redact: ['key', 'path.to.key', 'stuff.thats[*].secret', 'path["with-hyphen"]']
        });

        logger.info({
            key: 'will be redacted',
            path: {
                to: {key: 'sensitive', another: 'thing'}
            },
            stuff: {
                thats: [
                    {secret: 'will be redacted', logme: 'will be logged'},
                    {secret: 'also redacted', logme: 'will be logged'}
                ]
            }
        })

        const fileContent = await readFile(outputFile, 'utf-8');

        expect(fileContent).toContain('will be logged');
        expect(fileContent).not.toContain('will be redacted');
        expect(fileContent).not.toContain('sensitive');
        expect(fileContent).not.toContain('also redacted');
    })

});
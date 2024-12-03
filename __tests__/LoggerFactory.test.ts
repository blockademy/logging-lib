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
        console.log(fileContent);

        // pretty format has ansi colour codes and formatted segments
        const regex = /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(test-pretty\/[0-9]+\): \x1b\[36mtest\x1b\[39m/;

        expect(fileContent.trim()).toMatch(regex);
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
            key: 'redacted1',
            path: {
                to: {key: 'redacted2', another: 'logged1'}
            },
            stuff: {
                thats: [
                    {secret: 'redacted3', logme: 'logged2'},
                    {secret: 'redacted4', logme: 'logged3'}
                ]
            }
        })

        const fileContent = await readFile(outputFile, 'utf-8');
        console.log(fileContent);

        expect(fileContent).toContain('logged1');
        expect(fileContent).toContain('logged2');
        expect(fileContent).toContain('logged3');
        expect(fileContent).not.toContain('redacted1');
        expect(fileContent).not.toContain('redacted2');
        expect(fileContent).not.toContain('redacted3');
        expect(fileContent).not.toContain('redacted4');
    })

});
import { describe, it, beforeEach, jest } from "@jest/globals";

import { mkdtempSync } from "fs";
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

describe("LoggerFactory", () => {
  const oldEnv = { ...process.env };

  const tempDir: string = mkdtempSync(
    path.join(os.tmpdir(), "LoggerFactory-test-"),
  );

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...oldEnv };
    process.env.LOG_TRANSPORT = "pretty";
  });

  it("should log stuff with pretty", async () => {
    // the LOG_DESTINATION env-var allows us to write to a file
    const outputFile = path.join(tempDir, "test-logs-with-pretty.log");
    process.env.LOG_DESTINATION = outputFile;
    process.env.NODE_ENV = "development";

    const module = await import("../logger/LoggerFactory");
    const logger = module.LoggerFactory.create("test-pretty");
    logger.info("test");

    const fileContent = await readFile(outputFile, "utf-8");

    // pretty format has ansi colour codes and formatted segments
    const regex =
      /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-pretty\/[0-9]+\): \x1b\[36mtest\x1b\[39m/;

    expect(fileContent.trim()).toMatch(regex);
  });

  it("should log stuff with redaction", async () => {
    // the LOG_DESTINATION env-var allows us to write to a file
    const outputFile = path.join(tempDir, "test-logs-with-redacted.log");
    process.env.LOG_DESTINATION = outputFile;
    process.env.NODE_ENV = "development";

    const module = await import("../logger/LoggerFactory");

    // same redact example as the one in Pino docs
    const logger = module.LoggerFactory.create("test-redact", {
      redact: [
        "key",
        "path.to.key",
        "stuff.thats[*].secret",
        'path["with-hyphen"]',
      ],
    });

    logger.info({
      key: "redacted1",
      path: {
        to: { key: "redacted2", another: "logged1" },
      },
      stuff: {
        thats: [
          { secret: "redacted3", logme: "logged2" },
          { secret: "redacted4", logme: "logged3" },
        ],
      },
    });

    const fileContent = await readFile(outputFile, "utf-8");

    expect(fileContent).toContain("logged1");
    expect(fileContent).toContain("logged2");
    expect(fileContent).toContain("logged3");
    expect(fileContent).not.toContain("redacted1");
    expect(fileContent).not.toContain("redacted2");
    expect(fileContent).not.toContain("redacted3");
    expect(fileContent).not.toContain("redacted4");
  });

  it("should consider add-mapping", async () => {
    // the LOG_DESTINATION env-var allows us to write to a file
    const outputFile = path.join(tempDir, "test-logs-with-mapping.log");
    process.env.LOG_DESTINATION = outputFile;
    process.env.NODE_ENV = "development";

    const module = await import("../logger/LoggerFactory");
    module.LoggerFactory.addLevelMapping("logging/test-mapping1", "info");
    module.LoggerFactory.addLevelMapping("logging/test-mapping2", "warn");

    const logger1 = module.LoggerFactory.create("test-mapping1");
    const logger2 = module.LoggerFactory.create("test-mapping2");

    logger1.info("logger1");
    logger2.info("logger2");

    const fileContent = await readFile(outputFile, "utf-8");

    // pretty format has ansi colour codes and formatted segments
    const regex =
      /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-mapping1\/[0-9]+\): \x1b\[36mlogger1\x1b\[39m/;

    expect(fileContent.trim()).toMatch(regex);
  });

  it("should support set-level", async () => {
    // the LOG_DESTINATION env-var allows us to write to a file
    const outputFile = path.join(tempDir, "test-logs-with-set-level.log");
    process.env.LOG_DESTINATION = outputFile;
    process.env.NODE_ENV = "development";

    const module = await import("../logger/LoggerFactory");
    module.LoggerFactory.addLevelMapping("logging/test-mapping1", "info");
    module.LoggerFactory.addLevelMapping("logging/test-mapping2", "warn");

    // log with initial mapping info/warn - only first-logger1 should be logged
    const logger1 = module.LoggerFactory.create("test-mapping1");
    const logger2 = module.LoggerFactory.create("test-mapping2");
    logger1.info("first-logger1");
    logger2.info("first-logger2");

    // now log with altered level warn/info - only second-logger2 should be logged
    module.LoggerFactory.setLevel("logging/test-mapping1", "warn");
    module.LoggerFactory.setLevel("logging/test-mapping2", "info");
    logger1.info("second-logger1");
    logger2.info("second-logger2");

    const fileContent = await readFile(outputFile, "utf-8");

    const lines = fileContent.trim().split("\n");
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

  it("should support set-level on parent", async () => {
    // the LOG_DESTINATION env-var allows us to write to a file
    const outputFile = path.join(
      tempDir,
      "test-logs-with-set-level-parent.log",
    );
    process.env.LOG_DESTINATION = outputFile;
    process.env.NODE_ENV = "development";

    const module = await import("../logger/LoggerFactory");

    // log with the child (should be on info level by default)
    const loggerChild = module.LoggerFactory.create("test-child");
    loggerChild.info("logger-child-is-here");

    // now alter the parent level, see if it affects the child level
    // NOTE we know the parent is 'logging' because it will look up this library package.json name
    module.LoggerFactory.setLevel("logging/test-child", "warn");
    loggerChild.info("logger-child-not-here");

    const fileContent = await readFile(outputFile, "utf-8");

    const lines = fileContent.trim().split("\n");
    expect(lines).toHaveLength(1);

    // pretty format has ansi colour codes and formatted segments
    const regex =
      /\[[0-9:.]{12}] \x1b\[32mINFO\x1b\[39m \(logging\/test-child\/[0-9]+\): \x1b\[36mlogger-child-is-here\x1b\[39m/;
    expect(lines[0]).toMatch(regex);
  });
});

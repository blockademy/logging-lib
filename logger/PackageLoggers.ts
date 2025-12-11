import { fileURLToPath } from "url";
import * as path from "node:path";
import {existsSync, readFileSync} from "node:fs";

function getCallerFile(): string | undefined {
    const original = Error.prepareStackTrace;
    Error.prepareStackTrace = (_, stack) => stack;
    const err = new Error();
    const stack = err.stack as unknown as NodeJS.CallSite[];
    Error.prepareStackTrace = original;

    // start looking from latest which is first caller
    stack.reverse();

    // find the stack line that calls `LoggerFactory.create`
    const callerParent = stack.findIndex((e) => e.getFunctionName() === 'create' && e.getFileName().endsWith('LoggerFactory.ts'));
    const caller = stack[callerParent - 1];
    if (!caller) return;

    let fileName = caller.getFileName();
    if (!fileName) return;

    // Handle "file://" URLs from ESM
    if (fileName.startsWith("file://")) {
        fileName = fileURLToPath(fileName);
    }

    return fileName;
}

function findPackageRoot(startPath: string): string | undefined {
    let dir = path.dirname(startPath);
    while (dir !== path.dirname(dir)) {
        const pkg = path.join(dir, "package.json");
        if (existsSync(pkg)) return dir;
        dir = path.dirname(dir);
    }
    return undefined;
}

export function getLoggerPackage(): string | undefined {
    const file = getCallerFile();
    if (!file) return;

    const pkgRoot = findPackageRoot(file);
    if (!pkgRoot) return;

    try {
        const pkg = JSON.parse(readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
        return pkg.name ?? path.basename(pkgRoot);
    } catch {
        return path.basename(pkgRoot);
    }
}
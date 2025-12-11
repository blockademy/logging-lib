# Logging

This module implements a logging library used on all PoK services and internal libraries.

## API

- `LoggerFactory` object - single `create(name)` method

- `Logger` object:

```typescript
export interface Logger {
  debug(msg?: string, ...args: any[]): void;
  debug<T>(obj?: T, msg?: string, ...args: any[]): void;
  info(msg?: string, ...args: any[]): void;
  info<T>(obj?: T, msg?: string, ...args: any[]): void;
  warn(msg?: string, ...args: any[]): void;
  warn<T>(obj?: T, msg?: string, ...args: any[]): void;
  error(msg?: string, ...args: any[]): void;
  error<T>(obj?: T, msg?: string, ...args: any[]): void;
}
```

## Usage

1. Import the logging package

```typescript
import { LoggerFactory } from "@yopdev/logging";
```

2. Create a new `Logger` instance (ideally private to the component you'll be logging from)

```typescript
    logger = LoggerFactory.create(Config.name);
```

3. Log stuff

```typescript
    this.logger.info("Logging stuff will take you places, %s", name);
```

4. Redact sensitive data

```typescript
    logger = LoggerFactory.create(Module.name, {redact: ['key1', 'key2']});
```

5. Change the logging level for the new child logger

```typescript
    logger = LoggerFactory.create(Module.name, { level: 'info' });
```

## LoggerFactory methods

- `create(name: string, options?: { level?: string, redact?: string[] }): Logger`

To create a new logger instance.

- `addLevelMapping(name: string, level: string): void`

On initial setup, works on DEV mode only, to set the default logging level for a logger by name.

- `setLevel(name: string, level: string): void`

Works on DEV mode only, to change the logging level for a logger by name at runtime.

## Settings via env-vars

- `LOG_LEVEL`: Sets the root logging level (`debug`, `info`, `warn`, `error`)
- `LOG_TRANSPORT`: `pretty` is only supported for now. Uses the stdOut and colorizes output with a simple formatter. Enabled when running with `NODE_ENV === development`
- `LOG_CALLER`: Enables caller information in logs. Also enabled when running with `NODE_ENV === development`.
- `LOG_DESTINATION`: Changes the destination for the logs. Defaults to `stdout`. The value should be a path to a file. The file will be created if it doesn't exist.

**WARNING:**: There are no settings available to alter how we log in production. Prod-mode is our default logging strategy. Don't add these settings to production or pre-production environments as they will incurr in additional costs.

## Best practices

- Don't send unpredictable contents to the logger as objects. DON'T DO THIS:

```typescript
    const someObject: SomeTypeThatMayHoldLotsOfData = {}
    this.logger.info(someObject, "I'm logging this at the info level and serializing a huge object...");
```

- Choose the proper logging level.

  - Don't do INFO unless you're certain it's something you want logged every time in production.
  - Use WARN for potential errors, like things that you want to inform to the operations team but aren't necesarily errors.
  - Use ERROR for real errors. Make sure you're sending the Error object first! No need to use templates/interpolation, keep it clean.

- Send the right parameters to the logger (see Logging methods)

## Logging methods

### Templated string

Will log a string from a templated string (aka string#format).

```typescript
this.logger.info("a string %s, a number %d, an object %O", "one", 2, {
  one: 2,
  three: "four",
});
```

**NOTE:** You can still log serialized objects using one of `%j`, `%o` or `%O` placeholders, but keep in mind these will take a hit on performance and costs in production.

#### Placeholders

- `%s` - String.

- `%d` - Number (integer or floating point value) or BigInt.

- `%i` - Integer or BigInt.

- `%f` - Floating point value.

- `%j` - JSON. Replaced with the string '[Circular]' if the argument contains circular references.

- `%o` - Object. A string representation of an object with generic JavaScript object formatting. Similar to inspect() with options { showHidden: true, showProxy: true }. This will show the full object including non-enumerable properties and proxies.

- `%O` - Object. A string representation of an object with generic JavaScript object formatting. Similar to inspect() without options. This will show the full object not including non-enumerable properties and proxies.

### Message with _merged_ serialized object

Will log the same templated message, but will merge the given object into the resulting log NDJSON record.

```typescript
this.logger.info(authInfo, "User %s logged in succesfully", authInfo.username);
```

### References

See more docs on the underlying library we use for logging: https://getpino.io/#/

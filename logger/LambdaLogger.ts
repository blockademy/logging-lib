import { lambdaRequestTracker } from "pino-lambda";

export class LambdaLogger {
  static tracker = lambdaRequestTracker({});
  /* eslint-disable @typescript-eslint/no-explicit-any */
  static traceContext(event: any, context: any): void {
    LambdaLogger.tracker(event, context);
  }
}

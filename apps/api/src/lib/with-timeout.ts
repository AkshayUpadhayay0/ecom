export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Operation timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError if `promise` does not settle within `ms`. */
export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(ms));
    }, ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

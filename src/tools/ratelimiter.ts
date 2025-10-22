import Bottleneck from 'bottleneck';
import { env } from './config.js';

const limiters = new Map<string | number, Bottleneck>();

export function getLimiter(key: string | number) {
  if (!limiters.has(key)) {
    limiters.set(
      key,
      new Bottleneck({
        minTime: Math.ceil(60_000 / Math.max(1, env.RATE_LIMIT_RPM)),
        reservoir: env.RATE_LIMIT_RPM,
        reservoirRefreshAmount: env.RATE_LIMIT_RPM,
        reservoirRefreshInterval: 60_000
      })
    );
  }
  return limiters.get(key)!;
}

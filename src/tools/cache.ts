import NodeCache from 'node-cache';
import { env } from './config';

const cache = new NodeCache({ stdTTL: env.CACHE_TTL_SECONDS, checkperiod: env.CACHE_TTL_SECONDS });

export function cacheGet<T>(key: string): T | undefined {
  return cache.get<T>(key);
}
export function cacheSet<T>(key: string, value: T, ttl = env.CACHE_TTL_SECONDS) {
  cache.set(key, value, ttl);
}
export function cacheWrap<T>(key: string, loader: () => Promise<T>, ttl = env.CACHE_TTL_SECONDS) {
  const hit = cacheGet<T>(key);
  if (hit !== undefined) return Promise.resolve(hit);
  return loader().then((val) => {
    cacheSet(key, val, ttl);
    return val;
  });
}

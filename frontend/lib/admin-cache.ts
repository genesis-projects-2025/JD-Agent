/**
 * Enterprise Admin Client-Side Memory Cache.
 * Prevents full re-fetching and eliminates loading spinners when switching sidebar tabs.
 */

type CacheEntry<T> = {
  data: T;
  timestamp: number;
};

const cacheStore = new Map<string, CacheEntry<any>>();

/**
 * Retrieve cached data for an admin tab key if it exists.
 * Returns data immediately regardless of age to allow instant UI rendering.
 */
export function getAdminCache<T>(key: string): { data: T | null; isStale: boolean } {
  const entry = cacheStore.get(key);
  if (!entry) return { data: null, isStale: true };
  const isStale = Date.now() - entry.timestamp > 60_000; // 60 seconds TTL
  return { data: entry.data as T, isStale };
}

/**
 * Store updated admin tab data in the memory cache.
 */
export function setAdminCache<T>(key: string, data: T): void {
  cacheStore.set(key, { data, timestamp: Date.now() });
}

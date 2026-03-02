/**
 * Generic provider usage cache — the shared "core" logic.
 *
 * Every AI provider (Claude Code, Codex, Claude API, OpenAI API, …)
 * goes through this module so that error-resilience behaviour is
 * identical everywhere and only needs to be maintained once.
 */

export interface ProviderUsageCache<T extends { success: boolean }> {
  lastKnownUsage: T
  lastKnownAt: number   // timestamp (ms) when data was last successfully received
  isStale: boolean      // true when we are falling back to old data
}

/**
 * Resolve fresh provider data against a cache.
 *
 * - Fresh data is valid (`success: true`)  → update cache, return fresh.
 * - Fresh data has error (`success: false`) + cache exists → keep cached value, mark stale.
 * - Fresh data has error + no cache → pass the error through as-is.
 */
export function resolveProviderCache<T extends { success: boolean; error?: string | null }>(
  fresh: T,
  cache: ProviderUsageCache<T> | null,
  providerName: string
): { resolved: T; cache: ProviderUsageCache<T> | null } {
  if (fresh.success) {
    const newCache: ProviderUsageCache<T> = {
      lastKnownUsage: fresh,
      lastKnownAt: Date.now(),
      isStale: false
    }
    return { resolved: fresh, cache: newCache }
  }

  // Error → fall back to cached value if available
  if (cache && cache.lastKnownUsage.success) {
    const ageMinutes = Math.round((Date.now() - cache.lastKnownAt) / 60000)
    console.log(`MeterAI: ${providerName} fetch error, using cached value from ${ageMinutes} min ago`)
    return {
      resolved: cache.lastKnownUsage,
      cache: { ...cache, isStale: true }
    }
  }

  // No cache either → pass through the error as-is
  return { resolved: fresh, cache }
}

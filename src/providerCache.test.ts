import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resolveProviderCache, type ProviderUsageCache } from './providerCache'

// Minimal provider result type for testing
interface TestResult {
  success: boolean
  error?: string | null
  value?: number | null
}

const ok = (value: number): TestResult => ({ success: true, error: null, value })
const fail = (error: string): TestResult => ({ success: false, error, value: null })

function makeCache(result: TestResult, ageMs = 0): ProviderUsageCache<TestResult> {
  return {
    lastKnownUsage: result,
    lastKnownAt: Date.now() - ageMs,
    isStale: false
  }
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

// ─── CASE 1: Fresh data is valid, no cache ───
describe('fresh success, no cache', () => {
  it('returns fresh data and creates a new cache', () => {
    const fresh = ok(42)
    const { resolved, cache } = resolveProviderCache(fresh, null, 'Test')

    expect(resolved).toBe(fresh)
    expect(cache).not.toBeNull()
    expect(cache!.lastKnownUsage).toBe(fresh)
    expect(cache!.isStale).toBe(false)
  })
})

// ─── CASE 2: Fresh data is valid, cache exists ───
describe('fresh success, existing cache', () => {
  it('replaces old cache with fresh data', () => {
    const oldData = ok(10)
    const oldCache = makeCache(oldData, 60_000) // 1 minute ago
    const fresh = ok(75)

    const { resolved, cache } = resolveProviderCache(fresh, oldCache, 'Test')

    expect(resolved).toBe(fresh)
    expect(cache!.lastKnownUsage).toBe(fresh)
    expect(cache!.isStale).toBe(false)
  })
})

// ─── CASE 3: Fresh data has error, cache exists → RESILIENCE ───
describe('fresh error, existing cache (core resilience)', () => {
  it('returns cached data and marks as stale', () => {
    const oldData = ok(65)
    const oldCache = makeCache(oldData, 120_000) // 2 minutes ago
    const fresh = fail('API 500')

    const { resolved, cache } = resolveProviderCache(fresh, oldCache, 'Test')

    // Resolved value should be the old good data, NOT the error
    expect(resolved.success).toBe(true)
    expect(resolved.value).toBe(65)
    expect(resolved).toBe(oldCache.lastKnownUsage)

    // Cache should be marked stale
    expect(cache!.isStale).toBe(true)
    // Cache should still hold the original good data
    expect(cache!.lastKnownUsage.value).toBe(65)
  })

  it('logs a message with the provider name', () => {
    const oldCache = makeCache(ok(50))
    resolveProviderCache(fail('API 500'), oldCache, 'Claude')
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Claude'))
  })
})

// ─── CASE 4: Fresh data has error, NO cache ───
describe('fresh error, no cache', () => {
  it('passes the error through as-is', () => {
    const fresh = fail('API 500')
    const { resolved, cache } = resolveProviderCache(fresh, null, 'Test')

    expect(resolved).toBe(fresh)
    expect(resolved.success).toBe(false)
    expect(cache).toBeNull()
  })
})

// ─── CASE 5: Fresh data has error, cache also has error (stale error) ───
describe('fresh error, cache also contains an error', () => {
  it('does NOT fall back to a cached error — returns fresh error', () => {
    const oldError = fail('previous error')
    const oldCache = makeCache(oldError)
    const fresh = fail('new error')

    const { resolved } = resolveProviderCache(fresh, oldCache, 'Test')

    // Should NOT return cached error — only fall back to success data
    expect(resolved).toBe(fresh)
    expect(resolved.error).toBe('new error')
  })
})

// ─── CASE 6: Multiple consecutive errors → cache stays stable ───
describe('multiple consecutive errors', () => {
  it('keeps returning the same cached good data through repeated failures', () => {
    const goodData = ok(30)
    let cache: ProviderUsageCache<TestResult> | null = makeCache(goodData)

    // Simulate 5 consecutive API failures
    for (let i = 1; i <= 5; i++) {
      const { resolved, cache: newCache } = resolveProviderCache(
        fail(`API error #${i}`),
        cache,
        'Test'
      )

      expect(resolved.success).toBe(true)
      expect(resolved.value).toBe(30)
      expect(newCache!.isStale).toBe(true)
      cache = newCache
    }
  })
})

// ─── CASE 7: Recovery after errors → cache refreshes ───
describe('recovery after errors', () => {
  it('updates cache when API starts working again', () => {
    const goodData = ok(30)
    let cache: ProviderUsageCache<TestResult> | null = makeCache(goodData)

    // Error → stale
    const step1 = resolveProviderCache(fail('API 500'), cache, 'Test')
    expect(step1.cache!.isStale).toBe(true)
    cache = step1.cache

    // Recovery → fresh data replaces stale cache
    const step2 = resolveProviderCache(ok(80), cache, 'Test')
    expect(step2.resolved.success).toBe(true)
    expect(step2.resolved.value).toBe(80)
    expect(step2.cache!.isStale).toBe(false)
  })
})

// ─── CASE 8: success:true with error field set (edge case) ───
describe('success:true with error field (edge case)', () => {
  it('treats as valid data since success is true', () => {
    const fresh: TestResult = { success: true, error: 'partial warning', value: 50 }
    const { resolved, cache } = resolveProviderCache(fresh, null, 'Test')

    expect(resolved).toBe(fresh)
    expect(cache!.isStale).toBe(false)
  })
})

// ─── CASE 9: success:false with no error message ───
describe('success:false with undefined error', () => {
  it('falls back to cache if available', () => {
    const oldCache = makeCache(ok(40))
    const fresh: TestResult = { success: false, value: null }

    const { resolved } = resolveProviderCache(fresh, oldCache, 'Test')
    expect(resolved.success).toBe(true)
    expect(resolved.value).toBe(40)
  })
})

// ─── CASE 10: First-ever fetch fails (cold start) ───
describe('cold start failure', () => {
  it('returns the error since there is nothing to fall back to', () => {
    const fresh = fail('Network error')
    const { resolved, cache } = resolveProviderCache(fresh, null, 'Test')

    expect(resolved.success).toBe(false)
    expect(resolved.error).toBe('Network error')
    expect(cache).toBeNull()
  })
})

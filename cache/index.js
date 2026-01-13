/**
 * In-memory cache with TTL and version-based invalidation.
 * Reduces disk I/O for read-heavy endpoints.
 */

class DataCache {
    constructor() {
        this.cache = new Map();
        this.versions = new Map();

        // TTL configuration (in milliseconds)
        // Longer TTLs are safe because SSE pushes real-time updates to clients
        this.TTL = {
            raffles: 30000,   // 30 seconds (SSE handles immediate updates)
            rules: 300000,    // 5 minutes (rarely changes during event)
            sponsors: 300000  // 5 minutes (rarely changes during event)
        };
    }

    /**
     * Get cached data by key.
     * Returns null if not cached or expired.
     */
    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check TTL expiration
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.data;
    }

    /**
     * Get cached data with version info.
     * Returns { data, version } or null if not cached.
     */
    getWithVersion(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;

        // Check TTL expiration
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return { data: entry.data, version: entry.version };
    }

    /**
     * Set cached data with version.
     */
    set(key, data, version) {
        const ttl = this.TTL[key] || 5000;
        this.cache.set(key, {
            data,
            version,
            expiresAt: Date.now() + ttl,
            cachedAt: Date.now()
        });
        this.versions.set(key, version);
    }

    /**
     * Get the current cached version for a key.
     */
    getVersion(key) {
        return this.versions.get(key) || 0;
    }

    /**
     * Invalidate (delete) a specific cache entry.
     */
    invalidate(key) {
        this.cache.delete(key);
        this.versions.delete(key);
    }

    /**
     * Invalidate all cache entries.
     */
    invalidateAll() {
        this.cache.clear();
        this.versions.clear();
    }

    /**
     * Get cache statistics for monitoring.
     */
    getStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                expiredEntries++;
            } else {
                validEntries++;
            }
        }

        return {
            validEntries,
            expiredEntries,
            totalEntries: this.cache.size,
            keys: Array.from(this.cache.keys())
        };
    }

    /**
     * Clean up expired entries (called periodically).
     */
    cleanup() {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
            }
        }
    }
}

// Singleton instance
const cache = new DataCache();

// Periodic cleanup every 5 minutes
setInterval(() => {
    cache.cleanup();
}, 5 * 60 * 1000);

module.exports = cache;

import { Image } from 'react-native';

/**
 * Avatar Cache Service
 * 
 * Lightweight service to track and prefetch user avatars.
 * Uses React Native's Image.prefetch() which automatically handles disk caching.
 * 
 * Features:
 * - Tracks which avatars have been prefetched (in-memory Set)
 * - Prefetches avatars when conversations are loaded
 * - Handles prefetch errors gracefully
 * - Limits concurrent prefetches to avoid overwhelming the network
 */

class AvatarCacheService {
  private prefetchedUrls = new Set<string>();
  private prefetchingUrls = new Set<string>();
  private readonly MAX_CONCURRENT_PREFETCHES = 5;

  /**
   * Prefetch a single avatar image
   * @param url - The avatar image URL to prefetch
   */
  async prefetchAvatar(url: string | null): Promise<void> {
    if (!url || !url.trim()) {
      return; // Skip null/empty URLs
    }

    const normalizedUrl = url.trim();

    // Skip if already prefetched or currently prefetching
    if (this.prefetchedUrls.has(normalizedUrl) || this.prefetchingUrls.has(normalizedUrl)) {
      return;
    }

    try {
      this.prefetchingUrls.add(normalizedUrl);
      
      // Use React Native's Image.prefetch() which automatically caches to disk
      await Image.prefetch(normalizedUrl);
      
      // Mark as prefetched
      this.prefetchedUrls.add(normalizedUrl);
      
      if (__DEV__) {
        console.log(`[AvatarCacheService] ✅ Prefetched avatar: ${normalizedUrl}`);
      }
    } catch (error) {
      // Log error but don't throw - prefetch failures shouldn't break the app
      if (__DEV__) {
        console.warn(`[AvatarCacheService] ⚠️ Failed to prefetch avatar: ${normalizedUrl}`, error);
      }
    } finally {
      this.prefetchingUrls.delete(normalizedUrl);
    }
  }

  /**
   * Batch prefetch multiple avatars with concurrency control
   * @param urls - Array of avatar image URLs to prefetch
   */
  async prefetchAvatars(urls: (string | null)[]): Promise<void> {
    // Filter out null/empty URLs and normalize
    const validUrls = urls
      .filter((url): url is string => !!url && url.trim() !== '')
      .map(url => url.trim())
      .filter(url => !this.prefetchedUrls.has(url) && !this.prefetchingUrls.has(url));

    if (validUrls.length === 0) {
      return; // Nothing to prefetch
    }

    if (__DEV__) {
      console.log(`[AvatarCacheService] 📥 Prefetching ${validUrls.length} avatars (max ${this.MAX_CONCURRENT_PREFETCHES} concurrent)`);
    }

    // Process in batches to limit concurrency
    for (let i = 0; i < validUrls.length; i += this.MAX_CONCURRENT_PREFETCHES) {
      const batch = validUrls.slice(i, i + this.MAX_CONCURRENT_PREFETCHES);
      
      // Prefetch batch in parallel
      const prefetchPromises = batch.map(url => this.prefetchAvatar(url));
      
      // Use allSettled to handle errors gracefully (don't fail entire batch if one fails)
      await Promise.allSettled(prefetchPromises);
    }

    if (__DEV__) {
      console.log(`[AvatarCacheService] ✅ Completed prefetching ${validUrls.length} avatars`);
    }
  }

  /**
   * Check if an avatar URL has been prefetched
   * @param url - The avatar image URL to check
   * @returns true if the avatar has been prefetched
   */
  isPrefetched(url: string | null): boolean {
    if (!url || !url.trim()) {
      return false;
    }
    return this.prefetchedUrls.has(url.trim());
  }

  /**
   * Clear the cache (useful for testing or memory management)
   * Note: This only clears the in-memory tracking, not the actual disk cache
   */
  clearCache(): void {
    this.prefetchedUrls.clear();
    this.prefetchingUrls.clear();
    if (__DEV__) {
      console.log('[AvatarCacheService] 🗑️ Cleared avatar cache tracking');
    }
  }

  /**
   * Get the number of prefetched avatars (for debugging)
   */
  getCacheSize(): number {
    return this.prefetchedUrls.size;
  }
}

// Export singleton instance
export const avatarCacheService = new AvatarCacheService();


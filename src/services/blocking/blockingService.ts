import { supabase } from '../../config/supabase';

class BlockingService {
  private blockedIds: Set<string> = new Set();
  private blockedByIds: Set<string> = new Set();
  private loaded = false;

  /**
   * Load both directions of blocks for the current user.
   * Call once on app init / session restore.
   */
  async loadBlocks(): Promise<void> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      this.blockedIds.clear();
      this.blockedByIds.clear();
      this.loaded = false;
      return;
    }

    // Users I've blocked
    const { data: myBlocks, error: e1 } = await supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', user.id);

    if (!e1 && myBlocks) {
      this.blockedIds = new Set(myBlocks.map(r => r.blocked_id));
    }

    // Users who've blocked me (uses RPC to bypass RLS)
    const { data: blockedByData, error: e2 } = await supabase.rpc('get_blocked_by_ids');

    if (!e2 && blockedByData) {
      this.blockedByIds = new Set(blockedByData as string[]);
    }

    this.loaded = true;
    console.log(`[BlockingService] Loaded ${this.blockedIds.size} blocked, ${this.blockedByIds.size} blocked-by`);
  }

  /**
   * Block a user. Returns true on success.
   */
  async blockUser(blockedId: string): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase
      .from('user_blocks')
      .insert({ blocker_id: user.id, blocked_id: blockedId });

    if (error) {
      // Duplicate block is fine (unique constraint)
      if (error.code === '23505') {
        console.log('[BlockingService] User already blocked');
        this.blockedIds.add(blockedId);
        return true;
      }
      console.error('[BlockingService] Error blocking user:', error);
      return false;
    }

    this.blockedIds.add(blockedId);
    console.log(`[BlockingService] Blocked user ${blockedId}`);
    return true;
  }

  /**
   * Unblock a user. Returns true on success.
   */
  async unblockUser(blockedId: string): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { error } = await supabase
      .from('user_blocks')
      .delete()
      .eq('blocker_id', user.id)
      .eq('blocked_id', blockedId);

    if (error) {
      console.error('[BlockingService] Error unblocking user:', error);
      return false;
    }

    this.blockedIds.delete(blockedId);
    console.log(`[BlockingService] Unblocked user ${blockedId}`);
    return true;
  }

  /**
   * Check if a user is blocked by the current user.
   */
  isBlocked(userId: string): boolean {
    return this.blockedIds.has(userId);
  }

  /**
   * Get all blocked user IDs (for filtering).
   */
  getBlockedIds(): string[] {
    return Array.from(this.blockedIds);
  }

  /**
   * Get all blocked IDs as a Set (for fast lookups in filters).
   */
  getBlockedIdsSet(): Set<string> {
    return this.blockedIds;
  }

  /**
   * Get all hidden user IDs — both users I blocked AND users who blocked me.
   * Use this for conversation/matching filtering (bidirectional hide).
   */
  getAllHiddenIdsSet(): Set<string> {
    if (this.blockedByIds.size === 0) return this.blockedIds;
    const combined = new Set(this.blockedIds);
    this.blockedByIds.forEach(id => combined.add(id));
    return combined;
  }

  /**
   * Clear all cached data (on logout).
   */
  clear(): void {
    this.blockedIds.clear();
    this.blockedByIds.clear();
    this.loaded = false;
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

export const blockingService = new BlockingService();

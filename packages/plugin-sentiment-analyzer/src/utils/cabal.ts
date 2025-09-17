import { logger } from '@elizaos/core';

/**
 * CABAL utility functions for identifying and marking CABAL members
 */

// Cache for parsed CABAL usernames
let cabalUsernames: Set<string> | null = null;

/**
 * Parse and cache CABAL usernames from environment variable
 */
function loadCabalUsernames(): Set<string> {
  if (cabalUsernames !== null) {
    return cabalUsernames;
  }

  const cabalEnv = process.env.SENTIMENT_X_USERNAMES_CABAL;
  
  if (!cabalEnv) {
    logger.debug('[CABAL] No SENTIMENT_X_USERNAMES_CABAL environment variable found');
    cabalUsernames = new Set<string>();
    return cabalUsernames;
  }

  // Parse comma-separated usernames and normalize to lowercase
  const usernames = cabalEnv
    .split(',')
    .map(username => username.trim().toLowerCase())
    .filter(username => username.length > 0);

  cabalUsernames = new Set(usernames);
  logger.info(`[CABAL] Loaded ${cabalUsernames.size} CABAL members from environment`);
  
  return cabalUsernames;
}

/**
 * Check if a username is a CABAL member
 * @param username The username to check (case-insensitive)
 * @returns true if the username is in the CABAL list
 */
export function isCabalMember(username: string): boolean {
  if (!username) return false;
  
  const cabal = loadCabalUsernames();
  return cabal.has(username.toLowerCase());
}

/**
 * Format a username with CABAL markers if they are a member
 * @param username The username to format
 * @param includeAt Whether to include the @ symbol (default: true)
 * @returns Formatted username with ⭐ markers if CABAL member
 */
export function formatUsernameWithCabal(username: string, includeAt: boolean = true): string {
  if (!username) return '';
  
  const baseUsername = includeAt ? `@${username}` : username;
  
  if (isCabalMember(username)) {
    return `⭐ ${baseUsername} ⭐`;
  }
  
  return baseUsername;
}

/**
 * Get all CABAL usernames
 * @returns Set of CABAL usernames (lowercase)
 */
export function getCabalUsernames(): Set<string> {
  return loadCabalUsernames();
}

/**
 * Filter a list of items to only include CABAL members
 * @param items Array of items with username property
 * @returns Filtered array containing only CABAL members
 */
export function filterCabalMembers<T extends { username: string }>(items: T[]): T[] {
  const cabal = loadCabalUsernames();
  
  if (cabal.size === 0) {
    return [];
  }
  
  return items.filter(item => cabal.has(item.username.toLowerCase()));
}
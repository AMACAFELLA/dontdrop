/**
 * Constants for Redis keys used throughout the application.
 */
export const REDIS_KEYS = {
  LEADERBOARD_GLOBAL: 'dontdrop:leaderboard:global:v1', // Renamed for clarity
  LEADERBOARD_SUBREDDIT_PREFIX: 'dontdrop:leaderboard:subreddit:v1:', // Prefix for per-subreddit leaderboards
  USERNAME_BY_T2: 'dontdrop:username_by_t2:v1', // Map user ID (t2) to username
  WEEKLY_JOB: 'dontdrop:weekly_job_id:v1',
  USER_PREFIX: 'dontdrop:user:v1:', // Prefix for user hash data (consider removing if not needed)
  CUSTOM_WEAPONS: 'dontdrop:custom_weapons:v1',
  CUSTOM_BALLS: 'dontdrop:custom_balls:v1'
} as const; // Use 'as const' for stricter typing

/**
 * Number of top players to display on the leaderboard.
 */
export const TOP_PLAYERS_COUNT = 10;

// Add other shared constants here if needed
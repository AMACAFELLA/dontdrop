import type { Devvit, ZMember, RedisClient } from "@devvit/public-api";
import { REDIS_KEYS, TOP_PLAYERS_COUNT } from '../constants.js'; // Use .js extension
import type { LeaderboardEntry } from '../message.js'; // Use .js extension

// Define a type for the context needed by the service
type LeaderboardContext = {
  redis: RedisClient;
};

// Define a type for the Redis zRange result with scores
type RedisZRangeResult = {
  member: string;
  score: number;
};

export class LeaderboardService {
  private readonly redis: RedisClient;

  constructor(context: LeaderboardContext) {
    this.redis = context.redis;
  }

  /**
   * Updates a player's score on the global leaderboard.
   * Only updates if the new score is higher than the existing score.
   * Stores the username separately for reliable lookup.
   */
  async updateScore(
    username: string,
    score: number,
    t2: string // User ID
  ): Promise<boolean> {
    try {
      console.log(`Updating score for user ${username} (t2: ${t2}) with score: ${score}`);

      // Store username separately for reliable lookup using t2
      await this.redis.set(`${REDIS_KEYS.USERNAME_BY_T2}:${t2}`, username);
      console.log(`Stored username ${username} for t2: ${t2}`);

      // Check existing global score
      const existingGlobalScore = await this.redis.zScore(REDIS_KEYS.LEADERBOARD_GLOBAL, t2);
      console.log(`Existing global score for ${username} (t2: ${t2}): ${existingGlobalScore}`);

      // Update if new score is higher or no existing score
      const shouldUpdateGlobal = !existingGlobalScore || score > existingGlobalScore;

      if (shouldUpdateGlobal) {
        console.log(`Updating global leaderboard score for ${username} (t2: ${t2}) to ${score}`);
        await this.redis.zAdd(REDIS_KEYS.LEADERBOARD_GLOBAL, { score, member: t2 });
        return true; // Score was updated
      } else {
        console.log(`New score ${score} is not higher than existing score ${existingGlobalScore}. No update needed.`);
        return false; // Score was not updated
      }
    } catch (error) {
      console.error("Error updating leaderboard score:", error);
      // Consider how to handle errors, maybe rethrow or return false
      // For now, log and return false
      return false;
    }
  }

  /**
   * Retrieves the username associated with a user ID (t2).
   */
  private async getUsername(t2: string): Promise<string | null> {
    try {
      const username = await this.redis.get(`${REDIS_KEYS.USERNAME_BY_T2}:${t2}`);
      if (!username) { // Handle undefined case
        console.warn(`Username not found for t2: ${t2}`);
        return null; // Return null if undefined
      }
      return username;
    } catch (error) {
      console.error(`Error getting username for t2 ${t2}:`, error);
      return null; // Return null on error
    }
  }

  /**
   * Fetches the global leaderboard entries.
   */
  async getGlobalLeaderboard(
    count: number = TOP_PLAYERS_COUNT
  ): Promise<LeaderboardEntry[]> {
    console.log(`Fetching global leaderboard (Top ${count})`);
    try {
      // Fetch top entries (t2 IDs and scores) from the global sorted set
      // Fetch top entries (t2 IDs and scores) from the global sorted set
      // Fetch top entries (t2 IDs and scores) from the global sorted set
      // Devvit's zRange with withScores returns an array of { member: string; score: number }
      // Explicitly type the options and the expected result
      const zRangeOptions = {
        withScores: true,
        reverse: true, // Highest score first
      };
      // Cast to unknown first to satisfy TypeScript when the library types might be slightly off
      const results = (await this.redis.zRange(
          REDIS_KEYS.LEADERBOARD_GLOBAL, 0, count - 1, zRangeOptions as any
      )) as unknown as RedisZRangeResult[]; // Use the defined type

      console.log("Raw Redis results (object array):", results);

      if (!results || results.length === 0) {
        console.log("No scores found for global leaderboard");
        return [];
      }

      // Extract t2 IDs and create a map for quick score lookup
      const t2ToScoreMap = new Map<string, number>();
      const t2Keys: string[] = [];
      for (const result of results) {
          if (typeof result.member === 'string' && typeof result.score === 'number') {
              t2Keys.push(`${REDIS_KEYS.USERNAME_BY_T2}:${result.member}`);
              t2ToScoreMap.set(result.member, result.score);
          } else {
              console.warn(`Skipping invalid raw entry:`, result);
          }
      }

      if (t2Keys.length === 0) {
          console.log("No valid t2 IDs found after filtering raw results.");
          return [];
      }

      // Fetch all usernames in one MGET call
      console.log(`Fetching usernames for ${t2Keys.length} t2 keys...`);
      // Pass the array directly, not using spread syntax
      const usernames = await this.redis.mget(t2Keys);
      console.log("Usernames fetched:", usernames);

      // Map results to LeaderboardEntry
      const leaderboardEntries: LeaderboardEntry[] = [];
      let rank = 1;
      for (let i = 0; i < results.length; i++) {
          const t2 = results[i].member;
          const score = t2ToScoreMap.get(t2); // Get score from map
          // The username corresponds to the t2 key at the same index in t2Keys
          const username = usernames[i];

          // Ensure we have valid data before proceeding
          if (typeof t2 === 'string' && typeof score === 'number' && username) {
              leaderboardEntries.push({
                  username: username,
                  score: score,
                  rank: rank++, // Assign rank based on the original sorted order
                  createdAt: new Date().toISOString(), // Placeholder timestamp
                  updatedAt: new Date().toISOString(), // Placeholder timestamp
              });
          } else {
              console.warn(`Skipping entry for t2 ${t2}: Username (${username}) or score (${score}) invalid/missing.`);
          }
      }

      console.log("Processed leaderboard entries:", leaderboardEntries);
      return leaderboardEntries;

    } catch (error) {
      console.error('Error fetching global leaderboard entries:', error);
      return []; // Return empty array on error
    }
  }

  /**
   * Clears the global leaderboard data.
   * NOTE: This function cannot clear individual username lookup keys (`USERNAME_BY_T2:*`)
   * because the Devvit RedisClient does not support the SCAN command needed to find them.
   * USE WITH CAUTION!
   */
  async clearAllLeaderboardData(): Promise<boolean> {
    try {
      console.warn("Attempting to clear global leaderboard data...");

      // Only delete the global leaderboard key
      const keysToDelete = [REDIS_KEYS.LEADERBOARD_GLOBAL];

      if (keysToDelete.length > 0) {
        await this.redis.del(...keysToDelete);
        console.log(`Cleared global leaderboard key: ${REDIS_KEYS.LEADERBOARD_GLOBAL}`);
      } else {
         // This case should theoretically not happen if REDIS_KEYS.LEADERBOARD_GLOBAL is defined
         console.log("Global leaderboard key constant is missing?");
      }

      console.warn("Individual username lookup keys were NOT cleared due to Redis client limitations (SCAN command unavailable).");

      return true;
    } catch (error) {
      console.error("Error clearing global leaderboard data:", error);
      return false;
    }
  }
}
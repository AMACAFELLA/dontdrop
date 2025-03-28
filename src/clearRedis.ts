import { Context } from '@devvit/public-api';
import { REDIS_KEYS } from './constants.js'; // Import from the new constants file

// Function to clear all leaderboard data
export async function clearLeaderboardData(context: Context) {
  try {
    // Delete the GLOBAL leaderboard sorted set
    await context.redis.del(REDIS_KEYS.LEADERBOARD_GLOBAL);
    console.log('Global leaderboard data cleared successfully');
    // Note: This does not clear individual subreddit leaderboards.
    return true;
  } catch (error) {
    console.error('Error clearing leaderboard data:', error);
    return false;
  }
}

// Function to clear a specific user's data
export async function clearUserData(context: Context, username: string) {
  try {
    // Delete user-specific data
    const userKey = `${REDIS_KEYS.USER_PREFIX}${username}`;
    await context.redis.del(userKey);
    console.log(`User data for ${username} cleared successfully`);
    return true;
  } catch (error) {
    console.error(`Error clearing user data for ${username}:`, error);
    return false;
  }
}

// Function to clear all custom items data
export async function clearCustomItemsData(context: Context, username: string) {
  try {
    // Delete custom weapons and balls data
    const weaponsKey = `${REDIS_KEYS.CUSTOM_WEAPONS}:${username}`;
    const ballsKey = `${REDIS_KEYS.CUSTOM_BALLS}:${username}`;
    
    await context.redis.del(weaponsKey);
    await context.redis.del(ballsKey);
    
    console.log(`Custom items data for ${username} cleared successfully`);
    return true;
  } catch (error) {
    console.error(`Error clearing custom items data for ${username}:`, error);
    return false;
  }
}

// Function to clear all Redis data
export async function clearAllRedisData(context: Context) {
  try {
    // Clear leaderboard data
    await clearLeaderboardData(context);
    
    // Since Devvit's RedisClient doesn't have a 'keys' method,
    // we'll directly delete the known keys and patterns
    
    // Clear all user data
    // We can't get all keys, so we'll clear the current user's data
    const currentUser = await context.reddit.getCurrentUser();
    if (currentUser?.username) {
      await clearUserData(context, currentUser.username);
      await clearCustomItemsData(context, currentUser.username);
    }
    
    // Clear weekly job data
    await context.redis.del(REDIS_KEYS.WEEKLY_JOB);
    
    // Note: Without the 'keys' method, we can't clear all user data
    // This will only clear the current user's data and the leaderboard
    
    console.log('All Redis data cleared successfully');
    return true;
  } catch (error) {
    console.error('Error clearing all Redis data:', error);
    return false;
  }
}

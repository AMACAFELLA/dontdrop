import { Devvit } from "@devvit/public-api";
import { ZRangeOptions } from "@devvit/public-api";

export interface ExtendedZRangeOptions extends ZRangeOptions {
   withScores?: boolean;
}

export interface RedisZRangeResult {
   member: string;
   score: number;
}

export async function checkRedisConnectivity(context: Devvit.Context): Promise<boolean> {
  try {
    const testKey = 'connectivity_test';
    const testValue = Date.now().toString();
    
    // Try to write
    await context.redis.set(testKey, testValue);
    
    // Try to read
    const readValue = await context.redis.get(testKey);
    
    // Clean up
    await context.redis.del(testKey);
    
    // Check if read matches write
    return readValue === testValue;
  } catch (error) {
    console.error('Redis connectivity test failed:', error);
    return false;
  }
}

export async function waitForRedisConnection(
  context: Devvit.Context,
  maxAttempts = 3,
  delayMs = 1000
): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await checkRedisConnectivity(context)) {
      return true;
    }
    if (attempt < maxAttempts - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  return false;
}
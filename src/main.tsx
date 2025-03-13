import { Devvit, useWebView } from '@devvit/public-api';
import type { WebViewMessage, DevvitMessage } from './message.js';
import { LoadingAnimation } from './components/LoadingAnimation.js';
import { checkRedisConnectivity, waitForRedisConnection, ExtendedZRangeOptions, RedisZRangeResult } from './redis.js';

interface GameState {
  score: number;
  timestamp: number;
}

interface ErrorMetrics {
  errorCount: number;
  lastError: string;
  lastErrorTime: number;
}

const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second
const ERROR_METRICS_KEY = 'error_metrics';
const LEADERBOARD_KEY = 'dontdrop:leaderboard';

async function recordError(context: Devvit.Context, error: Error) {
  try {
    const metricsJson = await context.redis.get(ERROR_METRICS_KEY);
    const metrics: ErrorMetrics = metricsJson ? JSON.parse(metricsJson) : {
      errorCount: 0,
      lastError: '',
      lastErrorTime: 0
    };

    metrics.errorCount++;
    metrics.lastError = error.message;
    metrics.lastErrorTime = Date.now();

    await context.redis.set(ERROR_METRICS_KEY, JSON.stringify(metrics));
  } catch (e) {
    console.error('Failed to record error metrics:', e);
  }
}

async function retryOperation<T>(
  operation: () => Promise<T>, 
  context: Devvit.Context,
  maxAttempts = MAX_RETRY_ATTEMPTS
): Promise<T> {
  let lastError;
  
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (error instanceof Error) {
        await recordError(context, error);
      }
      if (attempt < maxAttempts - 1) {
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }
  
  throw lastError;
}

Devvit.configure({
  redditAPI: true,
  redis: true
});

const DontDropGame = ({ context }: { context: Devvit.Context }) => {
  const { mount } = useWebView({
    url: 'page.html',
    onMessage: async (message: WebViewMessage, hook) => {
      // Check Redis connectivity first
      if (!await waitForRedisConnection(context)) {
        hook.postMessage({
          type: 'devvit-message',
          data: {
            message: {
              type: 'error',
              data: { message: 'Game service currently unavailable. Please try again later.' }
            }
          }
        });
        return;
      }

      try {
        let highScoreKey = 'dontdrop:global:highscore';
        let username = 'Guest';
        try {
          const subreddit = await context.reddit.getCurrentSubreddit();
          if (subreddit?.name) {
            highScoreKey = `dontdrop:${subreddit.name}:highscore`;
          }
          username = (await context.reddit.getCurrentUser())?.username ?? 'Guest';
        } catch (error) {
          console.error('Failed to get subreddit or username:', error);
        }

        switch (message.type) {
          case 'webViewReady': {
            const score = await retryOperation(async () => {
              return await context.redis.get(highScoreKey);
            }, context);
            
            const highScore = parseInt(score ?? '0', 10);
            
            hook.postMessage({
              type: 'devvit-message',
              data: {
                message: {
                  type: 'initialData',
                  data: { 
                    username, 
                    highScore 
                  }
                }
              }
            });
            break;
          }
          
          case 'updateScore': {
            try {
              await retryOperation(async () => {
                await context.redis.set(
                  `${highScoreKey}:state`,
                  JSON.stringify({
                    score: message.data.score,
                    timestamp: Date.now()
                  } as GameState)
                );
                await context.redis.expire(`${highScoreKey}:state`, 3600);
              }, context);
            } catch (error) {
              console.error('Failed to save game state:', error);
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'error',
                    data: { message: 'Failed to save game state. Your score will be saved when connection is restored.' }
                  }
                }
              });
            }
            break;
          }
          
          case 'gameOver': {
            await retryOperation(async () => {
              await context.redis.del(`${highScoreKey}:state`);
            }, context);
            
            try {
              const currentHighScore = parseInt(
                await retryOperation(async () => {
                  return (await context.redis.get(highScoreKey)) ?? '0'
                }, context), 
                10
              );

              const finalScore = message.data.finalScore;

              // Always update leaderboard first
              await retryOperation(async () => {
                await context.redis.zAdd(LEADERBOARD_KEY, {
                  score: finalScore,
                  member: username
                });
              }, context);

              // Update high score if beaten
              if (finalScore > currentHighScore) {
                await retryOperation(async () => {
                  await context.redis.set(highScoreKey, finalScore.toString());
                }, context);
                
                hook.postMessage({
                  type: 'devvit-message',
                  data: {
                    message: {
                      type: 'updateHighScore',
                      data: { highScore: finalScore }
                    }
                  }
                });
              }

              // Get updated leaderboard
              const leaderboard = await retryOperation(async () => {
                // Get top 10 scores descending
                return await context.redis.zRange(LEADERBOARD_KEY, 0, 9, { 
                  withScores: true,
                  reverse: true 
                } as ExtendedZRangeOptions) as RedisZRangeResult[];
              }, context);

              // Transform leaderboard data into JSON-compatible format
              const formattedLeaderboard = leaderboard.map(entry => ({
                member: entry.member,
                score: entry.score
              }));

              // Send leaderboard update
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'updateLeaderboard',
                    data: { leaderboard: formattedLeaderboard }
                  }
                }
              });

            } catch (error) {
              console.error('Failed to update score:', error);
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'error',
                    data: { message: 'Failed to update score. Your score will be saved when connection is restored.' }
                  }
                }
              });
            }
            break;
          }

          default: {
            const exhaustiveCheck: never = message;
            console.warn('Unknown message type:', exhaustiveCheck);
            break;
          }
        }
      } catch (error) {
        console.error('Error handling message:', error);
        
        // Check if Redis is still connected
        const isRedisConnected = await checkRedisConnectivity(context);
        const errorMessage = isRedisConnected 
          ? 'Failed to process game action' 
          : 'Lost connection to game service. Your progress will be saved when connection is restored.';
        
        context.ui.showToast(errorMessage);
        
        try {
          hook.postMessage({
            type: 'devvit-message',
            data: {
              message: {
                type: 'error',
                data: { message: errorMessage }
              }
            }
          });
        } catch (e) {
          console.error('Failed to send error message to webview:', e);
        }
      }
    },
    onUnmount: () => {
      context.ui.showToast('Game closed');
    }
  });

  return (
    <vstack>
      <button onPress={async () => {
        // Verify Redis connection before launching game
        if (await waitForRedisConnection(context)) {
          mount();
        } else {
          context.ui.showToast('Game service currently unavailable. Please try again later.');
        }
      }}>Play Don't Drop</button>
    </vstack>
  );
};

// Add custom post type for the game
Devvit.addCustomPostType({
  name: "DontDrop",
  render: (context) => <DontDropGame context={context} />,
  height: "tall"
});

// Add menu item to create game posts
Devvit.addMenuItem({
  label: "Create Don't Drop Game",
  location: "subreddit",
  onPress: async (event, context) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const post = await context.reddit.submitPost({
        title: "Play Don't Drop - Test Your Reflexes!",
        subredditName: subreddit.name,
        preview: <LoadingAnimation />,
        kind: "image",
        url: "https://placeholder.com/game-preview.png"
      });

      context.ui.showToast('Game post created!');
      context.ui.navigateTo(post);
    } catch (error) {
      console.error('Error creating game post:', error);
      context.ui.showToast('Failed to create game post');
    }
  }
});

export default Devvit;
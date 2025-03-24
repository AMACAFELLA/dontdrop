import { Devvit, useWebView, Context } from '@devvit/public-api';
import type { WebViewMessage, DevvitMessage, LeaderboardEntry, CustomItemData } from './message.ts';
import { LoadingAnimation } from './components/LoadingAnimation.js';

// Constants for Redis keys
const REDIS_KEYS = {
  LEADERBOARD: 'dontdrop:leaderboard:v1',
  WEEKLY_JOB: 'dontdrop:weekly_job_id:v1',
  USER_PREFIX: 'dontdrop:user:v1:',
  CUSTOM_WEAPONS: 'dontdrop:custom_weapons:v1',
  CUSTOM_BALLS: 'dontdrop:custom_balls:v1'
} as const;

// Update configuration with required permissions
Devvit.configure({
  redditAPI: true,
  redis: true,
  realtime: true,
  media: true // Add media permission for image uploads
});

const TOP_PLAYERS_COUNT = 10;

const DontDropGame = ({ context }: { context: Devvit.Context }) => {
  const { mount } = useWebView({
    url: 'page.html',
    onMessage: async (message: WebViewMessage, hook) => {
      try {
        switch (message.type) {
          case 'webViewReady': {
            // Get the current Reddit username
            const currentUser = await context.reddit.getCurrentUser();
            const username = currentUser?.username || 'Guest';
            
            // Get leaderboard data using Redis
            const leaderboardEntries = await context.redis.zRange(REDIS_KEYS.LEADERBOARD, 0, TOP_PLAYERS_COUNT - 1, {
              reverse: true,
              by: "rank"
            });

            const entries: LeaderboardEntry[] = [];
            if (leaderboardEntries) {
              for (let i = 0; i < leaderboardEntries.length; i++) {
                const entry = leaderboardEntries[i];
                const userKey = `${REDIS_KEYS.USER_PREFIX}${entry.member}`;
                const userData = await context.redis.hgetall(userKey);
                
                entries.push({
                  username: entry.member,
                  score: entry.score,
                  rank: i + 1,
                  createdAt: userData?.createdAt || new Date().toISOString(),
                  updatedAt: userData?.updatedAt || new Date().toISOString()
                });
              }
            }

            // Send initial data to webview
            hook.postMessage({
              type: 'devvit-message',
              data: {
                message: {
                  type: 'initialData',
                  data: { username, leaderboard: entries }
                }
              }
            });
            break;
          }

          case 'gameOver': {
            const { finalScore } = message.data;
            const currentUser = await context.reddit.getCurrentUser();
            const username = currentUser?.username;

            if (username && finalScore > 0) {
              // Update Redis leaderboard
              const currentScore = await context.redis.zScore(REDIS_KEYS.LEADERBOARD, username);
              if (!currentScore || finalScore > currentScore) {
                // Get previous top 5 before updating
                const previousTop5 = await context.redis.zRange(REDIS_KEYS.LEADERBOARD, 0, 4, {
                  reverse: true,
                  by: "rank"
                });

                // Update the score
                await context.redis.zAdd(REDIS_KEYS.LEADERBOARD, { 
                  member: username, 
                  score: finalScore 
                });

                // Get new top 5 after updating
                const newTop5 = await context.redis.zRange(REDIS_KEYS.LEADERBOARD, 0, 4, {
                  reverse: true,
                  by: "rank"
                });

                // Find player's new rank in top 5
                const playerRank = newTop5.findIndex(entry => entry.member === username) + 1;
                
                // If player made it into top 5, schedule announcement
                if (playerRank > 0 && playerRank <= 5) {
                  // Find who they replaced (if anyone)
                  let previousPlayer = null;
                  if (previousTop5 && previousTop5.length >= playerRank) {
                    const replacedEntry = previousTop5[playerRank - 1];
                    if (replacedEntry && replacedEntry.member !== username) {
                      previousPlayer = {
                        username: replacedEntry.member,
                        score: replacedEntry.score
                      };
                    }
                  }

                  // Schedule the announcement post
                  await context.scheduler.runJob({
                    name: 'announce_top_player',
                    data: {
                      username,
                      score: finalScore,
                      rank: playerRank,
                      previousPlayer
                    },
                    runAt: new Date() // Run immediately
                  });
                }

                // Update user data
                const userKey = `${REDIS_KEYS.USER_PREFIX}${username}`;
                const now = new Date().toISOString();
                
                const userData = await context.redis.hgetall(userKey);
                if (!userData) {
                  // First time user
                  await context.redis.hset(userKey, {
                    username,
                    score: finalScore.toString(),
                    createdAt: now,
                    updatedAt: now
                  });
                } else {
                  // Update existing user
                  await context.redis.hset(userKey, {
                    score: finalScore.toString(),
                    updatedAt: now
                  });
                }

                // Get updated leaderboard
                const updatedEntries = await context.redis.zRange(REDIS_KEYS.LEADERBOARD, 0, TOP_PLAYERS_COUNT - 1, {
                  reverse: true,
                  by: "rank"
                });

                const leaderboard: LeaderboardEntry[] = [];
                if (updatedEntries) {
                  for (let i = 0; i < updatedEntries.length; i++) {
                    const entry = updatedEntries[i];
                    const userKey = `${REDIS_KEYS.USER_PREFIX}${entry.member}`;
                    const userData = await context.redis.hgetall(userKey);
                    
                    leaderboard.push({
                      username: entry.member,
                      score: entry.score,
                      rank: i + 1,
                      createdAt: userData?.createdAt || now,
                      updatedAt: userData?.updatedAt || now
                    });
                  }
                }

                // Send updated leaderboard to webview
                hook.postMessage({
                  type: 'devvit-message',
                  data: {
                    message: {
                      type: 'gameOverAck',
                      data: {
                        success: true,
                        username,
                        leaderboard
                      }
                    }
                  }
                });
              }
            }
            break;
          }

          case 'getLeaderboard': {
            const entries = await context.redis.zRange(REDIS_KEYS.LEADERBOARD, 0, TOP_PLAYERS_COUNT - 1, {
              reverse: true,
              by: "rank"
            });

            const leaderboard: LeaderboardEntry[] = [];
            if (entries) {
              for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const userKey = `${REDIS_KEYS.USER_PREFIX}${entry.member}`;
                const userData = await context.redis.hgetall(userKey);

                leaderboard.push({
                  username: entry.member,
                  score: entry.score,
                  rank: i + 1,
                  createdAt: userData?.createdAt || new Date().toISOString(),
                  updatedAt: userData?.updatedAt || new Date().toISOString()
                });
              }
            }

            hook.postMessage({
              type: 'devvit-message',
              data: {
                message: {
                  type: 'leaderboardData',
                  data: { leaderboard }
                }
              }
            });
            break;
          }

          case 'fetchCustomWeapons':
          case 'requestCustomItems': {
            try {
              // Get current user
              const currentUser = await context.reddit.getCurrentUser();
              const username = currentUser?.username;

              if (!username) {
                throw new Error('User not authenticated');
              }

              // Get custom weapons for the user
              const customWeaponsKey = `${REDIS_KEYS.CUSTOM_WEAPONS}:${username}`;
              const customWeaponsData = await context.redis.hgetall(customWeaponsKey);

              // Get custom balls for the user
              const customBallsKey = `${REDIS_KEYS.CUSTOM_BALLS}:${username}`;
              const customBallsData = await context.redis.hgetall(customBallsKey);

              // Parse the weapons data
              const weapons: CustomItemData[] = [];
              if (customWeaponsData && customWeaponsData.weapons) {
                try {
                  const parsedWeapons = JSON.parse(customWeaponsData.weapons);
                  if (Array.isArray(parsedWeapons)) {
                    weapons.push(...parsedWeapons);
                  }
                } catch (e) {
                  console.error('Error parsing custom weapons:', e);
                }
              }

              // Parse the balls data
              const balls: CustomItemData[] = [];
              if (customBallsData && customBallsData.balls) {
                try {
                  const parsedBalls = JSON.parse(customBallsData.balls);
                  if (Array.isArray(parsedBalls)) {
                    balls.push(...parsedBalls);
                  }
                } catch (e) {
                  console.error('Error parsing custom balls:', e);
                }
              }

              // Send the custom items data to the client
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'customWeaponsData',
                    data: {
                      weapon: weapons,
                      ball: balls
                    }
                  }
                }
              });
            } catch (error) {
              console.error('Error fetching custom items:', error);
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'error',
                    data: {
                      message: 'Failed to fetch custom items',
                      details: error instanceof Error ? error.message : String(error)
                    }
                  }
                }
              });
            }
            break;
          }

          case 'requestImageUpload': {
            try {
              const { itemType } = message.data;
          
              if (itemType !== 'weapon' && itemType !== 'ball') {
                throw new Error('Unsupported item type');
              }
          
              // Get current user
              const currentUser = await context.reddit.getCurrentUser();
              const username = currentUser?.username;
          
              if (!username) {
                throw new Error('User not authenticated');
              }
          
              // Instead of generating an upload URL, we need to inform the client
              // that they should provide a URL to an existing image
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'requestImageUrl',
                    data: {
                      itemType
                    }
                  }
                }
              });
            } catch (error) {
              console.error('Error requesting image upload:', error);
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'error',
                    data: {
                      message: 'Failed to request image upload',
                      details: error instanceof Error ? error.message : String(error)
                    }
                  }
                }
              });
            }
            break;
          }
          
          case 'uploadImage': {
            try {
              const { imageUrl, itemType, itemName } = message.data;

              if (!imageUrl || !itemType || !itemName) {
                throw new Error('Missing required data for image upload');
              }

              // Get current user
              const currentUser = await context.reddit.getCurrentUser();
              const username = currentUser?.username;

              if (!username) {
                throw new Error('User not authenticated');
              }

              // Upload the image to Reddit's media service
              const response = await context.media.upload({
                url: imageUrl,
                type: 'image'
              });

              // Create the new item with the Reddit media URL
              const newItem: CustomItemData = {
                imageUrl: response.mediaUrl, // Use the URL returned by Reddit
                name: itemName,
                createdAt: new Date().toISOString()
              };

              if (itemType === 'weapon') {
                // Store the custom weapon in Redis
                const customWeaponsKey = `${REDIS_KEYS.CUSTOM_WEAPONS}:${username}`;
                const customWeaponsData = await context.redis.hgetall(customWeaponsKey);

                let weapons: CustomItemData[] = [];

                if (customWeaponsData && customWeaponsData.weapons) {
                  try {
                    const parsedWeapons = JSON.parse(customWeaponsData.weapons);
                    if (Array.isArray(parsedWeapons)) {
                      weapons = parsedWeapons;
                    }
                  } catch (e) {
                    console.error('Error parsing custom weapons:', e);
                  }
                }

                weapons.push(newItem);

                // Save back to Redis
                await context.redis.hset(customWeaponsKey, {
                  weapons: JSON.stringify(weapons)
                });
              } else if (itemType === 'ball') {
                // Store the custom ball in Redis
                const customBallsKey = `${REDIS_KEYS.CUSTOM_BALLS}:${username}`;
                const customBallsData = await context.redis.hgetall(customBallsKey);

                let balls: CustomItemData[] = [];

                if (customBallsData && customBallsData.balls) {
                  try {
                    const parsedBalls = JSON.parse(customBallsData.balls);
                    if (Array.isArray(parsedBalls)) {
                      balls = parsedBalls;
                    }
                  } catch (e) {
                    console.error('Error parsing custom balls:', e);
                  }
                }

                balls.push(newItem);

                // Save back to Redis
                await context.redis.hset(customBallsKey, {
                  balls: JSON.stringify(balls)
                });
              }

              // Notify the client that the upload is complete
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'uploadComplete',
                    data: {
                      imageUrl: response.mediaUrl,
                      itemType,
                      itemName
                    }
                  }
                }
              });
            } catch (error) {
              console.error('Error uploading image:', error);
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'error',
                    data: {
                      message: 'Failed to upload image',
                      details: error instanceof Error ? error.message : String(error)
                    }
                  }
                }
              });
            }
            break;
          }
        }
      } catch (error) {
        console.error('Error handling message:', error);
        hook.postMessage({
          type: 'devvit-message',
          data: {
            message: {
              type: 'error',
              data: { 
                message: 'Failed to process game action',
                details: error instanceof Error ? error.message : String(error)
              }
            }
          }
        });
      }
    }
  });

  return (
    <vstack>
      <button onPress={() => mount()}>Play Don't Drop</button>
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

// Weekly leaderboard update scheduler job
Devvit.addSchedulerJob({
  name: 'weekly_leaderboard_update',
  onRun: async (_, context) => {
    try {
      // Get top 10 players from Redis
      const leaderboardEntries = await context.redis.zRange('leaderboard', 0, 9, {
        reverse: true,
        by: 'rank'
      });
      
      // Format and post the leaderboard
      const formattedEntries = leaderboardEntries.map(entry => ({
        member: entry.member,
        score: entry.score
      }));
      
      const leaderboardData = encodeURIComponent(JSON.stringify(formattedEntries));
      const subreddit = await context.reddit.getCurrentSubreddit();
      
      await context.reddit.submitPost({
        title: `📊 Weekly Don't Drop Leaderboard Update - Top Players 🏆`,
        subredditName: subreddit.name,
        preview: (
          <blocks height="tall">
            <webview url={`https://raw.githubusercontent.com/AMACAFELLA/dontdrop/main/webroot/leaderboard.html?data=${leaderboardData}`} />
          </blocks>
        ),
      });
    } catch (error) {
      console.error('Error posting weekly leaderboard:', error);
    }
  }
});

// Top 5 player announcement types and functions
type TopPlayerData = {
  username: string;
  score: number;
  rank: number;
  previousPlayer?: {
    username: string;
    score: number;
  };
};

// Scheduler job to announce new top 5 player
Devvit.addSchedulerJob({
  name: 'announce_top_player',
  onRun: async (event, context) => {
    try {
      const data = event.data as TopPlayerData;
      const playerData = encodeURIComponent(JSON.stringify(data));
      const subreddit = await context.reddit.getCurrentSubreddit();
      
      await context.reddit.submitPost({
        title: `🎮 ${data.username} just reached #${data.rank} on Don't Drop! 🏆`,
        subredditName: subreddit.name,
        preview: (
          <blocks height="regular">
            <webview url={`https://raw.githubusercontent.com//dontdrop/main/webroot/top-player.html?data=${playerData}`} />
          </blocks>
        ),
      });
      
      console.log(`Posted announcement for ${data.username} reaching rank ${data.rank}`);
    } catch (error) {
      console.error('Error posting top player announcement:', error);
    }
  },
});

// Set up weekly leaderboard post schedule
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_, context) => {
    const jobId = await context.scheduler.runJob({
      cron: '0 0 * * 0', // Every Sunday at midnight
      name: 'weekly_leaderboard_update',
      data: {},
    });
    await context.redis.set('weeklyLeaderboardJobId', jobId);
  },
});

// Helper function to announce top players
export async function announceTopPlayer(
  context: Context,
  username: string, 
  score: number, 
  rank: number, 
  previousPlayer?: { username: string; score: number }
) {
  // Create a data object that doesn't include previousPlayer if it's undefined
  const jobData: {
    username: string;
    score: number;
    rank: number;
    previousPlayer?: { username: string; score: number };
  } = {
    username,
    score,
    rank
  };
  
  // Only add previousPlayer if it exists
  if (previousPlayer) {
    jobData.previousPlayer = previousPlayer;
  }
  
  await context.scheduler.runJob({
    name: 'announce_top_player',
    data: jobData,
    runAt: new Date()
  });
}


export default Devvit;
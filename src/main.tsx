import { Devvit, useWebView, Context, useChannel, RedisClient, useState } from '@devvit/public-api';
import type { WebViewMessage, LeaderboardEntry, CustomItemData } from './message.js'; // Use .js extension
import { LoadingAnimation } from './components/LoadingAnimation.js';
import { clearLeaderboardData, clearUserData, clearCustomItemsData, clearAllRedisData } from './clearRedis.js';
import { REDIS_KEYS, TOP_PLAYERS_COUNT } from './constants.js'; // Import constants
import { LeaderboardService } from './services/leaderboardService.js'; // Import the new service

// Update configuration with required permissions
Devvit.configure({
  redditAPI: true,
  redis: true,
  realtime: true,
  media: true // Add media permission for image uploads
});

// Define a type that includes just what you need for the service
type LeaderboardContext = {
  redis: RedisClient;
};

const DontDropGame = ({ context }: { context: Devvit.Context }) => {
  // Instantiate the LeaderboardService
  const leaderboardService = new LeaderboardService(context);

  const { mount, postMessage } = useWebView({
    url: 'page.html',
    onMessage: async (message: WebViewMessage, hook) => {
      try {
        switch (message.type) {
          case 'webViewReady': {
            // Get the current Reddit user
            const currentUser = await context.reddit.getCurrentUser();
            const username = currentUser?.username || 'Guest';
            // const subreddit = await context.reddit.getCurrentSubreddit(); // Subreddit context not needed for global leaderboard
            // const subredditName = subreddit?.name || 'unknown_subreddit';

            // Get initial global leaderboard data using the service
            const entries = await leaderboardService.getGlobalLeaderboard(TOP_PLAYERS_COUNT);

            // Send initial data to webview
            hook.postMessage({
              type: 'devvit-message',
              data: {
                message: {
                  type: 'initialData',
                  // Pass username and the global leaderboard
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
            const t2 = currentUser?.id; // Get user ID (t2)

            if (username && t2 && finalScore > 0) {
              console.log(`Game over for ${username} (t2: ${t2}) with score: ${finalScore}`);

              // Get previous global top 5 before updating (for announcement logic)
              const previousGlobalTop5 = await leaderboardService.getGlobalLeaderboard(5);

              // Update the score using the service
              const scoreUpdated = await leaderboardService.updateScore(username, finalScore, t2);

              if (scoreUpdated) {
                console.log(`Score updated successfully for ${username}. Fetching new leaderboard.`);

                // Get the NEW updated global leaderboard
                const updatedLeaderboard = await leaderboardService.getGlobalLeaderboard(TOP_PLAYERS_COUNT);

                // --- Announcement Logic ---
                // Get new GLOBAL top 5 after updating
                const newGlobalTop5 = updatedLeaderboard.slice(0, 5);

                // Find player's new rank in GLOBAL top 5
                const playerRank = newGlobalTop5.findIndex(entry => entry.username === username) + 1;

                // If player made it into GLOBAL top 5, schedule announcement
                if (playerRank > 0 && playerRank <= 5) {
                  // Find who they replaced (if anyone) from the previous GLOBAL top 5
                  let previousPlayerInfo = null;
                  if (previousGlobalTop5 && previousGlobalTop5.length >= playerRank) {
                    const replacedEntry = previousGlobalTop5[playerRank - 1];
                    // Check if the player at the rank before update is different from the current player
                    if (replacedEntry && replacedEntry.username !== username) {
                      previousPlayerInfo = {
                        username: replacedEntry.username,
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
                      previousPlayer: previousPlayerInfo // Pass the potentially replaced player's info
                    },
                    runAt: new Date() // Run immediately
                  });
                  console.log(`Scheduled announcement for ${username} reaching rank ${playerRank}`);
                }
                // --- End Announcement Logic ---

                // Acknowledge successful score update to the specific client
                 hook.postMessage({
                   type: 'devvit-message',
                   data: {
                     message: {
                       type: 'gameOverAck',
                       data: {
                         success: true, // Score was updated
                         username
                         // No need to send leaderboard here, it will come via realtime
                       }
                     }
                   }
                 });

                // Broadcast the FULL updated leaderboard to ALL clients via realtime
                context.realtime.send('leaderboard_updates', updatedLeaderboard);
                console.log("Broadcasted updated leaderboard via realtime channel.");

              } else {
                console.log(`Score for ${username} was not updated (likely not a high score).`);
                // Optionally send an ack without leaderboard update if needed
                hook.postMessage({
                  type: 'devvit-message',
                  data: {
                    message: {
                      type: 'gameOverAck',
                      data: {
                        success: false, // Indicate score wasn't updated
                        username,
                        leaderboard: await leaderboardService.getGlobalLeaderboard(TOP_PLAYERS_COUNT) // Send current leaderboard
                      }
                    }
                  }
                });
              }
            } else {
              console.warn("Game over message received but user/score invalid. No update.", { username, t2, finalScore });
            }
            break;
          }

          case 'getLeaderboard': {
            const currentUser = await context.reddit.getCurrentUser();
            // const subreddit = await context.reddit.getCurrentSubreddit();
            // const subredditName = subreddit?.name || 'unknown_subreddit';

            // Determine scope based on requested tab (default to global)
            // const requestedTab = message.data?.tab || 'this-subreddit';
            // For now, always fetch global regardless of tab request
            // const scope = requestedTab === 'all-subreddits' ? 'global' : subredditName;

            console.log("Fetching global leaderboard for client request");
            // Get fresh global leaderboard data from the service
            const leaderboard = await leaderboardService.getGlobalLeaderboard(TOP_PLAYERS_COUNT);

            console.log(`Sending global leaderboard data to client:`, leaderboard.length, "entries");

            hook.postMessage({
              type: 'devvit-message',
              data: {
                message: {
                  type: 'leaderboardData',
                  data: {
                    // Always send global leaderboard for now
                    tab: 'all-subreddits', // Indicate it's the global one
                    entries: leaderboard.map(entry => ({
                      // Ensure only serializable properties are sent
                      username: entry.username,
                      score: entry.score,
                      rank: entry.rank || 0,
                      createdAt: entry.createdAt || null,
                      updatedAt: entry.updatedAt || null
                    })),
                    // username: currentUser?.username || null // Client already has username from initialData
                  }
                }
              }
            });
            break;
          }

          // Keep custom items logic as is for now
          case 'fetchCustomWeapons':
          case 'requestCustomItems': {
            try {
              const currentUser = await context.reddit.getCurrentUser();
              const username = currentUser?.username;

              if (!username) {
                throw new Error('User not authenticated');
              }

              const fetchCustomItems = async (itemType: 'weapon' | 'ball') => {
                const key = itemType === 'weapon' ? REDIS_KEYS.CUSTOM_WEAPONS : REDIS_KEYS.CUSTOM_BALLS;
                const redisKey = `${key}:${username}`;
                const data = await context.redis.hgetall(redisKey);
                const items: CustomItemData[] = [];

                if (data) {
                  try {
                    const itemName = itemType === 'weapon' ? 'weapons' : 'balls';
                    if (data[itemName]) {
                      const parsedItems = JSON.parse(data[itemName]);
                      if (Array.isArray(parsedItems)) {
                        return parsedItems;
                      }
                    }
                  } catch (e) {
                    console.error(`Error parsing custom ${itemType}s:`, e);
                  }
                }
                return items;
              };

              const weapons = await fetchCustomItems('weapon');
              const balls = await fetchCustomItems('ball');

              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'customItemsData', // Changed type to match frontend expectation
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

          case 'uploadImage': // Corrected case to match WebViewMessage type
          {
            try {
              const { imageUrl, itemType, itemName } = message.data;

              if (!imageUrl || !itemType || !itemName) {
                throw new Error('Missing required data for image upload');
              }

              const currentUser = await context.reddit.getCurrentUser();
              const username = currentUser?.username;

              if (!username) {
                throw new Error('User not authenticated');
              }

              // No need to re-upload, image URL is provided directly by client now
              // const response = await context.media.upload({ url: imageUrl, type: 'image' });

              const newItem: CustomItemData = {
                imageUrl: imageUrl, // Use the provided URL directly
                name: itemName,
                createdAt: new Date().toISOString()
              };

              const redisKeyPrefix = itemType === 'weapon' ? REDIS_KEYS.CUSTOM_WEAPONS : REDIS_KEYS.CUSTOM_BALLS;
              const userItemsKey = `${redisKeyPrefix}:${username}`;
              const dataKey = itemType === 'weapon' ? 'weapons' : 'balls';

              // Fetch existing items
              const existingData = await context.redis.hgetall(userItemsKey);
              let items: CustomItemData[] = [];
              if (existingData && existingData[dataKey]) {
                try {
                  const parsed = JSON.parse(existingData[dataKey]);
                  if (Array.isArray(parsed)) {
                    items = parsed;
                  }
                } catch (e) {
                  console.error(`Error parsing existing custom ${itemType}s:`, e);
                }
              }

              // Add new item and save back
              items.push(newItem);
              await context.redis.hset(userItemsKey, { [dataKey]: JSON.stringify(items) });

              // Fetch updated lists to send back
              const fetchCustomItems = async (type: 'weapon' | 'ball') => {
                 const key = type === 'weapon' ? REDIS_KEYS.CUSTOM_WEAPONS : REDIS_KEYS.CUSTOM_BALLS;
                 const redisKey = `${key}:${username}`;
                 const data = await context.redis.hgetall(redisKey);
                 const name = type === 'weapon' ? 'weapons' : 'balls';
                 if (data && data[name]) {
                   try {
                     const parsed = JSON.parse(data[name]);
                     return Array.isArray(parsed) ? parsed : [];
                   } catch { return []; }
                 }
                 return [];
              };

              const updatedWeapons = await fetchCustomItems('weapon');
              const updatedBalls = await fetchCustomItems('ball');

              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'uploadComplete',
                    data: {
                      imageUrl: imageUrl, // Send back the original URL
                      itemType,
                      itemName,
                      weapons: updatedWeapons,
                      balls: updatedBalls
                    }
                  }
                }
              });
            } catch (error) {
              console.error('Error processing uploaded image:', error);
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                    type: 'error',
                    data: {
                      message: 'Failed to process uploaded image',
                      details: error instanceof Error ? error.message : String(error),
                    }
                  }
                }
              });
            }
            break;
          }
           // Keep requestImageUpload logic as is (it tells client to provide URL)
          case 'requestImageUpload': {
             try {
               const { itemType } = message.data;
               if (itemType !== 'weapon' && itemType !== 'ball') {
                 throw new Error('Unsupported item type');
               }
               const currentUser = await context.reddit.getCurrentUser();
               if (!currentUser?.username) {
                 throw new Error('User not authenticated');
               }
               // This case remains the same - it asks the client for a URL
               hook.postMessage({
                 type: 'devvit-message',
                 data: {
                   message: {
                     type: 'requestImageUrl', // Tell client to provide URL
                     data: { itemType }
                   }
                 }
               });
             } catch (error) {
                console.error('Error requesting image upload:', error);
                // Send error back to client
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

  // Realtime channel setup remains the same
  const channel = useChannel({
    name: 'leaderboard_updates',
    onMessage: (leaderboard: LeaderboardEntry[]) => { // Expecting the full leaderboard array
      console.log(`Received broadcasted leaderboard update via realtime channel with ${leaderboard.length} entries.`);
      // Forward the update to the webview
      postMessage({
        type: 'devvit-message',
        data: {
          message: {
            type: 'leaderboardUpdate', // New message type for realtime updates
            data: {
              entries: leaderboard // Send the full updated list
            }
          }
        }
      });
    },
    onSubscribed: () => console.log('Subscribed to leaderboard updates'),
    onUnsubscribed: () => {
      console.log('Unsubscribed from leaderboard updates');
      setTimeout(() => channel.subscribe(), 5000); // Attempt to resubscribe
    }
  });

  // Subscribe on mount using useState initializer
  useState(() => {
    channel.subscribe();
    console.log('Subscribed to channel on mount');
    return true; // Must return a JSONValue
  });

  return (
    <vstack>
      <button onPress={() => mount()}>Play Don't Drop</button>
    </vstack>
  );
};

// Custom Post Type remains the same
Devvit.addCustomPostType({
  name: "DontDrop",
  render: (context) => <DontDropGame context={context} />,
  height: "tall"
});

// Menu Item remains the same
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
        // Use a placeholder image URL for the post preview
        kind: "image",
        url: "https://raw.githubusercontent.com/AMACAFELLA/dontdrop/main/webroot/assets/paddles/blue-paddle.png" // Example placeholder
      });
      context.ui.showToast('Game post created!');
      context.ui.navigateTo(post);
    } catch (error) {
      console.error('Error creating game post:', error);
      context.ui.showToast('Failed to create game post');
    }
  }
});

// Weekly leaderboard update scheduler job - USE THE SERVICE
Devvit.addSchedulerJob({
  name: 'weekly_leaderboard_update',
  onRun: async (_, context) => {
    try {
      const leaderboardService = new LeaderboardService(context); // Instantiate service
      // Get top 10 players from the GLOBAL leaderboard using the service
      const leaderboardEntries = await leaderboardService.getGlobalLeaderboard(10);

      // Format and post the leaderboard, ensuring keys match frontend expectations
      const formattedEntries = leaderboardEntries.map(entry => ({
        username: entry.username, // Ensure this key is 'username'
        score: entry.score
      }));

      const leaderboardData = encodeURIComponent(JSON.stringify(formattedEntries));
      const subreddit = await context.reddit.getCurrentSubreddit();

      await context.reddit.submitPost({
        title: `📊 Weekly Don't Drop Leaderboard Update - Top Players 🏆`,
        subredditName: subreddit.name,
        preview: (
          <blocks height="tall">
            {/* Ensure this URL points to a publicly accessible HTML file */}
            <webview url={`https://raw.githubusercontent.com/AMACAFELLA/dontdrop/main/webroot/leaderboard.html?data=${leaderboardData}`} />
          </blocks>
        ),
      });
      console.log("Posted weekly leaderboard update.");
    } catch (error) {
      console.error('Error posting weekly leaderboard:', error);
    }
  }
});

// Top 5 player announcement types and functions remain the same
type TopPlayerData = {
  username: string;
  score: number;
  rank: number;
  previousPlayer?: {
    username: string;
    score: number;
  };
};

// Scheduler job to announce new top 5 player remains the same
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
             {/* Ensure this URL points to a publicly accessible HTML file */}
            <webview url={`https://raw.githubusercontent.com/AMACAFELLA/dontdrop/main/webroot/top-player.html?data=${playerData}`} />
          </blocks>
        ),
      });
      console.log(`Posted announcement for ${data.username} reaching rank ${data.rank}`);
    } catch (error) {
      console.error('Error posting top player announcement:', error);
    }
  },
});

// AppInstall Trigger remains the same
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_, context) => {
    try {
       const jobId = await context.scheduler.runJob({
         cron: '0 0 * * 0', // Every Sunday at midnight UTC
         name: 'weekly_leaderboard_update',
         data: {},
       });
       await context.redis.set(REDIS_KEYS.WEEKLY_JOB, jobId);
       console.log("Scheduled weekly leaderboard job with ID:", jobId);
    } catch (error) {
        console.error("Failed to schedule weekly job:", error);
    }
  },
});

// Clear Data Form and Menu Item - USE THE SERVICE
const clearDataForm = Devvit.createForm(
  {
    title: "Clear Don't Drop Game Data",
    fields: [
      {
        type: "select",
        name: "dataType",
        label: "Select data to clear",
        options: [
          { label: "Leaderboard Only", value: "leaderboard" },
          // { label: "Current User Data", value: "user" }, // User data clearing might need rework if USER_PREFIX is removed
          // { label: "Custom Items", value: "items" },
          // { label: "All Game Data", value: "all" } // 'all' might be misleading now
        ],
        defaultValue: ["leaderboard"]
      }
    ],
    acceptLabel: "Clear Data",
    cancelLabel: "Cancel"
  },
  async (event, context) => {
    const dataType = event.values.dataType[0];
    let success = false;
    const leaderboardService = new LeaderboardService(context); // Instantiate service

    console.log(`Attempting to clear data: ${dataType}`);

    switch (dataType) {
      case "leaderboard":
        // Use the service method to clear leaderboard data
        success = await leaderboardService.clearAllLeaderboardData();
        break;
      // Add cases for 'user', 'items', 'all' if needed, potentially using service methods
      // case "user": ...
      // case "items": ...
      // case "all": ...
      default:
         context.ui.showToast("Selected data type not implemented for clearing.");
         return;
    }

    if (success) {
      context.ui.showToast("Game data cleared successfully!");
    } else {
      context.ui.showToast("Failed to clear game data");
    }
  }
);

Devvit.addMenuItem({
  label: "Clear Game Data",
  location: "subreddit",
  onPress: async (event, context) => {
    try {
      context.ui.showForm(clearDataForm);
    } catch (error) {
      console.error("Error showing clear game data form:", error);
      context.ui.showToast("An error occurred while trying to clear game data");
    }
  }
});

export default Devvit;

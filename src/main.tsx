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
           case 'defaultImageUpdated': {
             // Extract itemType and imageDataUrl from the message
             const { itemType, imageDataUrl } = message.data;
             const userId = context.userId; // Get the user ID from context

             if (!userId || !imageDataUrl) { // Also check for imageDataUrl
               console.error('Cannot schedule customization post: User ID not found in context.');
               break;
             }

             console.log(`Received defaultImageUpdated for ${itemType} from user ${userId}. Scheduling post.`);

             // Schedule a job to create the post after a short delay (e.g., 60 seconds)
             await context.scheduler.runJob({
               name: 'createCustomizationPost', // Name of the job handler
               data: {
                 userId: userId,
                 itemType: itemType, // 'paddle' or 'ball'
                 imageDataUrl: imageDataUrl, // Pass image data URL to the job
               },
               runAt: new Date(Date.now() + 60 * 1000), // Run 60 seconds from now
             });
             console.log(`Scheduled customization post job for user ${userId}.`);
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
      console.log('Weekly leaderboard post created successfully.');
    } catch (error) {
      console.error('Error running weekly leaderboard job:', error);
    }
  },
});

// Job to announce a new top player - USE THE SERVICE
Devvit.addSchedulerJob({
  name: 'announce_top_player',
  onRun: async (event, context) => {
    // Add type assertion for event.data
    const { username, score, rank, previousPlayer } = event.data as {
        username: string;
        score: number;
        rank: number;
        previousPlayer: { username: string; score: number } | null;
    };

    if (!username || !score || !rank) {
      console.error('Missing data in announce_top_player job:', event.data);
      return;
    }

    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      if (!subreddit) {
        console.error('Could not get current subreddit for announcement.');
        return;
      }

      let postTitle = `🏆 New Top Player Alert! u/${username} reached Rank #${rank} with ${score} points!`;
      let postBody = `Congratulations to **u/${username}** for reaching **Rank #${rank}** on the global Don't Drop leaderboard with an amazing score of **${score}**! 🎉`;

      if (previousPlayer && previousPlayer.username) {
        postTitle = `👑 u/${username} takes Rank #${rank} with ${score} points!`;
        postBody = `**u/${username}** has claimed **Rank #${rank}** on the global Don't Drop leaderboard with a score of **${score}**, surpassing u/${previousPlayer.username} (who had ${previousPlayer.score})! 🚀\n\nCan you beat their score?`;
      }

      // For text posts, omit 'kind' and 'url', use 'text' for the body
      const post = await context.reddit.submitPost({
        title: postTitle,
        subredditName: subreddit.name,
        text: postBody,
      });

      console.log(`Successfully created announcement post for u/${username}.`);

    } catch (error) {
      console.error(`Error creating announcement post for u/${username}:`, error);
    }
  },
});

// Form for clearing data
const clearDataForm = Devvit.createForm(
  {
    title: "Clear Game Data",
    fields: [
      {
        name: "dataType",
        label: "Select Data to Clear:",
        type: "select",
        options: [
          { label: "Leaderboard", value: "leaderboard" },
          // { label: "User Data", value: "user" },
          // { label: "Custom Items", value: "items" },
          // { label: "All Data", value: "all" }
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

// Job to create a post announcing a user's customization
Devvit.addSchedulerJob({
  name: 'createCustomizationPost',
  onRun: async (event, context) => {
    // Add type assertion for event.data, including imageDataUrl
    const { userId, itemType, imageDataUrl } = event.data as {
        userId: string;
        itemType: 'paddle' | 'ball';
        imageDataUrl: string;
    };

    if (!userId || !itemType || !imageDataUrl) {
      console.error('Missing data in createCustomizationPost job:', event.data);
      return;
    }

    try {
      const user = await context.reddit.getUserById(userId);
      if (!user || !user.username) {
        console.error(`Could not find user for ID: ${userId}`);
        return;
      }
      const username = user.username;

      const subreddit = await context.reddit.getCurrentSubreddit();
      if (!subreddit) {
        console.error('Could not get current subreddit for customization post.');
        return;
      }

      const postTitle = `u/${username} customized their ${itemType}! 🔥`;
      const commentBody = `Check out the new look for u/${username}'s ${itemType}!\n\nWhat does yours look like? Show it off in your own post or update your default!`;

      // 1. Upload the image data URL to Reddit media
      console.log(`Uploading image data for ${username}'s ${itemType}...`);
      const mediaResponse = await context.media.upload({
          url: imageDataUrl,
          type: 'image'
      });
      const redditMediaUrl = mediaResponse.mediaUrl;
      console.log(`Image uploaded successfully: ${redditMediaUrl}`);

      // 2. Submit an image post (omit 'kind', let it infer from URL)
      const post = await context.reddit.submitPost({
        title: postTitle,
        subredditName: subreddit.name,
        // kind: 'image', // Omit kind, let it infer
        url: redditMediaUrl, // Use the URL returned by media upload
      });
      console.log(`Successfully created customization image post for u/${username}: ${post.id}`);

      // 3. (Optional) Add the descriptive text as a comment using submitComment
      await context.reddit.submitComment({
          id: post.id, // Use 'id' for the post ID
          text: commentBody,
      });
      console.log(`Added descriptive comment to post ${post.id}`);

    } catch (error) {
      console.error(`Error creating customization post for user ${userId}:`, error);
    }
  },
});

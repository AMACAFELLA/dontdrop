import { Devvit, useWebView } from '@devvit/public-api';
import type { WebViewMessage, DevvitMessage, LeaderboardEntry } from './message.ts';
import { LoadingAnimation } from './components/LoadingAnimation.js';

// Constants for Redis keys
const REDIS_KEYS = {
  LEADERBOARD: 'dontdrop:leaderboard:v1',
  WEEKLY_JOB: 'dontdrop:weekly_job_id:v1',
  USER_PREFIX: 'dontdrop:user:v1:'
} as const;

// Update configuration with required permissions
Devvit.configure({
  redditAPI: true,
  redis: true,
  realtime: true
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
                await context.redis.zAdd(REDIS_KEYS.LEADERBOARD, { 
                  member: username, 
                  score: finalScore 
                });

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

// Scheduler job to post about new top 5 player
Devvit.addSchedulerJob({
  name: 'new_top_player',
  onRun: async (event, context) => {
    try {
      const data = event.data as { username: string; score: number; rank: number };
      const { username, score, rank } = data;
      const subreddit = await context.reddit.getCurrentSubreddit();
      
      await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: `🏆 ${username} just reached rank #${rank} on the Don't Drop leaderboard!`,
        text: `**${username}** just scored **${score}** points and is now ranked #${rank} on our Don't Drop leaderboard!\n\nCan you beat this score? Play now and show off your skills!`,
      });
      
      console.log(`Posted about new top player ${username} with rank ${rank}`);
    } catch (error) {
      console.error('Error posting about new top player:', error);
    }
  },
});

// Scheduler job to post weekly leaderboard
Devvit.addSchedulerJob({
  name: 'weekly_leaderboard',
  onRun: async (_, context) => {
    try {
      const subreddit = await context.reddit.getCurrentSubreddit();
      const leaderboardEntries = await context.redis.zRange(REDIS_KEYS.LEADERBOARD, 0, 4, {
        reverse: true,
        by: "rank"
      });

      if (!leaderboardEntries || leaderboardEntries.length === 0) {
        console.log('No players in leaderboard, skipping weekly post');
        return;
      }

      let leaderboardText = '# This Week\'s Top Don\'t Drop Players\n\n';
      leaderboardEntries.forEach((entry, index) => {
        leaderboardText += `${index + 1}. **${entry.member}** with a score of **${entry.score}**\n`;
      });
      leaderboardText += '\nCan you beat these scores? Play now and climb the leaderboard!';

      await context.reddit.submitPost({
        subredditName: subreddit.name,
        title: '🏆 Weekly Don\'t Drop Leaderboard - Top Players 🏆',
        text: leaderboardText,
      });
    } catch (error) {
      console.error('Error posting weekly leaderboard:', error);
    }
  }
});

// Install trigger to schedule weekly leaderboard post
Devvit.addTrigger({
  event: 'AppInstall',
  onEvent: async (_, context) => {
    try {
      const jobId = await context.scheduler.runJob({
        cron: '0 0 * * 0',
        name: 'weekly_leaderboard',
        data: {},
      });
      await context.redis.set(REDIS_KEYS.WEEKLY_JOB, jobId);
      console.log('Scheduled weekly leaderboard post with job ID:', jobId);
    } catch (e) {
      console.error('Error scheduling weekly leaderboard:', e);
    }
  }
});

export default Devvit;
import { Devvit, useWebView } from '@devvit/public-api';
import type { WebViewMessage, DevvitMessage, LeaderboardEntry } from './message.ts';
import { LoadingAnimation } from './components/LoadingAnimation.js';

// Update configuration with required permissions
Devvit.configure({
  redditAPI: true, // Enable Reddit API access
  kvStore: true // Use KV Store for leaderboard
});

const LEADERBOARD_KEY = 'dontdrop_leaderboard';
const TOP_PLAYERS_COUNT = 10;

// In-memory leaderboard for playtest mode
let playtestLeaderboard: {username: string, score: number}[] = [];

// Helper function to update leaderboard
async function updateLeaderboard(context: Devvit.Context, username: string, score: number): Promise<LeaderboardEntry[]> {
  try {
    console.log(`Updating leaderboard for user ${username} with score ${score}`);
    
    if (!username || username === 'Guest' || username === '') {
      console.log('Cannot update leaderboard: username is empty or Guest');
      return getLeaderboard(context); // Return current leaderboard without changes
    }
    
    // Get current leaderboard
    let leaderboard = await getLeaderboard(context);
    
    // Find if user already has an entry
    const existingEntryIndex = leaderboard.findIndex(entry => entry.username === username);
    
    if (existingEntryIndex >= 0) {
      // Only update if new score is higher
      if (score > leaderboard[existingEntryIndex].score) {
        leaderboard[existingEntryIndex].score = score;
        leaderboard[existingEntryIndex].updatedAt = new Date().toISOString();
        console.log(`Updated leaderboard entry for ${username} with score ${score}`);
      } else {
        console.log(`Not updating score for ${username} as current score (${leaderboard[existingEntryIndex].score}) is higher than new score (${score})`);
        return leaderboard;
      }
    } else {
      // Add new entry
      leaderboard.push({
        username,
        score,
        rank: 0, // Will be calculated below
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      console.log(`Added new leaderboard entry for ${username} with score ${score}`);
    }
    
    // Sort by score (highest first)
    leaderboard.sort((a, b) => b.score - a.score);
    
    // Update ranks
    leaderboard = leaderboard.map((entry, index) => ({
      ...entry,
      rank: index + 1
    }));
    
    // Limit to top players
    if (leaderboard.length > TOP_PLAYERS_COUNT) {
      leaderboard = leaderboard.slice(0, TOP_PLAYERS_COUNT);
    }
    
    try {
      // Save to KV Store
      await context.kvStore.put(LEADERBOARD_KEY, JSON.stringify(leaderboard));
      console.log(`Saved leaderboard with ${leaderboard.length} entries to KV Store`);
    } catch (error) {
      if (error instanceof Error && error.message?.includes('ServerCallRequired')) {
        console.warn('Using in-memory leaderboard in playtest mode');
        playtestLeaderboard = leaderboard.map(entry => ({
          username: entry.username,
          score: entry.score
        }));
      } else {
        console.error('Error saving leaderboard to KV Store:', error);
      }
    }
    
    return leaderboard;
  } catch (error) {
    console.error('Error updating leaderboard:', error);
    return [];
  }
}

// Helper function to get leaderboard data
async function getLeaderboard(context: Devvit.Context): Promise<LeaderboardEntry[]> {
  try {
    try {
      // Try to get leaderboard from KV Store
      const stored = await context.kvStore.get(LEADERBOARD_KEY);
      
      if (stored && typeof stored === 'string') {
        const leaderboard = JSON.parse(stored) as LeaderboardEntry[];
        console.log(`Retrieved leaderboard with ${leaderboard.length} entries from KV Store`);
        return leaderboard;
      }
      
      console.log('No leaderboard data found in KV Store');
      return [];
    } catch (error) {
      if (error instanceof Error && error.message?.includes('ServerCallRequired')) {
        console.warn('Using in-memory leaderboard in playtest mode');
        
        // Convert playtest leaderboard to full entries
        if (playtestLeaderboard.length > 0) {
          return playtestLeaderboard
            .sort((a, b) => b.score - a.score)
            .map((entry, index) => ({
              username: entry.username,
              score: entry.score,
              rank: index + 1,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            }));
        }
      } else {
        console.error('Error retrieving leaderboard from KV Store:', error);
      }
      
      return [];
    }
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    return [];
  }
}

// Store a mapping of session IDs to usernames
const userSessions = new Map<string, string>();

// Generate a unique session ID for each webview
let sessionCounter = 0;

// Flag to detect if we're running in playtest mode
let isPlaytestMode = false;

const DontDropGame = ({ context }: { context: Devvit.Context }) => {
  const { mount } = useWebView({
    url: 'page.html',
    onMessage: async (message: WebViewMessage, hook) => {
      try {
        // Create a unique identifier for this webview session
        const sessionId = `session_${sessionCounter}`;
        sessionCounter++;
        
        // Try to get the real Reddit username if not already stored for this session
        if (!userSessions.has(sessionId)) {
          try {
            const currentUser = await context.reddit.getCurrentUser();
            if (currentUser && currentUser.username) {
              userSessions.set(sessionId, currentUser.username);
              console.log(`Stored username ${currentUser.username} for session ${sessionId}`);
              isPlaytestMode = false; // We're in a real Reddit environment
            } else {
              console.warn('Reddit user object retrieved but no username found');
              // Default to "TestUser" in playtest mode for better testing
              userSessions.set(sessionId, 'TestUser');
              isPlaytestMode = true;
            }
          } catch (error: any) {
            console.error('Failed to get username with error:', error);
            // Use "TestUser" as fallback for playtest environment
            if (error.message?.includes('ServerCallRequired')) {
              console.log('Using "TestUser" as fallback in playtest mode');
              userSessions.set(sessionId, 'TestUser');
              isPlaytestMode = true;
            } else {
              userSessions.set(sessionId, '');
            }
          }
        }
        
        // Retrieve the username for this session
        const username = userSessions.get(sessionId) || 'TestUser';
        console.log(`Processing message for session ${sessionId} with username ${username}`);

        switch (message.type) {
          case 'webViewReady': {
            console.log('WebView ready, sending initial data with username:', username);
            // Get leaderboard data
            let leaderboard = await getLeaderboard(context);
            
            hook.postMessage({
              type: 'devvit-message',
              data: {
                message: {
                  type: 'initialData',
                  data: { 
                    username, 
                    leaderboard,
                    isPlaytestMode // Send whether we're in playtest mode
                  }
                }
              }
            });
            
            // Log what we sent to the client for debugging purposes
            console.log('Sent initialData to client with:', { username, leaderboardSize: leaderboard.length, isPlaytestMode });
            break;
          }
          
          case 'gameOver': {
            const finalScore = message.data.finalScore;
            console.log(`Game over for ${username || 'Guest'} with score ${finalScore}`);
            
            // Update leaderboard
            let updatedLeaderboard: LeaderboardEntry[] = [];
            
            try {
              // Only update the leaderboard if we have a username
              if (username && username !== '') {
                // Update leaderboard with the new score
                updatedLeaderboard = await updateLeaderboard(context, username, finalScore);
                console.log('Leaderboard successfully updated with new score');
              } else {
                console.warn('Could not update leaderboard: no username available for session', sessionId);
                updatedLeaderboard = await getLeaderboard(context);
              }
            } catch (error: any) {
              console.error('Error updating leaderboard:', error);
              updatedLeaderboard = await getLeaderboard(context);
            }
            
            // Log what we're sending back to the client
            console.log(`Sending gameOverAck with ${updatedLeaderboard.length} leaderboard entries`);
            
              hook.postMessage({
                type: 'devvit-message',
                data: {
                  message: {
                  type: 'gameOverAck',
                  data: { 
                    success: true,
                    username: username || '', // Send the username back to confirm
                    leaderboard: updatedLeaderboard,
                    isPlaytestMode // Send whether we're in playtest mode
                  }
                  }
                }
              });
            break;
          }
          
          case 'getLeaderboard': {
            console.log(`Leaderboard requested by client with username: ${username || 'Guest'}`);
            // Get leaderboard data
            const leaderboard = await getLeaderboard(context);
            
            console.log('Sending leaderboardData response with', leaderboard.length, 'entries');
                
                hook.postMessage({
                  type: 'devvit-message',
                  data: {
                    message: {
                  type: 'leaderboardData',
                data: {
                    username: username || '', // Send the username back to confirm
                    leaderboard,
                    isPlaytestMode // Send whether we're in playtest mode
                  }
                  }
                }
              });
            break;
          }

          default: {
            // Use type assertion to inform TypeScript about the message structure
            const unknownMessage = message as {type: string};
            console.warn('Unknown message type:', unknownMessage.type);
            break;
          }
        }
      } catch (error) {
        console.error('Error handling message:', error);
        
        try {
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

export default Devvit;
# Don't Drop - Reddit Game

## About the Game

Don't Drop is an addictive arcade-style game built for Reddit using Devvit. Control your paddle with your mouse or finger and keep the ball bouncing! The longer you keep the ball in play, the higher your score. Aim for the top of the leaderboard and unlock different paddles and balls with unique abilities to enhance your gameplay.

## Recent Fixes

### Leaderboard Improvements
We've made significant improvements to the leaderboard functionality:

1.  **Redis Integration**: Updated the Redis implementation to properly store and retrieve leaderboard data:
    *   Optimized leaderboard format and storage (using Sorted Sets)
    *   Fixed parameters for Redis operations

2.  **Error Handling**: Enhanced error handling for network and fetch-related errors:
    *   Added more detailed error messages in the server logs
    *   Improved client-side error handling and display

3.  **User Experience**: Improved the overall user experience:
    *   Better visual feedback about score saving status
    *   Enhanced localStorage backup for usernames and leaderboard data
    *   Improved UI animations and transitions

## Known Issues

### Browser Resource Blocks
Some browser errors like `Failed to load resource: net::ERR_BLOCKED_BY_CLIENT` are typically caused by:
- Content blockers or ad blockers
- Browser security features
- Cross-origin restrictions

These don't affect core game functionality and can be safely ignored.

### Fetch No-Op Warnings
The warning `Fetch event handler is recognized as no-op` is related to service worker registration and can be safely ignored in the context of this game.

### Permissions Policy Errors
Errors about `Permissions-Policy header: Unrecognized feature` are related to browser features and security policies. These don't affect core game functionality.

## Deployment Notes

When deployed to Reddit:
- The game will use the Redis database provided by Devvit
- Username detection will work properly
- Scores will be permanently saved to the leaderboard

## Troubleshooting

If you encounter issues with the leaderboard not updating:

1.  Verify that Redis is being used correctly in the Devvit app code
2.  Check browser console logs for specific errors
3.  Ensure the username detection is working correctly

For any other issues, please refer to the Devvit documentation or file an issue in the repository.
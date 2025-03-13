/** Messages from Devvit to the web view */
export type DevvitMessagePayload = {
  type: 'initialData';
  data: {
    username: string;
    highScore: number;
    savedState?: {
      score: number;
      timestamp: number;
    };
  };
} | {
  type: 'updateHighScore';
  data: {
    highScore: number;
  };
} | {
  type: 'updateLeaderboard';
  data: {
    leaderboard: Array<{ member: string; score: number; }>;
  };
} | {
  type: 'error';
  data: {
    message: string;
  };
};

export type DevvitMessage = {
  type: 'devvit-message';
  data: {
    message: DevvitMessagePayload;
  };
};

/** Messages from the web view to Devvit */
export type WebViewMessage = {
  type: 'webViewReady';
} | {
  type: 'updateScore';
  data: { score: number };
} | {
  type: 'gameOver';
  data: { finalScore: number };
};

/** 
 * Web view event listener helper type.
 * This helps TypeScript understand the message event structure.
 */
export type DevvitMessageEvent = MessageEvent<DevvitMessage>;

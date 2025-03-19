/** Messages from Devvit to the web view */
export type DevvitMessagePayload = {
  type: 'initialData';
  data: {
    username: string;
    leaderboard: LeaderboardEntry[];
  };
} | {
  type: 'gameOverAck';
  data: {
    success: boolean;
    username?: string;
    leaderboard: LeaderboardEntry[];
  };
} | {
  type: 'leaderboardData';
  data: {
    username?: string;
    leaderboard: LeaderboardEntry[];
  };
} | {
  type: 'error';
  data: {
    message: string;
    details?: string;
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
  type: 'gameOver';
  data: { finalScore: number; existingLeaderboard?: LeaderboardEntry[] };
} | {
  type: 'getLeaderboard';
  data?: { existingLeaderboard?: LeaderboardEntry[] };
};

/** 
 * Web view event listener helper type.
 * This helps TypeScript understand the message event structure.
 */
export type DevvitMessageEvent = MessageEvent<DevvitMessage>;

export type LeaderboardEntry = {
  username: string;
  score: number;
  rank: number;
  createdAt: string;
  updatedAt: string;
};

export type DevvitSystemMessage = {
  type: 'devvit-message';
  data: {
    message: DevvitMessage;
  };
};
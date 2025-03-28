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
} | {
  type: 'customItemsData';
  data: {
    weapon?: CustomItemData[];
    ball?: CustomItemData[];
  };
} | {
  type: 'uploadComplete';
  data: {
    imageUrl: string;
    itemType: 'weapon' | 'ball';
    itemName: string;
  };
} | {
  type: 'requestImageUrl';  // Fixed duplicate message type
  data: {
    itemType: 'weapon' | 'ball';
  };
};

export type DevvitMessage = {
  // Standardizing on 'customItemsData'
  type: 'initialData' | 'gameOverAck' | 'leaderboardData' | 'leaderboardUpdate' | 'customItemsData' | 'requestImageUrl' | 'uploadComplete' | 'error' | 'clearRedisDataResponse';
  data: {
    username?: string;
    leaderboard?: LeaderboardEntry[];
    success?: boolean;
    message?: string;
    details?: string;
    weapon?: CustomItemData[];
    ball?: CustomItemData[];
    imageUrl?: string;
    itemType?: 'weapon' | 'ball';
    itemName?: string;
  };
};

/** Specific data payloads for WebView messages */
type WebViewMessagePayloadMap = {
  webViewReady: {}; // No data needed
  gameOver: { finalScore: number };
  getLeaderboard: {
    existingLeaderboard?: LeaderboardEntry[]; // Optional existing data
    tab?: 'this-subreddit' | 'all-subreddits'; // Add the requested tab
  };
  fetchCustomWeapons: {}; // No data needed
  requestCustomItems: {}; // No data needed
  requestImageUpload: { itemType: 'weapon' | 'ball' };
  uploadImage: { imageUrl: string; itemType: 'weapon' | 'ball'; itemName: string };
  clearRedisData: { dataType: 'leaderboard' | 'user' | 'items' | 'all' }; // Assuming this might be needed later
  defaultImageUpdated: { itemType: 'paddle' | 'ball'; imageDataUrl: string }; // Added imageDataUrl
};

/** Messages from the web view to Devvit */
export type WebViewMessage = {
  // Use mapped types for better type safety based on 'type'
  [K in keyof WebViewMessagePayloadMap]: {
    type: K;
    data: WebViewMessagePayloadMap[K];
  }
}[keyof WebViewMessagePayloadMap];


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

export type CustomItemData = {
  imageUrl: string;
  name: string;
  createdAt: string;
};

export type DevvitSystemMessage = {
  type: 'devvit-message';
  data: {
    message: DevvitMessagePayload; // Use the more specific union type
  };
};

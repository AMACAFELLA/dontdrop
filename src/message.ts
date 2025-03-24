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
    itemType: 'weapon' | 'ball' | 'ball';
    itemName: string;
  };
} | {
  type: 'requestImageUrl';  // Added this new message type
  data: {
    itemType: 'weapon' | 'ball' | 'ball';
  };
} | {
  type: 'requestImageUrl';
  data: {
    itemType: 'weapon' | 'ball';
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
} | {
  type: 'requestCustomItems';
} | {
  type: 'fetchCustomWeapons'; // Add this new message type
} | {
  type: 'requestImageUpload';
  data: { itemType: 'weapon' | 'ball' };
} | {
  type: 'imageUploaded';
  data: {
    imageUrl: string;
    itemType: 'weapon' | 'ball';
    itemName: string;
  };
} | {
  type: 'uploadImage';
  data: {
    imageUrl: string;
    itemType: 'weapon' | 'ball';
    itemName: string;
  };
} | {
  type: 'fetchLeaderboard';
  data: { tab: string };
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

export type CustomItemData = {
  imageUrl: string;
  name: string;
  createdAt: string;
};

export type DevvitSystemMessage = {
  type: 'devvit-message';
  data: {
    message: DevvitMessage;
  };
};
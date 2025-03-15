/** @typedef {import('../src/message.ts').DevvitSystemMessage} DevvitSystemMessage */
/** @typedef {import('../src/message.ts').WebViewMessage} WebViewMessage */

// Game state
let isOnline = navigator.onLine;
let pendingScores = [];
let username = 'Guest';
let highScore = parseInt(localStorage.getItem('highScore') || '0', 10);
let currentScore = 0;
let gameStarted = false;
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

// Enhanced error handling state
const ErrorState = {
  NONE: 'none',
  CONNECTION_ERROR: 'connection_error',
  SAVE_ERROR: 'save_error',
  GENERIC_ERROR: 'generic_error'
};

let currentErrorState = ErrorState.NONE;
let errorRetryTimeout = null;

function showError(message, type = ErrorState.GENERIC_ERROR) {
  const errorOverlay = document.createElement('div');
  errorOverlay.className = 'error-overlay';
  errorOverlay.innerHTML = `
    <div class="error-content">
      <div class="error-icon ${type}"></div>
      <p>${message}</p>
      <button class="retry-button">Retry</button>
    </div>
  `;
  
  document.body.appendChild(errorOverlay);
  currentErrorState = type;
  
  const retryButton = errorOverlay.querySelector('.retry-button');
  retryButton.addEventListener('click', () => {
    errorOverlay.remove();
    retryConnection();
  });
}

async function retryConnection() {
  if (errorRetryTimeout) {
    clearTimeout(errorRetryTimeout);
  }
  
  try {
    await postWebViewMessage({ type: 'webViewReady' });
    currentErrorState = ErrorState.NONE;
  } catch (error) {
    errorRetryTimeout = setTimeout(retryConnection, 5000);
  }
}

// Game elements
let ball;
let gameArea;
let instructions;
let animationFrameId;
let paddleCursor;

// Ball physics
let ballX = 0;
let ballY = 0;
let ballSpeedX = 0;
let ballSpeedY = 0;
const baseSpeed = 5;
const gravity = 0.2;
const bounceSpeedIncrease = 0.5;
const maxSpeed = 15;

// Paddle state
let cursorX = 0;
let cursorY = 0;
let lastCursorY = 0;
let paddleVelocityY = 0;

// Screen Management
let currentScreen = 'menu';

function showScreen(screenId) {
    const fromScreen = document.querySelector('.screen.active');
    const toScreen = document.getElementById(screenId + '-screen');
    
    if (fromScreen) {
        fromScreen.style.opacity = '0';
        setTimeout(() => {
            fromScreen.classList.remove('active');
            toScreen.classList.add('active');
            setTimeout(() => {
                toScreen.style.opacity = '1';
            }, 50);
        }, 300);
    } else {
        toScreen.classList.add('active');
        toScreen.style.opacity = '1';
    }
    
    currentScreen = screenId;
    
    if (screenId === 'game') {
        initGame();
    } else if (screenId === 'leaderboard') {
        fetchLeaderboard('this-subreddit');
    }
}

// Initialize game
function initGame() {
    gameArea = document.getElementById('gameArea');
    ball = document.getElementById('ball');
    instructions = document.getElementById('instructions');

    // Create paddle cursor
    paddleCursor = document.createElement('div');
    paddleCursor.className = 'paddle-cursor';
    gameArea.appendChild(paddleCursor);
    
    // Hide default cursor
    gameArea.style.cursor = 'none';

    // Input handling
    gameArea.addEventListener('mousemove', handleMouseMove);
    gameArea.addEventListener('touchmove', handleTouchMove, { passive: true });
    gameArea.addEventListener('mousedown', startGame);
    gameArea.addEventListener('touchstart', startGame, { passive: true });

    // Center ball on paddle initially
    resetBall();

    // Start game loop
    gameLoop();
}

// Initialize floating background elements
function initFloatingElements() {
    const menuBg = document.querySelector('.menu-background');
    
    // Create multiple floating balls and paddles
    for (let i = 0; i < 5; i++) {
        const ball = document.createElement('div');
        ball.className = 'floating-ball';
        ball.style.left = `${Math.random() * 100}%`;
        ball.style.top = `${Math.random() * 100}%`;
        ball.style.animationDelay = `${Math.random() * 2}s`;
        
        const paddle = document.createElement('div');
        paddle.className = 'floating-paddle';
        paddle.style.left = `${Math.random() * 100}%`;
        paddle.style.top = `${Math.random() * 100}%`;
        paddle.style.animationDelay = `${Math.random() * 2}s`;
        
        menuBg.appendChild(ball);
        menuBg.appendChild(paddle);
    }
}

// Initialize Menu and Event Listeners
function initMenu() {
    initFloatingElements();
    
    // Menu buttons
    document.getElementById('start-btn').addEventListener('click', () => showScreen('game'));
    document.getElementById('leaderboard-btn').addEventListener('click', () => showScreen('leaderboard'));
    document.getElementById('how-to-play-btn').addEventListener('click', showHowToPlayModal);
    document.getElementById('back-to-menu-btn').addEventListener('click', () => showScreen('menu'));

    // Modal
    const modal = document.getElementById('how-to-play-modal');
    document.querySelector('.modal-close').addEventListener('click', () => {
        modal.classList.remove('active');
    });

    // Tab switching in leaderboard
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-button').forEach(btn => 
                btn.classList.remove('active'));
            e.target.classList.add('active');
            fetchLeaderboard(e.target.dataset.tab);
        });
    });

    // Initialize floating background elements
    initFloatingElements();
}

// Update handleMouseMove to work with smooth cursor
function handleMouseMove(e) {
    if (currentScreen !== 'game') return;
    
    const rect = gameArea.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    cursorY = Math.max(30, Math.min(e.clientY - rect.top, gameArea.offsetHeight - 30));
    
    // Calculate paddle velocity
    paddleVelocityY = cursorY - lastCursorY;
    lastCursorY = cursorY;
    
    // Update paddle cursor position
    updatePaddlePosition(cursorX, cursorY);
}

function handleTouchMove(e) {
    e.preventDefault();
    const rect = gameArea.getBoundingClientRect();
    cursorX = e.touches[0].clientX - rect.left;
    cursorY = Math.max(30, Math.min(e.touches[0].clientY - rect.top, gameArea.offsetHeight - 30));
    
    // Calculate paddle velocity
    paddleVelocityY = cursorY - lastCursorY;
    lastCursorY = cursorY;
    
    // Update paddle cursor position
    updatePaddlePosition(cursorX, cursorY);
}

// Update paddle dimensions
const PADDLE_WIDTH = 120; // Reduced from 200
const PADDLE_HEIGHT = 10; // Reduced from 15
const BALL_SIZE = 50;

function updatePaddlePosition(x, y) {
    const maxX = gameArea.offsetWidth - PADDLE_WIDTH;
    const paddleX = Math.max(0, Math.min(x - PADDLE_WIDTH / 2, maxX));
    
    paddleCursor.style.left = paddleX + 'px';
    paddleCursor.style.top = (y - PADDLE_HEIGHT/2) + 'px';
    
    if (!gameStarted) {
        // Keep ball on paddle before game starts
        ballX = paddleX + (PADDLE_WIDTH - BALL_SIZE) / 2;
        ballY = y - BALL_SIZE - 5; // Slightly above paddle
        ball.style.left = ballX + 'px';
        ball.style.top = ballY + 'px';
    }
}

function startGame(e) {
    if (!gameStarted) {
        e.preventDefault();
        e.stopPropagation();
        gameStarted = true;
        if (instructions) {
            instructions.style.display = 'none';
        }
        
        // Launch ball at random angle only when clicked
        const angle = (Math.random() * 60 + 60) * (Math.PI / 180);
        ballSpeedX = Math.cos(angle) * baseSpeed;
        ballSpeedY = -Math.sin(angle) * baseSpeed;
    }
}

function resetBall() {
    // Position ball relative to paddle cursor
    const paddleWidth = 200;
    const ballWidth = ball.offsetWidth;
    
    cursorX = gameArea.offsetWidth / 2;
    cursorY = gameArea.offsetHeight - 100;
    lastCursorY = cursorY;
    
    updatePaddlePosition(cursorX, cursorY);
    
    ballX = cursorX - ballWidth / 2;
    ballY = cursorY - ballWidth - 15;
    
    ball.style.left = ballX + 'px';
    ball.style.top = ballY + 'px';
    
    ballSpeedX = 0;
    ballSpeedY = 0;
    paddleVelocityY = 0;
}

// Update collision detection to handle vertical paddle movement
function createHitEffect(x, y) {
    // Create ripple effect
    const ripple = document.createElement('div');
    ripple.className = 'ripple';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    gameArea.appendChild(ripple);
    
    // Create single particle burst
    const particleHit = document.createElement('div');
    particleHit.className = 'particle-hit';
    particleHit.style.left = x + 'px';
    particleHit.style.top = y + 'px';
    gameArea.appendChild(particleHit);
    
    // Remove elements after animation
    setTimeout(() => {
        ripple.remove();
        particleHit.remove();
    }, 500);
}

// Scoring system variables
let scoreMultiplier = 1;
let consecutiveHits = 0;
const COMBO_THRESHOLD = 3;
const MAX_MULTIPLIER = 4;
const QUICK_HIT_THRESHOLD = 1500; // Time window in ms for quick hits
let lastHitTime = 0;

function updateScore() {
    // Only give height bonus points on specific height thresholds
    const heightPercent = ((gameArea.offsetHeight - ballY) / gameArea.offsetHeight) * 100;
    let heightBonus = 0;
    
    // Award bonus points at certain height thresholds
    if (heightPercent >= 90) heightBonus = 2;
    else if (heightPercent >= 75) heightBonus = 1;
    
    // Only add height bonus if we're moving upward to reward intentional high hits
    if (ballSpeedY < 0) {
        currentScore += heightBonus;
    }
    
    // Update display with rounded score
    document.getElementById('score').textContent = Math.floor(currentScore);
}

function createScorePopup(x, y, text) {
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.textContent = text;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';
    gameArea.appendChild(popup);
    
    setTimeout(() => popup.remove(), 1000);
}

function updateMultiplier() {
    const currentTime = Date.now();
    const timeSinceLastHit = currentTime - lastHitTime;
    lastHitTime = currentTime;
    
    // Reset combo if hits are too far apart
    if (timeSinceLastHit > QUICK_HIT_THRESHOLD && consecutiveHits > 0) {
        resetMultiplier();
        return;
    }
    
    consecutiveHits++;
    
    // Different multiplier thresholds with corresponding rewards
    if (consecutiveHits === 5) {
        scoreMultiplier = 2;
        showComboText("2x Combo!");
        updateMultiplierDisplay();
        playSound('combo-milestone');
    } else if (consecutiveHits === 10) {
        scoreMultiplier = 3;
        showComboText("3x Super Combo!");
        updateMultiplierDisplay();
        playSound('combo-milestone');
    } else if (consecutiveHits === 15) {
        scoreMultiplier = 4;
        showComboText("4x ULTRA COMBO!");
        updateMultiplierDisplay();
        playSound('combo-milestone');
    } else if (consecutiveHits % 5 === 0) {
        // Small bonus points for maintaining a combo
        const bonusPoints = Math.min(5, consecutiveHits / 5) * scoreMultiplier;
        currentScore += bonusPoints;
        createScorePopup(ballX, ballY, `+${bonusPoints} Combo!`);
    }
}

function showComboText(text) {
    const comboText = document.createElement('div');
    comboText.className = 'combo-text';
    comboText.textContent = text;
    comboText.style.left = ballX + 'px';
    comboText.style.top = (ballY - 40) + 'px';
    gameArea.appendChild(comboText);
    
    // Remove after animation
    setTimeout(() => comboText.remove(), 500);
}

function updateMultiplierDisplay() {
    let multiplier = document.querySelector('.multiplier');
    if (!multiplier) {
        multiplier = document.createElement('div');
        multiplier.className = 'multiplier';
        multiplier.innerHTML = `
            <span>Multiplier</span>
            <span class="multiplier-value">x${scoreMultiplier}</span>
        `;
        gameArea.appendChild(multiplier);
    }
    
    multiplier.querySelector('.multiplier-value').textContent = `x${scoreMultiplier}`;
    multiplier.classList.add('active');
    setTimeout(() => multiplier.classList.remove('active'), 300);
}

function resetMultiplier() {
    scoreMultiplier = 1;
    consecutiveHits = 0;
    const multiplier = document.querySelector('.multiplier');
    if (multiplier) {
        multiplier.querySelector('.multiplier-value').textContent = `x${scoreMultiplier}`;
    }
}

// Update collision detection to include new scoring
function checkCollision() {
    const ballRect = ball.getBoundingClientRect();
    const paddleRect = paddleCursor.getBoundingClientRect();
    const gameRect = gameArea.getBoundingClientRect();
    
    // Use the full paddle dimensions for collision
    if (ballRect.bottom >= paddleRect.top &&
        ballRect.top <= paddleRect.bottom &&
        ballRect.right >= paddleRect.left &&
        ballRect.left <= paddleRect.right) {
        
        // Calculate base points based on position on paddle
        const hitPoint = (ballRect.left + BALL_SIZE / 2 - paddleRect.left) / paddleRect.width;
        const centerDistance = Math.abs(0.5 - hitPoint);
        
        // More points for hitting with the edges of the paddle (harder to do)
        let basePoints = centerDistance > 0.4 ? 5 : 2;
        
        // Add small bonus for paddle movement (skill shot)
        if (Math.abs(paddleVelocityY) > 5) {
            basePoints += 1;
        }
        
        // Calculate final points with multiplier
        const hitPoints = basePoints * scoreMultiplier;
        currentScore += hitPoints;
        createScorePopup(ballX, ballY, `+${hitPoints}`);
        
        // Visual and sound effects
        paddleCursor.classList.add('hit');
        ball.classList.add('bounce');
        playSound('paddle-hit');
        
        // Create hit effect at collision point
        const hitX = ballRect.left - gameRect.left + BALL_SIZE / 2;
        const hitY = paddleRect.top - gameRect.top;
        createHitEffect(hitX, hitY);
        
        // Enhanced particle effects
        for (let i = 0; i < 3; i++) {
            setTimeout(() => {
                createParticleExplosion(hitX, hitY, 4);
            }, i * 50);
        }
        
        setTimeout(() => {
            paddleCursor.classList.remove('hit');
            ball.classList.remove('bounce');
        }, 200);
        
        // Calculate bounce angle based on where the ball hits the paddle
        const normalizedHitX = (hitPoint * 2) - 1; // Convert to -1 to 1 range
        const baseAngle = normalizedHitX * Math.PI / 4; // Max 45 degree bounce
        
        const speed = Math.sqrt(ballSpeedX * ballSpeedX + ballSpeedY * ballSpeedY);
        const newSpeed = Math.min(speed + bounceSpeedIncrease, maxSpeed);
        
        // Add subtle vertical influence from paddle movement
        const paddleInfluence = paddleVelocityY * 0.3;
        
        ballSpeedX = Math.sin(baseAngle) * newSpeed;
        ballSpeedY = -Math.abs(Math.cos(baseAngle) * newSpeed) + paddleInfluence;
        
        // Ensure the ball moves upward
        if (ballSpeedY > 0) ballSpeedY = -ballSpeedY;
        
        // Prevent ball from getting stuck
        ballY = paddleRect.top - gameRect.top - BALL_SIZE - 1;
        
        // Update multiplier on successful hit
        updateMultiplier();
        
    } else if (ballY + BALL_SIZE >= gameArea.offsetHeight) {
        // Reset multiplier on miss
        resetMultiplier();
    }

    // Wall collisions with bonus points
    if (ballX <= 0 || ballX + BALL_SIZE >= gameArea.offsetWidth) {
        ballSpeedX = -ballSpeedX * 0.98;
        ballX = ballX <= 0 ? 0 : gameArea.offsetWidth - BALL_SIZE;
        
        // Small bonus for wall hits
        if (scoreMultiplier > 1) {
            const wallBonus = 2 * scoreMultiplier;
            currentScore += wallBonus;
            createScorePopup(
                ballX + (ballX <= 0 ? 0 : BALL_SIZE),
                ballY + BALL_SIZE/2,
                `+${wallBonus}`
            );
        }
        
        createParticleExplosion(
            ballX + (ballX <= 0 ? 0 : BALL_SIZE),
            ballY + BALL_SIZE/2,
            6
        );
        playSound('wall-hit');
    }

    if (ballY <= 0) {
        ballSpeedY = -ballSpeedY * 0.98;
        ballY = 0;
        
        // Bonus points for ceiling hits (requires skill)
        if (scoreMultiplier > 1) {
            const ceilingBonus = 3 * scoreMultiplier;
            currentScore += ceilingBonus;
            createScorePopup(
                ballX + BALL_SIZE/2,
                0,
                `+${ceilingBonus}`
            );
        }
        
        createParticleExplosion(
            ballX + BALL_SIZE/2,
            0,
            6
        );
        playSound('wall-hit');
    }
}

let lastTrailTime = 0;

function createBallTrail() {
    // Limit trail creation frequency
    const now = performance.now();
    if (now - lastTrailTime < 50) return; // Only create trail every 50ms
    lastTrailTime = now;
    
    const trail = document.createElement('div');
    trail.className = 'ball-trail';
    trail.style.left = ballX + 'px';
    trail.style.top = ballY + 'px';
    gameArea.appendChild(trail);
    
    // Remove trail after animation
    setTimeout(() => trail.remove(), 200);
}

function gameLoop() {
    if (gameStarted) {
        // Create ball trail effect when moving
        if (Math.abs(ballSpeedX) > 2 || Math.abs(ballSpeedY) > 2) {
            createBallTrail();
        }
        
        // Update ball position
        ballSpeedY += gravity;
        ballX += ballSpeedX;
        ballY += ballSpeedY;
        
        checkCollision();
        updateScore();
        
        // Update ball position
        ball.style.left = ballX + 'px';
        ball.style.top = ballY + 'px';
        
        // Check for game over
        if (ballY + ball.offsetHeight > gameArea.offsetHeight) {
            gameOver();
        }
    }
    
    animationFrameId = requestAnimationFrame(gameLoop);
}

// Enhanced game over screen
function gameOver() {
    gameStarted = false;
    playSound('game-over');
    
    // Stop game loop
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Hide paddle cursor and ball
    if (paddleCursor) {
        paddleCursor.style.display = 'none';
    }
    ball.style.visibility = 'hidden';
    
    // Create game over overlay
    const gameOverContainer = document.getElementById('game-over-container');
    const overlay = document.createElement('div');
    overlay.className = 'game-over-overlay';
    overlay.innerHTML = `
        <div class="game-over-content">
            <h2>Game Over!</h2>
            <div class="final-score">Score: ${currentScore}</div>
            ${currentScore > highScore ? '<div class="new-highscore">New High Score!</div>' : ''}
            <div class="game-over-buttons">
                <button class="menu-button primary" id="play-again-button">Play Again</button>
                <button class="menu-button" id="back-to-menu-button">Back to Menu</button>
            </div>
        </div>
    `;
    gameOverContainer.appendChild(overlay);
    
    // Add event listeners
    const playAgainButton = overlay.querySelector('#play-again-button');
    const backToMenuButton = overlay.querySelector('#back-to-menu-button');
    
    if (playAgainButton) {
        playAgainButton.addEventListener('click', resetGame);
    }
    
    if (backToMenuButton) {
        backToMenuButton.addEventListener('click', backToMenu);
    }
    
    // Animate overlay
    requestAnimationFrame(() => {
        overlay.classList.add('active');
    });
    
    // Add game over effects
    gameArea.classList.add('game-over');
    addScreenShake();
    
    // Create explosion effect
    const ballRect = ball.getBoundingClientRect();
    const gameRect = gameArea.getBoundingClientRect();
    createGameOverExplosion(
        ballRect.left - gameRect.left + ball.offsetWidth / 2,
        ballRect.top - gameRect.top + ball.offsetHeight / 2
    );
    
    // Flash the score
    const scoreValue = document.getElementById('score');
    scoreValue.classList.add('flash');
    setTimeout(() => scoreValue.classList.remove('flash'), 300);
    
    const finalScore = currentScore;
    if (finalScore > highScore) {
        highScore = finalScore;
        document.getElementById('highScore').textContent = highScore;
        localStorage.setItem('highScore', highScore.toString());
        
        // Flash high score
        const highScoreValue = document.getElementById('highScore');
        highScoreValue.classList.add('flash');
        setTimeout(() => highScoreValue.classList.remove('flash'), 300);
    }
    
    if (!isOnline) {
        pendingScores.push(finalScore);
        localStorage.setItem('pendingScores', JSON.stringify(pendingScores));
    } else {
        postWebViewMessage({
            type: 'gameOver',
            data: { finalScore }
        });
    }

    // Reset cursor and prevent game area interactions
    gameArea.style.cursor = 'default';
    gameArea.style.pointerEvents = 'none';
}

function resetGame() {
    // Remove game over overlay immediately
    const gameOverContainer = document.getElementById('game-over-container');
    if (gameOverContainer) {
        gameOverContainer.innerHTML = '';
    }
    
    // Show paddle cursor and ball again
    if (paddleCursor) {
        paddleCursor.style.display = 'block';
    }
    ball.style.visibility = 'visible';
    
    // Reset game state
    gameStarted = false;
    resetBall();
    resetMultiplier();
    currentScore = 0;
    document.getElementById('score').textContent = '0';
    gameArea.classList.remove('game-over');
    
    // Show instructions
    if (instructions) {
        instructions.textContent = 'Click to start!';
        instructions.style.display = 'block';
    }
    
    // Reset cursor and enable game area interactions
    gameArea.style.cursor = 'none';
    gameArea.style.pointerEvents = 'auto';
    
    // Re-add event listeners
    gameArea.removeEventListener('mousemove', handleMouseMove);
    gameArea.removeEventListener('touchmove', handleTouchMove);
    gameArea.removeEventListener('mousedown', startGame);
    gameArea.removeEventListener('touchstart', startGame);
    
    gameArea.addEventListener('mousemove', handleMouseMove);
    gameArea.addEventListener('touchmove', handleTouchMove, { passive: true });
    gameArea.addEventListener('mousedown', startGame);
    gameArea.addEventListener('touchstart', startGame, { passive: true });

    // Reset cursor position to center and update ball position
    cursorX = gameArea.offsetWidth / 2;
    cursorY = gameArea.offsetHeight - 100;
    lastCursorY = cursorY;
    updatePaddlePosition(cursorX, cursorY);
    
    // Restart game loop if it was stopped
    if (!animationFrameId) {
        animationFrameId = requestAnimationFrame(gameLoop);
    }
}

function backToMenu() {
    // Remove game over overlay
    const gameOverContainer = document.getElementById('game-over-container');
    gameOverContainer.innerHTML = '';
    
    // Clean up game screen
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    
    // Hide paddle cursor and show ball
    if (paddleCursor) {
        paddleCursor.style.display = 'none';
    }
    ball.style.visibility = 'visible';
    
    // Reset game state
    gameStarted = false;
    resetBall();
    resetMultiplier();
    currentScore = 0;
    document.getElementById('score').textContent = '0';
    gameArea.classList.remove('game-over');
    
    // Reset cursor and re-enable game area interactions
    gameArea.style.cursor = 'default';
    gameArea.style.pointerEvents = 'auto';
    
    // Switch to menu screen
    showScreen('menu');
}

// Modal Management
function showHowToPlayModal() {
    const modal = document.getElementById('how-to-play-modal');
    modal.classList.add('active');
    setTimeout(() => {
        modal.querySelector('.modal-content').style.transform = 'translateY(0)';
        modal.querySelector('.modal-content').style.opacity = '1';
    }, 50);
}

// Leaderboard Management
function updateLeaderboard(entries) {
    const leaderboardBody = document.getElementById('leaderboard-body');
    leaderboardBody.innerHTML = '';
    
    if (!entries || entries.length === 0) {
        const emptyRow = document.createElement('div');
        emptyRow.className = 'leaderboard-row empty';
        emptyRow.innerHTML = '<span>No scores yet. Be the first to play!</span>';
        leaderboardBody.appendChild(emptyRow);
        return;
    }

    entries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';
        if (entry.member === username) {
            row.classList.add('current-user');
        }
        
        // Create rank with medal for top 3
        const rankSpan = document.createElement('span');
        let rankText = (index + 1).toString();
        if (index === 0) rankText = '🥇 ' + rankText;
        else if (index === 1) rankText = '🥈 ' + rankText;
        else if (index === 2) rankText = '🥉 ' + rankText;
        rankSpan.textContent = rankText;
        
        // Create username span
        const usernameSpan = document.createElement('span');
        usernameSpan.textContent = entry.member;
        
        // Create score span
        const scoreSpan = document.createElement('span');
        scoreSpan.textContent = entry.score.toLocaleString();
        
        row.appendChild(rankSpan);
        row.appendChild(usernameSpan);
        row.appendChild(scoreSpan);
        
        // Add entrance animation delay
        row.style.animationDelay = `${index * 0.1}s`;
        leaderboardBody.appendChild(row);
    });
}

// Message handling functions
async function postWebViewMessage(msg, attempt = 0) {
  try {
    window.parent.postMessage(msg, '*');
    if (currentErrorState !== ErrorState.NONE) {
      const errorOverlay = document.querySelector('.error-overlay');
      if (errorOverlay) {
        errorOverlay.remove();
      }
      currentErrorState = ErrorState.NONE;
    }
  } catch (error) {
    console.error('Error posting message:', error);
    
    if (attempt < MAX_RETRY_ATTEMPTS) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return postWebViewMessage(msg, attempt + 1);
    }
    
    // Handle specific message types
    if (msg.type === 'gameOver') {
      storePendingScore(msg.data);
      showError(
        'Unable to save your score. Don\'t worry - it will be saved when connection is restored.',
        ErrorState.SAVE_ERROR
      );
    } else if (msg.type === 'webViewReady') {
      showError(
        'Unable to connect to game service. Retrying...',
        ErrorState.CONNECTION_ERROR
      );
      errorRetryTimeout = setTimeout(retryConnection, 5000);
    }
  }
}

function storePendingScore(data) {
    pendingScores.push(data);
    localStorage.setItem('pendingScores', JSON.stringify(pendingScores));
}

async function syncPendingScores() {
    if (!isOnline || pendingScores.length === 0) return;
    
    const scores = [...pendingScores];
    pendingScores = [];
    localStorage.setItem('pendingScores', JSON.stringify(pendingScores));
    
    for (const score of scores) {
        try {
            await postWebViewMessage({
                type: score.type,
                data: score
            });
        } catch (error) {
            // If sync fails, add back to pending scores
            pendingScores.push(score);
            localStorage.setItem('pendingScores', JSON.stringify(pendingScores));
            break;
        }
    }
}

window.addEventListener('message', async (event) => {
    if (!event.data || event.data.type !== 'devvit-message') return;
    
    const { message } = event.data.data;
    if (!message) return;
  
    switch (message.type) {
        case 'error':
            showError(message.data.message);
            break;
            
        case 'initialData':
            username = message.data.username;
            if (message.data.highScore > highScore) {
                highScore = message.data.highScore;
                localStorage.setItem('highScore', highScore.toString());
                document.getElementById('highScore').textContent = highScore;
            }
            break;
            
        case 'updateHighScore':
            if (message.data.highScore > highScore) {
                highScore = message.data.highScore;
                localStorage.setItem('highScore', highScore.toString());
                document.getElementById('highScore').textContent = highScore;
                showAchievement('New High Score!');
            }
            break;
            
        case 'updateLeaderboard':
            updateLeaderboard(message.data.leaderboard);
            break;
    }
});

function showAchievement(text) {
  const achievement = document.createElement('div');
  achievement.className = 'achievement';
  achievement.innerHTML = `
    <div class="achievement-icon trophy"></div>
    <div class="achievement-text">${text}</div>
  `;
  
  document.body.appendChild(achievement);
  
  // Trigger animation
  requestAnimationFrame(() => {
    achievement.classList.add('show');
    setTimeout(() => {
      achievement.classList.remove('show');
      setTimeout(() => achievement.remove(), 300);
    }, 3000);
  });
}

// Network state handlers
window.addEventListener('online', handleOnline);
window.addEventListener('offline', handleOffline);

function handleOffline() {
    isOnline = false;
}

async function handleOnline() {
    isOnline = true;
    await syncPendingScores();
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', () => {
    const savedPendingScores = localStorage.getItem('pendingScores');
    if (savedPendingScores) {
        try {
            pendingScores = JSON.parse(savedPendingScores);
        } catch (error) {
            console.error('Failed to load pending scores:', error);
        }
    }
    
    initMenu();
    postWebViewMessage({ type: 'webViewReady' });
});

// Particle System
function createParticleExplosion(x, y, count) {
    // Limit maximum particles for performance
    count = Math.min(count, 8);
    
    for (let i = 0; i < count; i++) {
        const particle = document.createElement('div');
        particle.className = 'particle';
        gameArea.appendChild(particle);
        
        const angle = (Math.random() * Math.PI * 2);
        const velocity = 2 + Math.random() * 2;
        const vx = Math.cos(angle) * velocity;
        const vy = Math.sin(angle) * velocity;
        let lifetime = 0;
        
        particle.style.left = x + 'px';
        particle.style.top = y + 'px';
        
        const startTime = performance.now();
        const duration = 500; // 0.5 seconds
        
        function updateParticle(currentTime) {
            const elapsed = currentTime - startTime;
            if (elapsed >= duration) {
                particle.remove();
                return;
            }
            
            lifetime = elapsed / duration;
            const newX = x + vx * lifetime * 60;
            const newY = y + vy * lifetime * 60;
            const opacity = 1 - lifetime;
            const scale = 1 - lifetime;
            
            particle.style.transform = `translate(${newX - x}px, ${newY - y}px) scale(${scale})`;
            particle.style.opacity = opacity;
            
            requestAnimationFrame(updateParticle);
        }
        
        requestAnimationFrame(updateParticle);
    }
}

// Sound System
const sounds = {
    'paddle-hit': {
        frequency: 220,
        type: 'sine',
        duration: 0.1,
        volume: 0.3
    },
    'wall-hit': {
        frequency: 440,
        type: 'sine',
        duration: 0.05,
        volume: 0.2
    },
    'game-over': {
        frequency: 110,
        type: 'sawtooth',
        duration: 0.5,
        volume: 0.4
    }
};

function playSound(soundName) {
    if (!window.AudioContext) return;
    
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const sound = sounds[soundName];
    if (!sound) return;
    
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();
    
    oscillator.type = sound.type;
    oscillator.frequency.value = sound.frequency;
    
    gainNode.gain.setValueAtTime(sound.volume, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + sound.duration);
    
    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);
    
    oscillator.start();
    oscillator.stop(ctx.currentTime + sound.duration);
}

// Screen shake effect
function addScreenShake() {
    gameArea.classList.add('screen-shake');
    setTimeout(() => {
        gameArea.classList.remove('screen-shake');
    }, 500);
}

function createGameOverExplosion(x, y) {
    const colors = [
        'var(--primary)',
        'var(--accent)',
        'var(--primary-light)',
        '#fff'
    ];
    
    // Create multiple rings of particles
    for (let ring = 0; ring < 3; ring++) {
        const particleCount = 12 + (ring * 8);
        const radius = 100 + (ring * 50);
        const delay = ring * 100;
        
        setTimeout(() => {
            for (let i = 0; i < particleCount; i++) {
                const particle = document.createElement('div');
                particle.className = 'particle';
                gameArea.appendChild(particle);
                
                const angle = (i / particleCount) * Math.PI * 2;
                const velocity = 3 + Math.random() * 2;
                const size = 4 + Math.random() * 4;
                
                particle.style.width = size + 'px';
                particle.style.height = size + 'px';
                particle.style.background = colors[Math.floor(Math.random() * colors.length)];
                
                let particleX = x;
                let particleY = y;
                let progress = 0;
                
                function updateParticle() {
                    progress += 1/60;
                    if (progress >= 1) {
                        particle.remove();
                        return;
                    }
                    
                    const distance = radius * Math.pow(progress, 0.5);
                    particleX = x + Math.cos(angle) * distance;
                    particleY = y + Math.sin(angle) * distance;
                    
                    const scale = 1 - progress;
                    const opacity = 1 - progress;
                    
                    particle.style.left = particleX + 'px';
                    particle.style.top = particleY + 'px';
                    particle.style.opacity = opacity;
                    particle.style.transform = `scale(${scale})`;
                    
                    requestAnimationFrame(updateParticle);
                }
                
                requestAnimationFrame(updateParticle);
            }
        }, delay);
    }
}

// Event listeners setup
function setupEventListeners() {
    const startBtn = document.getElementById('start-btn');
    const leaderboardBtn = document.getElementById('leaderboard-btn');
    const howToPlayBtn = document.getElementById('how-to-play-btn');
    const backToMenuBtn = document.getElementById('back-to-menu-btn');
    const closeModalBtn = document.querySelector('.modal-close');
    const tabButtons = document.querySelectorAll('.tab-button');

    startBtn?.addEventListener('click', () => showScreen('game'));
    leaderboardBtn?.addEventListener('click', () => showScreen('leaderboard'));
    howToPlayBtn?.addEventListener('click', showHowToPlayModal);
    backToMenuBtn?.addEventListener('click', () => showScreen('menu'));
    closeModalBtn?.addEventListener('click', hideHowToPlayModal);

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tab = button.dataset.tab;
            switchLeaderboardTab(tab);
        });
    });
}

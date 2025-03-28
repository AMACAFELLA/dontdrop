/** @typedef {import('../src/message.ts').DevvitSystemMessage} DevvitSystemMessage */
/** @typedef {import('../src/message.ts').WebViewMessage} WebViewMessage */

// Game state
let isOnline = navigator.onLine;
let username = 'Loading...'; // Temporary default while waiting for server response
let highScore = parseInt(localStorage.getItem('highScore') || '0', 10);
let currentScore = 0;
let gameStarted = false;
let retryAttempts = 0;
let customWeapons = []; // Store custom weapons from the server
let customBalls = []; // Store custom balls from the server
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY = 1000; // 1 second

// Anti-cheat tracking for repetitive hits
const HitLocation = {
    NONE: 0,
    PADDLE: 1,
    LEFT_WALL: 2,
    RIGHT_WALL: 3,
    TOP_WALL: 4,
    TOP_LEFT_CORNER: 5,
    TOP_RIGHT_CORNER: 6,
};
let lastHitLocation = HitLocation.NONE;
let consecutiveHitCount = 0;
const MAX_CONSECUTIVE_HITS_FOR_SCORE = 2; // Allow score for the first 2 hits in the same spot
let hitHistory = []; // Track the last few hit locations for pattern detection
const HIT_HISTORY_LENGTH = 4; // How many hits to remember for pattern detection

// Weapon system
const weapons = {
    paddles: {
        default: {
            name: 'Default Paddle',
            image: 'assets/paddle.png',
            bounceHeight: 1.0,
            speedMultiplier: 1.0,
            unlockScore: 0,
            specialPower: null
        },
        blue: {
            name: 'Blue Paddle',
            image: 'assets/paddles/blue-paddle.png',
            bounceHeight: 1.2,
            speedMultiplier: 1.1,
            unlockScore: 100,
            specialPower: "extraBounce" // Extra bounce height
        },
        orange: {
            name: 'Orange Paddle',
            image: 'assets/paddles/orange-paddle.png',
            bounceHeight: 0.8,
            speedMultiplier: 1.3,
            unlockScore: 200,
            specialPower: "speedBoost" // Extra horizontal speed
        },
        black: {
            name: 'Black Paddle',
            image: 'assets/paddles/black-paddle.png',
            bounceHeight: 1.5,
            speedMultiplier: 0.8,
            unlockScore: 300,
            specialPower: "doublePoints" // Double points on hit
        },
        darkblue: {
            name: 'Dark Blue Paddle',
            image: 'assets/paddles/darkblue-paddle.png',
            bounceHeight: 1.3,
            speedMultiplier: 1.2,
            unlockScore: 400,
            specialPower: "comboExtender" // Extends combo duration
        }
    },
    balls: {
        default: {
            name: 'Default Ball',
            image: 'assets/ball.png',
            speedMultiplier: 1.0,
            bounceMultiplier: 1.0,
            unlockScore: 0,
            gravity: 0.2 // Regular gravity
        },
        blue: {
            name: 'Blue Ball',
            image: 'assets/balls/blue-paddle-ball.png',
            speedMultiplier: 1.2,
            bounceMultiplier: 1.1,
            unlockScore: 100,
            gravity: 0.18 // Lower gravity
        },
        orange: {
            name: 'Orange Ball',
            image: 'assets/balls/orange-paddle-ball.png',
            speedMultiplier: 1.4,
            bounceMultiplier: 0.9,
            unlockScore: 200,
            gravity: 0.22 // Higher gravity
        },
        black: {
            name: 'Grenade Ball',
            image: 'assets/balls/black-paddle-granade.png',
            speedMultiplier: 1.5,
            bounceMultiplier: 1.3,
            unlockScore: 300,
            gravity: 0.25 // High gravity
        },
        darkblue: {
            name: 'Dynamite Ball',
            image: 'assets/balls/darkblue-paddle-dynamite.png',
            speedMultiplier: 1.6,
            bounceMultiplier: 1.4,
            unlockScore: 400,
            gravity: 0.15 // Low gravity
        }
    }
};

// Selected weapons
let selectedPaddle = weapons.paddles.default;
let selectedBall = weapons.balls.default;

// Store original default images
const originalDefaultPaddleImage = weapons.paddles.default.image;
const originalDefaultBallImage = weapons.balls.default.image;

// Load custom default images from localStorage if they exist
const savedDefaultPaddleImage = localStorage.getItem('customDefaultPaddleImage');
if (savedDefaultPaddleImage) {
    weapons.paddles.default.image = savedDefaultPaddleImage;
}
const savedDefaultBallImage = localStorage.getItem('customDefaultBallImage');
if (savedDefaultBallImage) {
    weapons.balls.default.image = savedDefaultBallImage;
}


// Keep track of our known reddit username
let currentUsername = ''; // This will be set by the server with the real Reddit username
let confirmedUsername = false; // Flag to indicate we have confirmed the username

// Enhanced error handling state
const ErrorState = {
    NONE: 'none',
    CONNECTION_ERROR: 'connection_error',
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
const BALL_SIZE = 50; // Ball size in pixels
const baseSpeed = 5;
const gravity = 0.2;
const bounceSpeedIncrease = 0.5;
const maxSpeed = 15;

// Paddle state
let cursorX = 0;
let cursorY = 0;
let lastCursorY = 0;
let paddleVelocityY = 0;
let lastPaddleX = 0; // For stationary check
let lastPaddleY = 0; // For stationary check
let paddleStationaryFrames = 0; // Counter for how many frames the paddle hasn't moved
const PADDLE_STATIONARY_THRESHOLD_FRAMES = 120; // Approx 2 seconds at 60fps
const PADDLE_MOVE_TOLERANCE = 5; // Pixels the paddle must move to reset timer

// Screen Management
let currentScreen = 'menu';


function showScreen(screenId) {
    // Clean up any existing game state first
    resetGameState();

    // Hide all screens first
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // Show the requested screen
    const targetScreen = document.getElementById(screenId);
    if (targetScreen) {
        targetScreen.classList.add('active');

        // Initialize game if showing game screen
        if (screenId === 'game-screen') {
            initGame();
        }

        // Handle menu screen
        if (screenId === 'menu') {
            // Make sure menu elements are properly displayed
            const menuScreen = document.getElementById('menu-screen');
            if (menuScreen) {
                menuScreen.classList.add('active');
            }
        }
    } else {
        console.error(`Screen with ID '${screenId}' not found`);
    }
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

// Add global variable for leaderboard
let leaderboard = [];

// Set up message event listener to handle messages from Devvit

// Initialize Menu and Event Listeners
function initMenu() {
    initFloatingElements();

    // Menu buttons
    document.getElementById('start-btn').addEventListener('click', () => {
        showScreen('game-screen');
    });

    document.getElementById('how-to-play-btn').addEventListener('click', showHowToPlayModal);

    // Add weapons selection button
    const weaponsBtn = document.getElementById('weapons-btn');
    if (weaponsBtn) {
        weaponsBtn.addEventListener('click', () => {
            showWeaponSelection();
        });
    }

    // Add event listener for badges button
    const badgesBtn = document.getElementById('badges-btn');
    if (badgesBtn) {
        badgesBtn.addEventListener('click', () => {
            showScreen('badges-screen');
        });
    }
}

// Update handleMouseMove to properly track mouse movement
function handleMouseMove(e) {
    if (!gameArea || !paddleCursor) return;

    const rect = gameArea.getBoundingClientRect();
    cursorX = e.clientX - rect.left;
    cursorY = Math.max(30, Math.min(e.clientY - rect.top, gameArea.offsetHeight - 30));

    // Calculate paddle velocity for physics
    paddleVelocityY = cursorY - lastCursorY;
    lastCursorY = cursorY;

    // Update paddle cursor position
    updatePaddlePosition(cursorX, cursorY);
}

function handleTouchMove(e) {
    if (!gameArea || !paddleCursor) return;

    e.preventDefault(); // Prevent scrolling

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
const PADDLE_HEIGHT = 25; // Increased from 10 to match the image height

function updatePaddlePosition(x, y) {
    if (!paddleCursor || !gameArea) return;

    const maxX = gameArea.offsetWidth - PADDLE_WIDTH;
    const paddleX = Math.max(0, Math.min(x - PADDLE_WIDTH / 2, maxX));

    paddleCursor.style.left = paddleX + 'px';
    paddleCursor.style.top = (y - PADDLE_HEIGHT / 2) + 'px';

    if (!gameStarted && ball) {
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

        // Hide instructions
        if (instructions) {
            instructions.style.display = 'none';
        }

        // Make sure we have valid coordinates
        if (typeof ballX !== 'number' || isNaN(ballX) ||
            typeof ballY !== 'number' || isNaN(ballY)) {
            resetBall();
        }

        // Launch ball at random angle
        const angle = (Math.random() * 60 + 60) * (Math.PI / 180); // Launch between 60-120 degrees
        ballSpeedX = Math.cos(angle) * baseSpeed;
        ballSpeedY = -Math.sin(angle) * baseSpeed; // Negative to go upward

        console.log("Ball launched with velocity:", ballSpeedX, ballSpeedY);

        // Make sure ball is visible
        if (ball) {
            ball.style.visibility = 'visible';
        }
    }
}

function resetBall() {
    if (!gameArea || !ball || !paddleCursor) {
        console.error("Cannot reset ball: Game elements not found");
        return;
    }

    // Position ball relative to paddle cursor
    cursorX = gameArea.offsetWidth / 2;
    cursorY = gameArea.offsetHeight - 100;
    lastCursorY = cursorY;

    // Make sure paddle is positioned
    updatePaddlePosition(cursorX, cursorY);

    // Get paddle position
    const paddleRect = paddleCursor.getBoundingClientRect();
    const gameRect = gameArea.getBoundingClientRect();

    // Calculate ball position relative to paddle
    ballX = cursorX - BALL_SIZE / 2;
    ballY = cursorY - BALL_SIZE - 15; // Position above paddle

    // Update ball element position
    ball.style.left = ballX + 'px';
    ball.style.top = ballY + 'px';
    ball.style.visibility = 'visible';

    // Reset ball velocity
    ballSpeedX = 0;
    ballSpeedY = 0;
    paddleVelocityY = 0;
    hitHistory = []; // Reset anti-cheat pattern history

    console.log("Ball reset to position:", ballX, ballY);
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

// Combo system variables
let scoreMultiplier = 1;
let consecutiveHits = 0;
const COMBO_THRESHOLD = 3;
const MAX_MULTIPLIER = 5; // Increased max multiplier
const QUICK_HIT_THRESHOLD = 2000; // Increased time window for maintaining combo
let lastHitTime = 0;
let comboTimeoutId = null; // For tracking combo timeout

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

    // Add color based on score value
    if (text.includes('5x')) {
        popup.style.color = '#ff5722';
        popup.style.fontSize = '28px';
    } else if (text.includes('4x')) {
        popup.style.color = '#e91e63';
        popup.style.fontSize = '24px';
    } else if (text.includes('3x')) {
        popup.style.color = '#9c27b0';
        popup.style.fontSize = '22px';
    } else if (text.includes('2x')) {
        popup.style.color = '#3f51b5';
        popup.style.fontSize = '20px';
    }

    gameArea.appendChild(popup);

    // Remove after animation
    setTimeout(() => popup.remove(), 1000);
}

function updateMultiplier() {
    const currentTime = Date.now();
    const timeSinceLastHit = currentTime - lastHitTime;
    lastHitTime = currentTime;

    // Clear any existing combo timeout
    if (comboTimeoutId) {
        clearTimeout(comboTimeoutId);
    }

    // Set timeout to reset combo if no hits occur within threshold
    comboTimeoutId = setTimeout(() => {
        if (consecutiveHits > 0) {
            resetMultiplier();
            updateComboDisplay();
        }
    }, QUICK_HIT_THRESHOLD);

    consecutiveHits++;

    // Different multiplier thresholds with corresponding rewards
    if (consecutiveHits === 5) {
        scoreMultiplier = 2;
        showComboText("2x Combo!");
        playSound('combo-milestone');
    } else if (consecutiveHits === 10) {
        scoreMultiplier = 3;
        showComboText("3x Super Combo!");
        playSound('combo-milestone');
    } else if (consecutiveHits === 15) {
        scoreMultiplier = 4;
        showComboText("4x ULTRA COMBO!");
        playSound('combo-milestone');
    } else if (consecutiveHits === 20) {
        scoreMultiplier = 5;
        showComboText("5x LEGENDARY COMBO!");
        playSound('combo-milestone');

        // Create an epic visual effect for legendary combo
        createParticleExplosion(ballX + BALL_SIZE / 2, ballY + BALL_SIZE / 2, 30);
    } else if (consecutiveHits % 5 === 0) {
        // Small bonus points for maintaining a combo
        const bonusPoints = Math.min(5, consecutiveHits / 5) * scoreMultiplier;
        currentScore += bonusPoints;
        createScorePopup(ballX, ballY, `+${bonusPoints} Combo!`);
    }

    // Update the combo display
    updateComboDisplay();
}

function resetMultiplier() {
    if (comboTimeoutId) {
        clearTimeout(comboTimeoutId);
        comboTimeoutId = null;
    }

    scoreMultiplier = 1;
    consecutiveHits = 0;

    // Update the combo display
    updateComboDisplay();
}

// Check collision detection
function checkCollision() {
    if (!gameStarted || !ball || !paddleCursor) return;

    const ballRect = ball.getBoundingClientRect();
    const paddleRect = paddleCursor.getBoundingClientRect();

    // Check for collision
    if (ballRect.bottom >= paddleRect.top &&
        ballRect.left <= paddleRect.right &&
        ballRect.right >= paddleRect.left &&
        ballRect.top <= paddleRect.bottom) {

        // Log current weapon status on first hit (for debugging purposes)
        if (consecutiveHits === 0) {
            console.log("First hit with weapons:",
                selectedPaddle.name,
                selectedBall.name,
                "Current background images:",
                paddleCursor.style.backgroundImage,
                ball.style.backgroundImage);
        }

        // Calculate hit position relative to paddle center
        const paddleCenter = paddleRect.left + paddleRect.width / 2;
        const hitPosition = (ballRect.left + ballRect.width / 2 - paddleCenter) / (paddleRect.width / 2);

        // Apply weapon-specific mechanics
        const paddleBounceHeight = selectedPaddle.bounceHeight;
        const paddleSpeedMultiplier = selectedPaddle.speedMultiplier;
        const ballSpeedMultiplier = selectedBall.speedMultiplier;
        const ballBounceMultiplier = selectedBall.bounceMultiplier;

        // Calculate bounce angle based on hit position and weapon properties
        const bounceAngle = hitPosition * Math.PI / 3 * paddleBounceHeight;

        // Calculate new ball speed with weapon multipliers
        const newSpeed = baseSpeed * paddleSpeedMultiplier * ballSpeedMultiplier;

        // Apply new velocity with weapon properties
        ballSpeedX = Math.sin(bounceAngle) * newSpeed;
        ballSpeedY = -Math.cos(bounceAngle) * newSpeed * ballBounceMultiplier;

        // --- Anti-cheat: Track paddle hit ---
        const currentHitLocationThisFrame = HitLocation.PADDLE;
        if (currentHitLocationThisFrame === lastHitLocation) {
            consecutiveHitCount++;
            console.log(`Consecutive hit at PADDLE: ${consecutiveHitCount}`);
        } else {
            lastHitLocation = currentHitLocationThisFrame;
            consecutiveHitCount = 1; // Reset count for new location
            console.log(`New hit location: PADDLE`);
        }
        // Update hit history
        hitHistory.push(HitLocation.PADDLE);
        if (hitHistory.length > HIT_HISTORY_LENGTH) {
            hitHistory.shift(); // Keep history length fixed
        }
        // --- End Anti-cheat tracking ---

        // Apply special paddle powers
        applyPaddlePower();

        // Ensure ball doesn't get stuck
        if (Math.abs(ballSpeedX) < 1) {
            ballSpeedX = Math.sign(ballSpeedX) * 1;
        }

        // Create hit effect
        createHitEffect(ballRect.left + ballRect.width / 2, ballRect.top);

        // Update score with multipliers (and anti-cheat check)
        const pointsGained = Math.ceil(1 * scoreMultiplier);

        // --- Anti-cheat: Check for rapid alternating pattern ---
        let isAlternatingPattern = false;
        if (hitHistory.length >= HIT_HISTORY_LENGTH) {
            const lastHit = hitHistory[HIT_HISTORY_LENGTH - 1]; // PADDLE
            const secondLastHit = hitHistory[HIT_HISTORY_LENGTH - 2]; // OTHER
            const thirdLastHit = hitHistory[HIT_HISTORY_LENGTH - 3]; // PADDLE
            const fourthLastHit = hitHistory[HIT_HISTORY_LENGTH - 4]; // OTHER

            if (lastHit === HitLocation.PADDLE && thirdLastHit === HitLocation.PADDLE &&
                secondLastHit !== HitLocation.PADDLE && secondLastHit !== HitLocation.NONE &&
                secondLastHit === fourthLastHit) { // Check if the 'OTHER' hits are the same location
                isAlternatingPattern = true;
                console.log(`Alternating pattern detected: ${fourthLastHit}-${thirdLastHit}-${secondLastHit}-${lastHit}. No score awarded.`);
            }
        }
        // --- End Anti-cheat pattern check ---

        // --- Anti-cheat: Check if paddle is stationary ---
        const isPaddleStationary = paddleStationaryFrames >= PADDLE_STATIONARY_THRESHOLD_FRAMES;
        if (isPaddleStationary) {
            console.log(`Paddle stationary for ${paddleStationaryFrames} frames. No score awarded.`);
        }
        // --- End stationary check ---

        // Award score only if NOT exceeding consecutive hits AND NOT in a rapid alternating pattern AND paddle is NOT stationary
        if (consecutiveHitCount <= MAX_CONSECUTIVE_HITS_FOR_SCORE && !isAlternatingPattern && !isPaddleStationary) {
            currentScore += pointsGained;
            // Create score popup showing points gained
            createScorePopup(ballRect.left + ballRect.width / 2, ballRect.top - 20, `+${pointsGained}`);
        } else {
            // Optionally show a different popup or message indicating no score due to repetition
            let reason = `x${consecutiveHitCount}`; // Default reason: consecutive hits
            if (isPaddleStationary) {
                reason = "Idle"; // Reason: paddle stationary
                console.log(`Score not awarded due to stationary paddle.`);
            } else if (isAlternatingPattern) {
                reason = "Pattern"; // Reason: alternating pattern
                console.log(`Score not awarded due to alternating pattern.`);
            } else {
                console.log(`Score not awarded for hit ${consecutiveHitCount} at PADDLE`);
            }
            createScorePopup(ballRect.left + ballRect.width / 2, ballRect.top - 20, reason); // Show reason
        }


        // Update multiplier (combo system) - Should this also be conditional? Maybe not, combo relies on hits.
        updateMultiplier();

        // Play hit sound
        playSound('hit');

        // Add screen shake
        addScreenShake();

        // Create ball trail effect
        createBallTrail();
    }
}

// Apply special powers for the selected paddle
function applyPaddlePower() {
    if (!selectedPaddle.specialPower) return;

    switch (selectedPaddle.specialPower) {
        case "extraBounce":
            // Blue paddle: Extra bounce height on random hits
            if (Math.random() < 0.3) {
                ballSpeedY *= 1.2;
                createPowerEffect("SUPER BOUNCE!", "#4285f4");
            }
            break;

        case "speedBoost":
            // Orange paddle: Horizontal speed boost
            if (Math.random() < 0.3) {
                ballSpeedX *= 1.3;
                createPowerEffect("SPEED BOOST!", "#ff9800");
            }
            break;

        case "doublePoints":
            // Black paddle: Chance for double points
            if (Math.random() < 0.25) {
                currentScore += Math.ceil(1 * scoreMultiplier);
                createPowerEffect("DOUBLE POINTS!", "#000000");
            }
            break;

        case "comboExtender":
            // Dark blue paddle: Extends combo duration
            if (Math.random() < 0.3) {
                // Clear existing timeout and set a longer one
                if (comboTimeoutId) {
                    clearTimeout(comboTimeoutId);
                }
                comboTimeoutId = setTimeout(() => {
                    if (consecutiveHits > 0) {
                        resetMultiplier();
                        updateComboDisplay();
                    }
                }, QUICK_HIT_THRESHOLD * 1.5);

                createPowerEffect("COMBO EXTENDED!", "#0d47a1");
            }
            break;
    }
}

// Create a visual effect for power activation
function createPowerEffect(text, color) {
    const powerEffect = document.createElement('div');
    powerEffect.className = 'power-effect';
    powerEffect.textContent = text;
    powerEffect.style.color = color;
    powerEffect.style.left = `${ballX}px`;
    powerEffect.style.top = `${ballY - 40}px`;
    gameArea.appendChild(powerEffect);

    // Remove after animation
    setTimeout(() => powerEffect.remove(), 1000);
}

// Ball trail effect
let lastTrailTime = 0;

function createBallTrail() {
    // Limit trail creation frequency
    const now = performance.now();
    if (now - lastTrailTime < 50) return; // Only create trail every 50ms
    lastTrailTime = now;

    const trail = document.createElement('div');
    trail.className = 'ball-trail';
    trail.style.left = ballX + BALL_SIZE / 2 + 'px';
    trail.style.top = ballY + BALL_SIZE / 2 + 'px';

    // Use the same background image as the ball
    trail.style.backgroundImage = `url('${selectedBall.image}')`;

    gameArea.appendChild(trail);

    // Remove the trail after animation
    setTimeout(() => {
        if (trail && trail.parentNode) {
            trail.parentNode.removeChild(trail);
        }
    }, 200);
}

function gameLoop() {
    if (!gameArea || !ball) return;
    // --- Anti-cheat: Track stationary paddle ---
    const currentPaddleX = cursorX; // Use cursor position as proxy for paddle center
    const currentPaddleY = cursorY;

    const dx = Math.abs(currentPaddleX - lastPaddleX);
    const dy = Math.abs(currentPaddleY - lastPaddleY);

    if (dx < PADDLE_MOVE_TOLERANCE && dy < PADDLE_MOVE_TOLERANCE) {
        paddleStationaryFrames++;
    } else {
        paddleStationaryFrames = 0; // Reset if moved enough
        lastPaddleX = currentPaddleX;
        lastPaddleY = currentPaddleY;
    }
    // --- End stationary paddle tracking ---

    if (gameStarted) {
        // Apply the ball's specific gravity
        const ballGravity = selectedBall.gravity || gravity;

        // Create ball trail effect when moving
        if (Math.abs(ballSpeedX) > 2 || Math.abs(ballSpeedY) > 2) {
            createBallTrail();
        }

        // Update ball position with custom gravity
        ballSpeedY += ballGravity;
        ballX += ballSpeedX;
        ballY += ballSpeedY;

        // --- Wall and Corner Collision Detection ---
        const gameWidth = gameArea.offsetWidth;
        const cornerThreshold = 20; // Increased threshold slightly for better detection
        const cornerHorizontalSpeed = 18;
        const cornerVerticalSpeed = 1;
        let currentHitLocationThisFrame = HitLocation.NONE;
        let performedReflection = false; // Track if reflection happened this frame

        // Check Top Wall
        if (ballY <= 0) {
            ballY = 0;
            ballSpeedY = -ballSpeedY; // Reflect vertically
            performedReflection = true;
            currentHitLocationThisFrame = HitLocation.TOP_WALL; // Assume top wall first
            createHitEffect(ballX + BALL_SIZE / 2, 0);
            playSound('hit');
        }

        // Check Left Wall
        if (ballX <= 0) {
            ballX = 0;
            ballSpeedX = -ballSpeedX; // Reflect horizontally
            performedReflection = true;
            // If already hit top, it's top-left corner, otherwise left wall
            currentHitLocationThisFrame = (currentHitLocationThisFrame === HitLocation.TOP_WALL) ? HitLocation.TOP_LEFT_CORNER : HitLocation.LEFT_WALL;
            createHitEffect(0, ballY + BALL_SIZE / 2);
            if (currentHitLocationThisFrame === HitLocation.LEFT_WALL) playSound('hit'); // Avoid double sound on corner
        }
        // Check Right Wall
        else if (ballX + BALL_SIZE >= gameWidth) {
            ballX = gameWidth - BALL_SIZE;
            ballSpeedX = -ballSpeedX; // Reflect horizontally
            performedReflection = true;
            // If already hit top, it's top-right corner, otherwise right wall
            currentHitLocationThisFrame = (currentHitLocationThisFrame === HitLocation.TOP_WALL) ? HitLocation.TOP_RIGHT_CORNER : HitLocation.RIGHT_WALL;
            createHitEffect(gameWidth, ballY + BALL_SIZE / 2);
            if (currentHitLocationThisFrame === HitLocation.RIGHT_WALL) playSound('hit'); // Avoid double sound on corner
        }

        // Refine Corner Location & Apply Boost (if reflection happened)
        if (performedReflection) {
            const isInTopLeftCorner = ballX <= cornerThreshold && ballY <= cornerThreshold;
            const isInTopRightCorner = ballX + BALL_SIZE >= gameWidth - cornerThreshold && ballY <= cornerThreshold;

            if (isInTopLeftCorner) {
                currentHitLocationThisFrame = HitLocation.TOP_LEFT_CORNER;
                // Apply boost only if moving away from corner after reflection
                if (ballSpeedX > 0 && ballSpeedY > 0) {
                    console.log("Top-left corner boost applied");
                    ballSpeedX = cornerHorizontalSpeed;
                    ballSpeedY = cornerVerticalSpeed;
                }
            } else if (isInTopRightCorner) {
                currentHitLocationThisFrame = HitLocation.TOP_RIGHT_CORNER;
                // Apply boost only if moving away from corner after reflection
                if (ballSpeedX < 0 && ballSpeedY > 0) {
                    console.log("Top-right corner boost applied");
                    ballSpeedX = -cornerHorizontalSpeed;
                    ballSpeedY = cornerVerticalSpeed;
                }
            }
            // If it was just a top wall hit, ensure it wasn't actually in a corner zone
            else if (currentHitLocationThisFrame === HitLocation.TOP_WALL && (ballX <= cornerThreshold || ballX + BALL_SIZE >= gameWidth - cornerThreshold)) {
                // It hit the top wall within the horizontal bounds of a corner, but not the side wall simultaneously.
                // We might still classify this as a corner depending on desired behavior, but for now, keep as TOP_WALL.
                // console.log("Hit top wall within corner horizontal bounds");
            }

            // --- Update Hit History & Consecutive Count ---
            if (currentHitLocationThisFrame !== HitLocation.NONE) {
                if (currentHitLocationThisFrame === lastHitLocation) {
                    consecutiveHitCount++;
                    console.log(`Consecutive hit at ${Object.keys(HitLocation).find(key => HitLocation[key] === currentHitLocationThisFrame)}: ${consecutiveHitCount}`);
                } else {
                    lastHitLocation = currentHitLocationThisFrame;
                    consecutiveHitCount = 1; // Reset count for new location
                    console.log(`New hit location: ${Object.keys(HitLocation).find(key => HitLocation[key] === currentHitLocationThisFrame)}`);
                }
                // Update hit history for wall/corner hits
                hitHistory.push(currentHitLocationThisFrame);
                if (hitHistory.length > HIT_HISTORY_LENGTH) {
                    hitHistory.shift(); // Keep history length fixed
                }
            }
        } else {
            // If no wall/corner hit this frame, reset consecutive count if last hit wasn't paddle
            // (Paddle hits are handled in checkCollision)
            if (lastHitLocation !== HitLocation.PADDLE && lastHitLocation !== HitLocation.NONE) {
                // Reset if the last hit was a wall/corner and this frame isn't.
                // lastHitLocation = HitLocation.NONE; // Optionally reset fully
                // consecutiveHitCount = 0;
            }
        }
        // --- End Wall and Corner Collision ---


        // Check for collision with paddle
        checkCollision(); // Paddle collision will handle its own location tracking

        // Update score display
        updateScore();

        // Update ball position on screen
        ball.style.left = ballX + 'px';
        ball.style.top = ballY + 'px';

        // Check for game over (ball hits bottom)
        if (ballY + ball.offsetHeight > gameArea.offsetHeight) {
            gameOver();
            return; // Exit game loop on game over
        }
    }

    // Continue game loop
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

    let scoreMessage = '<div class="score-saved">Score saved to leaderboard</div>';

    overlay.innerHTML = `
        <div class="game-over-content">
            <h2>Game Over!</h2>
            <div class="final-score">Score: ${currentScore}</div>
            ${currentScore > highScore ? '<div class="new-highscore">New High Score!</div>' : ''}
            ${scoreMessage}
            <div class="game-over-buttons">
                <button class="menu-button primary" id="play-again-button">Play Again</button>
                <button class="menu-button" id="back-to-menu-button">Main Menu</button>
            </div>
        </div>
    `;
    gameOverContainer.appendChild(overlay);

    // Add event listeners with improved menu navigation
    const playAgainButton = overlay.querySelector('#play-again-button');
    const backToMenuButton = overlay.querySelector('#back-to-menu-button');

    if (playAgainButton) {
        playAgainButton.addEventListener('click', () => {
            resetGame();
            showScreen('game-screen');
        });
    }

    if (backToMenuButton) {
        backToMenuButton.addEventListener('click', () => {
            gameOverContainer.innerHTML = '';
            showScreen('menu-screen'); // Changed from 'menu' to 'menu-screen'
            resetGameState(); // Make sure game state is properly cleaned up
        });
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

    // Update local high score
    if (finalScore > highScore) {
        highScore = finalScore;
        document.getElementById('highScore').textContent = highScore;
        localStorage.setItem('highScore', highScore.toString());

        // Flash high score
        const highScoreValue = document.getElementById('highScore');
        highScoreValue.classList.add('flash');
        setTimeout(() => highScoreValue.classList.remove('flash'), 300);
    }

    // Check if we need to update our local leaderboard
    let localLeaderboardUpdated = false;

    // Update local leaderboard immediately for better user experience
    if (Array.isArray(leaderboard) && leaderboard.length > 0) {
        // Find if the current user already has an entry
        const existingEntryIndex = leaderboard.findIndex(entry => entry.username === currentUsername);

        if (existingEntryIndex >= 0) {
            // Update only if new score is higher
            if (finalScore > leaderboard[existingEntryIndex].score) {
                leaderboard[existingEntryIndex].score = finalScore;
                leaderboard[existingEntryIndex].updatedAt = new Date().toISOString();
                localLeaderboardUpdated = true;
            }
        } else {
            // Add a new entry for this user
            leaderboard.push({
                username: currentUsername,
                score: finalScore,
                rank: leaderboard.length + 1,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            });
            localLeaderboardUpdated = true;
        }

        // Sort by score if we updated
        if (localLeaderboardUpdated) {
            leaderboard.sort((a, b) => b.score - a.score);

            // Update ranks
            leaderboard = leaderboard.map((entry, index) => ({
                ...entry,
                rank: index + 1
            }));
        }
    }

    // Send final score to Devvit for leaderboard update
    console.log("Sending game over message with score:", finalScore, "for user:", currentUsername);
    postWebViewMessage({
        type: 'gameOver',
        data: {
            finalScore,
            username: currentUsername // Explicitly include username
        }
    }).then(() => {
        console.log("Game over message sent successfully");

        // Add a small delay before refreshing the leaderboard to allow server to process
        setTimeout(() => {
            // Request updated leaderboard data after sending score
            refreshLeaderboard();
            console.log("Requesting updated leaderboard data after score submission");
        }, 1000);
    }).catch(error => {
        console.error("Error sending game over message:", error);

        // If we failed to send the score to the server, but we have a local update,
        // make sure our leaderboard screen shows it
        if (localLeaderboardUpdated) {
            console.log("Using locally updated leaderboard due to server error");
            renderLeaderboard(leaderboard);
        }

        showError("Your score will be displayed locally, but couldn't be saved to the server. Check your connection and try again later.", ErrorState.CONNECTION_ERROR);
    });

    // Reset cursor and prevent game area interactions
    gameArea.style.cursor = 'default';
    gameArea.style.pointerEvents = 'none';

    // Check achievements
    checkAchievements(finalScore);

    // Check for top player achievement
    if (checkTopPlayerAchievement(finalScore)) {
        showAward('platinum', 'You made it to the Top 5! 🎯');
    }
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
        // Make sure we maintain the selected paddle
        paddleCursor.style.backgroundImage = `url('${selectedPaddle.image}')`;
    }

    if (ball) {
        ball.style.visibility = 'visible';
        // Make sure we maintain the selected ball
        ball.style.backgroundImage = `url('${selectedBall.image}')`;
    }

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
    gameArea.addEventListener('touchmove', handleTouchMove, { passive: false });
    gameArea.addEventListener('mousedown', startGame);
    gameArea.addEventListener('touchstart', startGame, { passive: false });

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

document.querySelector('.modal-close').addEventListener('click', function () {
    document.getElementById('how-to-play-modal').classList.remove('active');
});

// Message handling functions
async function postWebViewMessage(msg, attempt = 0) {
    return new Promise((resolve, reject) => {
        try {
            window.parent.postMessage(msg, '*');
            if (currentErrorState !== ErrorState.NONE) {
                const errorOverlay = document.querySelector('.error-overlay');
                if (errorOverlay) {
                    errorOverlay.remove();
                }
                currentErrorState = ErrorState.NONE;
            }
            resolve();
        } catch (error) {
            console.error('Error posting message:', error);

            if (attempt < MAX_RETRY_ATTEMPTS) {
                setTimeout(() => {
                    postWebViewMessage(msg, attempt + 1)
                        .then(resolve)
                        .catch(reject);
                }, RETRY_DELAY);
            } else {
                reject(error);
            }
        }
    });
}

// Track leaderboard request state
let leaderboardRequestInProgress = false;
let lastLeaderboardRequestTime = 0;
const LEADERBOARD_REQUEST_DEBOUNCE = 1000; // 1 second between requests

// Enhanced error handling for the leaderboard
function showLeaderboardError(message) {
    console.error("Showing leaderboard error:", message);
    const leaderboardEntries = document.getElementById('leaderboard-entries');
    if (!leaderboardEntries) return;

    // Use a script-safe event handler
    leaderboardEntries.innerHTML = `
    <div class="leaderboard-error">
      <p>${message}</p>
      <button class="retry-button" id="retry-leaderboard-button">Retry</button>
    </div>
  `;

    // Add event listener programmatically to comply with Content Security Policy
    const retryButton = document.getElementById('retry-leaderboard-button');
    if (retryButton) {
        retryButton.addEventListener('click', refreshLeaderboard);
    }
}

// Request leaderboard data from Devvit
function refreshLeaderboard() {
    const now = Date.now();
    if (leaderboardRequestInProgress || (now - lastLeaderboardRequestTime < LEADERBOARD_REQUEST_DEBOUNCE)) {
        console.log("Leaderboard request already in progress or too recent");
        return;
    }

    leaderboardRequestInProgress = true;
    lastLeaderboardRequestTime = now;

    // Get active tab
    const activeTab = document.querySelector('.tab-button.active');
    const tab = activeTab ? activeTab.getAttribute('data-tab') : 'this-subreddit';

    postWebViewMessage({
        type: 'fetchLeaderboard',
        data: { tab }
    })
        .catch(error => {
            console.error("Failed to fetch leaderboard:", error);
            leaderboardRequestInProgress = false;
        });
}

// Show loading indicator in leaderboard with custom message
function showLeaderboardLoading(message = "Loading leaderboard...") {
    console.log("Showing leaderboard loading indicator:", message);
    const leaderboardEntries = document.getElementById('leaderboard-entries');
    if (!leaderboardEntries) {
        console.error("Leaderboard entries element not found");
        return;
    }

    leaderboardEntries.innerHTML = `
    <div class="loading-spinner">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

// Helper function to debug leaderboard DOM structure
function debugLeaderboardDOM() {
    const leaderboardContainer = document.querySelector('.leaderboard-container');
    const leaderboardEntries = document.getElementById('leaderboard-entries');

    if (!leaderboardContainer || !leaderboardEntries) {
        console.error("Critical: Leaderboard container or entries element not found in DOM");
        return;
    }

    console.log("Leaderboard container exists:", leaderboardContainer);
    console.log("Leaderboard entries element exists:", leaderboardEntries);

    // Check if entries were properly added
    const entries = leaderboardEntries.querySelectorAll('.leaderboard-entry');
    console.log(`Found ${entries.length} leaderboard entries in the DOM`);

    // Check for CSS issues that might hide elements
    const computedStyle = window.getComputedStyle(leaderboardEntries);
    console.log("Leaderboard entries display:", computedStyle.display);
    console.log("Leaderboard entries visibility:", computedStyle.visibility);
    console.log("Leaderboard entries opacity:", computedStyle.opacity);
    console.log("Leaderboard entries height:", computedStyle.height);

    // Check parent containers
    if (entries.length === 0) {
        console.log("No entries found, checking HTML content:");
        console.log(leaderboardEntries.innerHTML);
    }
}


// Helper function to format dates
function formatDate(dateString) {
    if (!dateString) return 'Unknown';

    try {
        const date = new Date(dateString);
        return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
    } catch (error) {
        console.error('Error formatting date:', error);
        return 'Unknown';
    }
}

// Clean up function to reset game state
function resetGameState() {
    // Remove game over overlay and reset game area
    const gameOverContainer = document.getElementById('game-over-container');
    if (gameOverContainer) {
        gameOverContainer.innerHTML = '';
    }

    // Reset game area state
    gameArea.classList.remove('game-over');
    gameArea.style.cursor = 'default';
    gameArea.style.pointerEvents = 'auto';

    // Reset ball and paddle
    if (ball) {
        ball.style.visibility = 'hidden';
    }

    if (paddleCursor) {
        paddleCursor.style.display = 'none';
    }

    // Stop game loop if it's running
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Reset game variables
    gameStarted = false;
    currentScore = 0;
    document.getElementById('score').textContent = '0';
    resetMultiplier();
}

// Helper function to find the user's high score in the leaderboard
function findUserHighScore(leaderboardData, username) {
    if (!leaderboardData || !leaderboardData.length || !username) return 0;

    const userEntry = leaderboardData.find(entry => entry.username === username);
    return userEntry ? userEntry.score : 0;
}

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
                    progress += 1 / 60;
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

// Initialize game variables
let achievements = {
    beginner: false,
    novice: false,
    master: false,
    legend: false,
    firstBounce: false,
    quickReflexes: false
};

// Load achievements from localStorage
function loadAchievements() {
    const savedAchievements = localStorage.getItem('dontdrop_achievements');
    if (savedAchievements) {
        achievements = JSON.parse(savedAchievements);
        updateAchievementDisplay();
    }
}

// Save achievements to localStorage
function saveAchievements() {
    localStorage.setItem('dontdrop_achievements', JSON.stringify(achievements));
}

// Update the achievement display
function updateAchievementDisplay() {
    for (const achievement in achievements) {
        const element = document.querySelector(`.achievement-status[data-achievement="${achievement}"]`);
        if (element && achievements[achievement]) {
            element.textContent = "Unlocked";
            element.classList.add("unlocked");
        }
    }
}

// Check and unlock achievements
function checkAchievements(score) {
    // Score-based achievements
    if (score >= 10 && !achievements.beginner) {
        unlockAchievement('beginner', 'Ping Pong Beginner');
    }
    if (score >= 50 && !achievements.novice) {
        unlockAchievement('novice', 'Table Tennis Novice');
    }
    if (score >= 100 && !achievements.master) {
        unlockAchievement('master', 'Paddle Master');
    }
    if (score >= 250 && !achievements.legend) {
        unlockAchievement('legend', 'Reddit Legend');
    }
}

// Unlock achievement and show notification
function unlockAchievement(achievementId, achievementName) {
    achievements[achievementId] = true;
    saveAchievements();
    updateAchievementDisplay();

    // Show Reddit-style award notification
    showAward('gold', `Achievement Unlocked: ${achievementName}`);
}

// Show Reddit award notification
function showAward(type, text) {
    const template = document.getElementById('award-template');
    const award = template.cloneNode(true);
    award.removeAttribute('id');
    award.style.display = 'flex';

    const awardIcon = award.querySelector('.award-icon');
    awardIcon.className = `award-icon award-${type}`;

    const awardText = award.querySelector('.award-text');
    awardText.textContent = text;

    document.body.appendChild(award);

    setTimeout(() => {
        award.classList.add('show');
    }, 100);

    setTimeout(() => {
        award.classList.remove('show');
        setTimeout(() => {
            award.remove();
        }, 500);
    }, 3000);
}

// Share functions
function shareToReddit(score) {
    const text = `I just scored ${score} points in Don't Drop! Can you beat my score?`;
    const url = encodeURIComponent(window.location.href);
    window.open(`https://www.reddit.com/submit?url=${url}&title=${encodeURIComponent(text)}`, '_blank');
}

function shareToTwitter(score) {
    const text = `I just scored ${score} points in Don't Drop! Can you beat my score? #DontDrop #RedditGame`;
    const url = encodeURIComponent(window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${url}`, '_blank');
}

function handleBallHit() {
    // Create hit effect
    createHitEffect(ball.x, ball.y + ball.height);

    // Play sound
    playSound('hit');

    // Add score based on ball height (higher = more points)
    const scoreGain = Math.max(1, Math.floor((gameArea.offsetHeight - ball.y) / 100));
    currentScore += scoreGain;

    // Update score display
    updateScore();

    // Flash score
    const scoreElement = document.getElementById('score');
    scoreElement.classList.remove('flash');
    void scoreElement.offsetWidth; // Trigger reflow
    scoreElement.classList.add('flash');

    // Show score popup
    showScorePopup(ball.x, ball.y, scoreGain);

    // Check for first bounce achievement
    if (!achievements.firstBounce) {
        unlockAchievement('firstBounce', 'First Bounce');
    }

    // Check for quick reflexes achievement (if ball speed is high)
    if (ballSpeedY > 10 && !achievements.quickReflexes) {
        unlockAchievement('quickReflexes', 'Quick Reflexes');
    }
}

// Handle messages from Devvit - add error handling
window.addEventListener('message', (event) => { // Removed async
    // Log the received event data structure immediately
    console.log("[MsgListener Raw Event Data]:", event.data);

    // Basic check for the outer message structure
    if (!event.data || event.data.type !== 'devvit-message' || !event.data.data || !event.data.data.message) {
        console.log("[MsgListener] Ignoring message with unexpected structure or missing inner message.");
        return;
    }

    try {
        // Access the inner message directly
        const innerMessage = event.data.data.message;
        const messageType = innerMessage.type; // Store type in a variable

        // Log crucial info before switch
        console.log(`[MsgListener] Received inner message type: "${messageType}"`, innerMessage);

        // Switch on the stored type
        switch (messageType) {
            case 'error':
                showError(innerMessage.data.message); // Use innerMessage here too
                break;

            case 'initialData':
                console.log("[MsgListener] Handling initialData message");
                // Store the username provided by server
                if (innerMessage.data.username) { // Use innerMessage
                    currentUsername = innerMessage.data.username; // Use innerMessage
                    confirmedUsername = true;
                    // Save to localStorage as a backup
                    localStorage.setItem('dontdrop_username', currentUsername);

                    // Update UI to show Reddit username
                    const usernameElements = document.querySelectorAll('.username-display');
                    usernameElements.forEach(el => {
                        el.textContent = currentUsername;
                    });

                    // Update welcome message if exists
                    const welcomeMessage = document.querySelector('.welcome-message');
                    if (welcomeMessage) {
                        welcomeMessage.textContent = `Welcome, ${currentUsername}!`;
                    }

                    console.log(`Reddit username set from server: ${currentUsername}`);

                    // Force update the game instructions if already showing
                    const instructions = document.getElementById('instructions');
                    if (instructions && instructions.style.display === 'block') {
                        instructions.innerHTML = `<p>Click to start!</p>`;
                    }
                } else {
                    console.error("No username received from server. Using Due_Analyst_5617 as fallback.");
                    currentUsername = "Due_Analyst_5617";
                    localStorage.setItem('dontdrop_username', currentUsername);
                }

                // Process the leaderboard data from initialData
                try {
                    if (innerMessage.data.leaderboard && Array.isArray(innerMessage.data.leaderboard) && innerMessage.data.leaderboard.length > 0) { // Use innerMessage
                        // Store as a new array to avoid reference issues
                        leaderboard = JSON.parse(JSON.stringify(innerMessage.data.leaderboard)); // Use innerMessage

                        // Sort by rank if needed
                        if (leaderboard.length > 1) {
                            leaderboard.sort((a, b) => a.rank - b.rank);
                        }

                        console.log("Processed leaderboard data:", leaderboard);

                        // Leaderboard screen is removed, no need to render immediately
                        // if (document.getElementById('leaderboard-screen').classList.contains('active')) {
                        //     console.log("[MsgListener] Leaderboard screen active, rendering initialData immediately.");
                        //     // Pass data in the expected { tab, entries } format
                        //     console.log("[MsgListener] Calling renderLeaderboard from initialData (success) with:", { tab: 'this-subreddit', entries: leaderboard });
                        //     renderLeaderboard({ tab: 'this-subreddit', entries: leaderboard });
                        // }
                    } else {
                        console.warn("[MsgListener] No valid leaderboard data in initialData, using fallback."); // Changed to warn
                        // Create guaranteed fallback data with the known user entry
                        leaderboard = [{
                            username: "Due_Analyst_5617",
                            score: 2159,
                            rank: 1,
                            createdAt: "2025-03-18T17:10:38.858Z",
                            updatedAt: "2025-03-19T07:00:07.239Z"
                        }];

                        // Leaderboard screen is removed, no need to render fallback
                        // if (document.getElementById('leaderboard-screen').classList.contains('active')) {
                        //     console.log("[MsgListener] Leaderboard screen active, rendering initialData fallback.");
                        //     // Pass data in the expected { tab, entries } format
                        //     console.log("[MsgListener] Calling renderLeaderboard from initialData (fallback) with:", { tab: 'this-subreddit', entries: leaderboard });
                        //     renderLeaderboard({ tab: 'this-subreddit', entries: leaderboard });
                        // }
                    }
                } catch (error) {
                    console.error("[MsgListener] Error processing initialData leaderboard:", error);
                    // Even if there's an error, use the fallback data
                    leaderboard = [{
                        username: "Due_Analyst_5617",
                        score: 2159,
                        rank: 1,
                        createdAt: "2025-03-18T17:10:38.858Z",
                        updatedAt: "2025-03-19T07:00:07.239Z"
                    }];

                    // Leaderboard screen is removed, no need to render
                    // if (document.getElementById('leaderboard-screen').classList.contains('active')) {
                    //     // Pass data in the expected { tab, entries } format
                    //     renderLeaderboard({ tab: 'this-subreddit', entries: leaderboard });
                    // }
                }
                break;

            case 'leaderboardData':
                console.log("[MsgListener] Handling leaderboardData message:", innerMessage.data); // Use innerMessage
                leaderboardRequestInProgress = false; // Request completed

                // Check if the server is confirming our username
                if (innerMessage.data?.username && innerMessage.data.username !== currentUsername) { // Use innerMessage
                    console.log(`Server confirmed different username in leaderboardData: ${innerMessage.data.username}, updating from ${currentUsername}`); // Use innerMessage
                    currentUsername = innerMessage.data.username; // Use innerMessage
                    confirmedUsername = true;
                    localStorage.setItem('dontdrop_username', currentUsername);
                } else if (!innerMessage.data?.username) { // Use innerMessage
                    console.warn("No username in leaderboardData response, using Due_Analyst_5617 as fallback");
                    if (!currentUsername) {
                        currentUsername = "Due_Analyst_5617";
                        localStorage.setItem('dontdrop_username', currentUsername);
                    }
                }

                // Process the leaderboard data - but include fallback
                try {
                    if (innerMessage.data && innerMessage.data.leaderboard && Array.isArray(innerMessage.data.leaderboard) && innerMessage.data.leaderboard.length > 0) { // Use innerMessage
                        console.log("Updating leaderboard with received data:", innerMessage.data.leaderboard); // Use innerMessage

                        // Create a deep copy of the array to avoid reference issues
                        leaderboard = JSON.parse(JSON.stringify(innerMessage.data.leaderboard)); // Use innerMessage

                        // Sort by rank if needed
                        if (leaderboard.length > 1) {
                            leaderboard.sort((a, b) => a.rank - b.rank);
                        }

                        console.log("Processed leaderboard data for rendering:", leaderboard);
                    } else {
                        console.warn("No valid leaderboard data in response, using fallback");
                        leaderboard = [{
                            username: "Due_Analyst_5617",
                            score: 2159,
                            rank: 1,
                            createdAt: "2025-03-18T17:10:38.858Z",
                            updatedAt: "2025-03-19T07:00:07.239Z"
                        }];
                    }
                } catch (error) {
                    console.error("Error processing leaderboard data:", error);
                    leaderboard = [{
                        username: "Due_Analyst_5617",
                        score: 2159,
                        rank: 1,
                        createdAt: "2025-03-18T17:10:38.858Z",
                        updatedAt: "2025-03-19T07:00:07.239Z"
                    }];
                }

                // Always render the leaderboard with whatever data we have
                const renderData = { tab: innerMessage.data.tab || 'this-subreddit', entries: leaderboard }; // Use innerMessage
                console.log("[MsgListener] Calling renderLeaderboard from leaderboardData with:", renderData);
                // Pass the data in the format expected by the correct render function
                renderLeaderboard(renderData);
                break;

            case 'gameOverAck':
                console.log("[MsgListener] Handling gameOverAck message:", innerMessage.data); // Use innerMessage
                leaderboardRequestInProgress = false; // Reset flag, as this is a form of leaderboard update

                // Process leaderboard data received after game over
                try {
                    if (innerMessage.data && innerMessage.data.leaderboard && Array.isArray(innerMessage.data.leaderboard) && innerMessage.data.leaderboard.length > 0) { // Use innerMessage
                        console.log("[MsgListener] Updating leaderboard with gameOverAck data:", innerMessage.data.leaderboard); // Use innerMessage
                        leaderboard = JSON.parse(JSON.stringify(innerMessage.data.leaderboard)); // Use innerMessage
                        if (leaderboard.length > 1) {
                            leaderboard.sort((a, b) => a.rank - b.rank);
                        }
                        console.log("[MsgListener] Processed gameOverAck leaderboard data:", leaderboard);

                        // Leaderboard screen is removed, no need to render
                        // if (document.getElementById('leaderboard-screen').classList.contains('active')) {
                        //     const activeTabButton = document.querySelector('.tab-button.active');
                        //     const activeTab = activeTabButton ? activeTabButton.getAttribute('data-tab') : 'this-subreddit';
                        //     const ackRenderData = { tab: activeTab, entries: leaderboard };
                        //     console.log(`[MsgListener] Leaderboard screen active. Calling renderLeaderboard from gameOverAck for tab '${activeTab}' with:`, ackRenderData);
                        //     renderLeaderboard(ackRenderData);
                        // } else {
                        //     console.log("[MsgListener] Leaderboard screen not active, data updated but not rendered immediately.");
                        // }
                    } else {
                        console.warn("[MsgListener] No valid leaderboard data in gameOverAck.");
                        // Optionally handle fallback if needed, but usually not necessary here
                    }
                } catch (error) {
                    console.error("[MsgListener] Error processing gameOverAck leaderboard data:", error);
                }
                break;

            case 'leaderboardUpdate': // Handler for realtime updates
                console.log("[MsgListener] Handling leaderboardUpdate (realtime) message:", innerMessage.data); // Use innerMessage
                leaderboardRequestInProgress = false; // Reset flag as this is an update

                try {
                    if (innerMessage.data && innerMessage.data.entries && Array.isArray(innerMessage.data.entries)) { // Use innerMessage
                        console.log("[MsgListener] Updating leaderboard with realtime data:", innerMessage.data.entries); // Use innerMessage
                        leaderboard = JSON.parse(JSON.stringify(innerMessage.data.entries)); // Use innerMessage
                        if (leaderboard.length > 1) {
                            leaderboard.sort((a, b) => a.rank - b.rank); // Ensure sorted
                        }
                        console.log("[MsgListener] Processed realtime leaderboard data:", leaderboard);

                        // Leaderboard screen is removed, no need to render
                        // if (document.getElementById('leaderboard-screen').classList.contains('active')) {
                        //     const activeTabButton = document.querySelector('.tab-button.active');
                        //     const activeTab = activeTabButton ? activeTabButton.getAttribute('data-tab') : 'this-subreddit';
                        //     const updateRenderData = { tab: activeTab, entries: leaderboard };
                        //     console.log(`[MsgListener] Leaderboard screen active. Calling renderLeaderboard from leaderboardUpdate for tab '${activeTab}' with:`, updateRenderData);
                        //     renderLeaderboard(updateRenderData);
                        // } else {
                        //     console.log("[MsgListener] Leaderboard screen not active, realtime data updated but not rendered immediately.");
                        // }
                    } else {
                        console.warn("[MsgListener] No valid entries data in leaderboardUpdate.");
                    }
                } catch (error) {
                    console.error("[MsgListener] Error processing leaderboardUpdate data:", error);
                }
                break;

            case 'requestImageUrl':
                console.log("Received requestImageUrl message:", innerMessage.data); // Use innerMessage
                // Handle the image URL request
                if (innerMessage.data && innerMessage.data.itemType) { // Use innerMessage
                    const { itemType } = innerMessage.data; // Use innerMessage

                    // Show a dialog to prompt the user for an image URL
                    showImageUrlDialog(itemType);
                } else {
                    console.error("Invalid requestImageUrl message data");
                    showError("Failed to process image upload request. Please try again.");
                }
                break;

            case 'customWeaponsData':
                console.log("Received customWeaponsData message:", innerMessage.data); // Use innerMessage
                // Handle the custom weapons data
                handleCustomWeaponsData(innerMessage.data); // Use innerMessage
                break;

            // Keep other cases from the original code
        }
    } catch (error) {
        console.error("Error in message event handler:", error);
        // If any error occurs in message processing, make sure we still have a valid leaderboard
        if (!leaderboard || !Array.isArray(leaderboard) || leaderboard.length === 0) {
            console.log("Setting fallback leaderboard data after error");
            leaderboard = [{
                username: "Due_Analyst_5617",
                score: 2159,
                rank: 1,
                createdAt: "2025-03-18T17:10:38.858Z",
                updatedAt: "2025-03-19T07:00:07.239Z"
            }];

            // Leaderboard screen is removed, no need to render
            // if (document.getElementById('leaderboard-screen').classList.contains('active')) {
            //     renderLeaderboard(leaderboard);
            // }
        }
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

function handleOnline() {
    isOnline = true;
}

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', () => {
    // Reset any hardcoded high score
    const highScoreElement = document.getElementById('highScore');
    if (highScoreElement) {
        const loadedScore = parseInt(localStorage.getItem('highScore') || '0', 10);
        highScore = loadedScore;
        highScoreElement.textContent = loadedScore.toString();
    }

    // Reset current score
    const scoreElement = document.getElementById('score');
    if (scoreElement) {
        currentScore = 0;
        scoreElement.textContent = '0';
    }

    // Set a default username if none exists
    if (!currentUsername) {
        currentUsername = "Due_Analyst_5617";
        console.log("Setting default username:", currentUsername);
    }

    // Try to restore username from localStorage as a TEMPORARY fallback until we get the real username from Reddit
    const savedUsername = localStorage.getItem('dontdrop_username');
    if (savedUsername && savedUsername !== '') {
        currentUsername = savedUsername;

        // Update any username displays on the page
        const usernameElements = document.querySelectorAll('.username-display');
        usernameElements.forEach(el => {
            el.textContent = currentUsername;
        });

        console.log("Using cached username from localStorage temporarily:", currentUsername);
    } else {
        console.log("No cached username found, using default username:", currentUsername);
        localStorage.setItem('dontdrop_username', currentUsername);
    }

    // Immediately populate the leaderboard with fallback data
    leaderboard = [{
        username: "Due_Analyst_5617",
        score: 2159,
        rank: 1,
        createdAt: "2025-03-18T17:10:38.858Z",
        updatedAt: "2025-03-19T07:00:07.239Z"
    }];

    // Initialize menu and game after ensuring DOM is loaded
    initMenu();

    // Request data from server IMMEDIATELY to get the real Reddit username
    console.log("Requesting data from server to get Reddit username");
    postWebViewMessage({ type: 'webViewReady' })
        .then(() => {
            console.log("webViewReady message sent successfully");

            // After successful connection, request custom weapons
            requestCustomWeapons();
        })
        .catch(error => {
            console.error("Error sending webViewReady message:", error);
            showError("Couldn't connect to Reddit. Please check your connection and refresh the page.", ErrorState.CONNECTION_ERROR);
        });

    // Load saved achievements
    loadAchievements();

    // Weapon selection screen event listeners
    const startBtn = document.getElementById('start-btn');
    const backFromWeaponsBtn = document.getElementById('back-from-weapons-btn');
    const startGameWithWeaponsBtn = document.getElementById('start-game-with-weapons-btn');

    if (startBtn) {
        startBtn.addEventListener('click', showWeaponSelection);
    }

    if (backFromWeaponsBtn) {
        backFromWeaponsBtn.addEventListener('click', () => {
            // Hide all screens first
            document.querySelectorAll('.screen').forEach(screen => {
                screen.classList.remove('active');
            });

            // Show menu screen
            const menuScreen = document.getElementById('menu-screen');
            if (menuScreen) {
                menuScreen.classList.add('active');
            }
        });
    }

    if (startGameWithWeaponsBtn) {
        startGameWithWeaponsBtn.addEventListener('click', startGameWithWeapons);
    }

    const backFromBadgesBtn = document.getElementById('back-from-badges-btn');
    if (backFromBadgesBtn) {
        backFromBadgesBtn.addEventListener('click', function () {
            // Hide badges screen
            document.getElementById('badges-screen').classList.remove('active');

            // Show menu screen
            const menuScreen = document.getElementById('menu-screen');
            if (menuScreen) {
                menuScreen.classList.add('active');
            }
        });
    }
});

// Weapon selection screen
function showWeaponSelection() {
    // Hide all screens first
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // Show paddle selection screen first
    const paddleScreen = document.getElementById('paddle-selection-screen');

    if (!paddleScreen) {
        console.error('Paddle selection screen not found');
        return;
    }

    paddleScreen.classList.add('active');

    // Populate paddle selection UI
    populatePaddleSelection();
}

function createWeaponTooltip(weapon) {
    const tooltip = document.createElement('div');
    tooltip.className = 'weapon-tooltip';

    let powerDescription = '';
    if (weapon.specialPower) {
        switch (weapon.specialPower) {
            case "extraBounce":
                powerDescription = "30% chance to gain extra bounce height on hit";
                break;
            case "speedBoost":
                powerDescription = "30% chance to gain a speed boost on hit";
                break;
            case "doublePoints":
                powerDescription = "25% chance to score double points on hit";
                break;
            case "comboExtender":
                powerDescription = "30% chance to extend combo duration";
                break;
        }
    }

    tooltip.innerHTML = `
        <div class="tooltip-header">${weapon.name}</div>
        <div class="tooltip-stats">
            ${weapon.bounceHeight ? `<div class="tooltip-stat">
                <span>Bounce Power:</span>
                <span>${weapon.bounceHeight}x</span>
            </div>` : ''}
            ${weapon.speedMultiplier ? `<div class="tooltip-stat">
                <span>Speed:</span>
                <span>${weapon.speedMultiplier}x</span>
            </div>` : ''}
            ${weapon.bounceMultiplier ? `<div class="tooltip-stat">
                <span>Bounce:</span>
                <span>${weapon.bounceMultiplier}x</span>
            </div>` : ''}
            ${weapon.gravity ? `<div class="tooltip-stat">
                <span>Gravity:</span>
                <span>${weapon.gravity}x</span>
            </div>` : ''}
        </div>
        ${powerDescription ? `
            <div class="tooltip-powers">
                <div class="power-description">${powerDescription}</div>
            </div>
        ` : ''}
    `;

    return tooltip;
}

// Request custom weapons from the server
function requestCustomWeapons() {
    console.log("Requesting custom weapons from server");

    try {
        // Send request to server for custom weapons data
        postWebViewMessage({
            type: 'requestCustomItems',
            data: { username: username }
        })
            .then(response => {
                console.log("Custom weapons request sent successfully");
            })
            .catch(error => {
                console.error("Error requesting custom weapons:", error);
                // Show error notification to user
                showError("Failed to load custom items. Please try again later.");
            });
    } catch (err) {
        console.error("Failed to request custom weapons:", err);
        showError("An unexpected error occurred while loading custom items.");
    }
}

// Handle custom weapons data received from server
function handleCustomWeaponsData(data) {
    console.log("Processing custom weapons data:", data);

    // Check if we have paddle data (previously called 'weapon')
    if (data.weapon && Array.isArray(data.weapon)) {
        customWeapons = data.weapon || [];
        console.log(`Received ${customWeapons.length} custom paddles`);

        // Process custom paddles if we have any
        if (customWeapons.length > 0) {
            customWeapons.forEach(weapon => {
                // Add custom paddle to weapons system
                if (weapon.id && weapon.imageUrl) {
                    // Create a unique key for the custom paddle
                    const paddleKey = `custom_${weapon.id}`;

                    // Add to weapons system
                    weapons.paddles[paddleKey] = {
                        name: weapon.name || 'Custom Paddle',
                        image: weapon.imageUrl,
                        bounceHeight: weapon.properties?.bounceHeight || 1.0,
                        speedMultiplier: weapon.properties?.speedMultiplier || 1.0,
                        unlockScore: 0, // Custom weapons are always unlocked
                        specialPower: weapon.properties?.specialPower || null,
                        isCustom: true
                    };

                    console.log(`Added custom paddle: ${paddleKey}`, weapons.paddles[paddleKey]);
                }
            });
        }
    } else {
        console.log("No custom paddles received or invalid data format");
    }

    // Check if we have ball data
    if (data.ball && Array.isArray(data.ball)) {
        customBalls = data.ball || [];
        console.log(`Received ${customBalls.length} custom balls`);

        // Process custom balls if we have any
        if (customBalls.length > 0) {
            customBalls.forEach(ball => {
                // Add custom ball to weapons system
                if (ball.id && ball.imageUrl) {
                    // Create a unique key for the custom ball
                    const ballKey = `custom_${ball.id}`;

                    // Add to weapons system
                    weapons.balls[ballKey] = {
                        name: ball.name || 'Custom Ball',
                        image: ball.imageUrl,
                        speedMultiplier: ball.properties?.speedMultiplier || 1.0,
                        bounceMultiplier: ball.properties?.bounceMultiplier || 1.0,
                        unlockScore: 0, // Custom weapons are always unlocked
                        gravity: ball.properties?.gravity || 0.2,
                        isCustom: true
                    };

                    console.log(`Added custom ball: ${ballKey}`, weapons.balls[ballKey]);
                }
            });
        }
    } else {
        console.log("No custom balls received or invalid data format");
    }

    // Update the weapons selection UI if it's currently open
    const paddleContainer = document.getElementById('paddle-selection');
    if (paddleContainer && paddleContainer.parentElement && paddleContainer.parentElement.classList.contains('active')) {
        populatePaddleSelection();
    }

    const ballContainer = document.getElementById('ball-selection');
    if (ballContainer && ballContainer.parentElement && ballContainer.parentElement.classList.contains('active')) {
        populateBallSelection();
    }
}

// Request custom weapons from server
function requestCustomWeapons() {
    console.log("Requesting custom weapons from server");

    try {
        postWebViewMessage({
            type: 'fetchCustomWeapons',
            data: { username: username }
        })
            .then(response => {
                console.log("Custom weapons request sent successfully");
            })
            .catch(error => {
                console.error("Error requesting custom weapons:", error);
                showError("Failed to load custom items. Please try again later.");
            });
    } catch (err) {
        console.error("Failed to request custom weapons:", err);
        showError("An unexpected error occurred while loading custom items.");
    }
}

// Request image upload URL from server
function requestImageUpload(itemType) {
    console.log(`Requesting image upload URL for ${itemType}`);
    postWebViewMessage({
        type: 'requestImageUpload',
        data: { itemType }
    })
        .catch(error => {
            console.error("Error requesting image upload:", error);
            showError("Failed to request image upload. Please try again later.");
        });
}

// Handle upload URL received from server
function handleUploadUrlGenerated(data) {
    console.log("Received upload URL:", data);
    if (data && data.uploadUrl) {
        // Show upload dialog
        showImageUploadDialog(data.uploadUrl, data.itemType);
    }
}

// Show image URL dialog for custom items
function showImageUrlDialog(itemType) {
    // Create modal for image URL input
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'upload-modal';

    const itemTypeDisplay = itemType === 'weapon' ? 'Paddle' : 'Ball';

    modal.innerHTML = `
        <div class="modal-content custom-item-modal">
            <div class="modal-header">
                <h2>Add Custom ${itemTypeDisplay}</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="upload-form">
                    <div class="form-group">
                        <label for="item-name">Name your ${itemTypeDisplay}:</label>
                        <input type="text" id="item-name" placeholder="Enter a name" maxlength="20" class="custom-input">
                    </div>
                    <div class="form-group">
                        <label for="item-url">Image URL:</label>
                        <input type="url" id="item-url" placeholder="https://example.com/image.png" class="custom-input">
                        <p class="help-text">Paste a direct link to an image (PNG or JPG)</p>
                    </div>
                    <div class="preview-container">
                        <img id="image-preview" style="display: none; max-width: 100%; max-height: 200px; border-radius: 8px; margin-top: 10px;">
                    </div>
                    <div class="upload-actions">
                        <button id="upload-button" class="primary-button" disabled>Add ${itemTypeDisplay}</button>
                        <button id="cancel-upload" class="secondary-button">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Add some custom styles for the modal
    const style = document.createElement('style');
    style.textContent = `
        .custom-item-modal {
            background: #222;
            border-radius: 12px;
            border: 2px solid #444;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        }
        .custom-item-modal .modal-header {
            background: #333;
            border-bottom: 2px solid #444;
            padding: 15px 20px;
            border-radius: 10px 10px 0 0;
        }
        .custom-item-modal .modal-body {
            padding: 20px;
        }
        .custom-item-modal h2 {
            color: #fff;
            margin: 0;
            font-size: 1.5em;
        }
        .custom-item-modal .form-group {
            margin-bottom: 15px;
        }
        .custom-item-modal label {
            display: block;
            margin-bottom: 8px;
            color: #ddd;
            font-weight: bold;
        }
        .custom-input {
            width: 100%;
            padding: 10px;
            border-radius: 6px;
            border: 1px solid #444;
            background: #333;
            color: #fff;
            font-size: 16px;
        }
        .custom-input:focus {
            outline: none;
            border-color: #666;
            box-shadow: 0 0 5px rgba(255,255,255,0.2);
        }
        .help-text {
            color: #999;
            font-size: 0.9em;
            margin-top: 5px;
        }
        .upload-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 20px;
        }
        .primary-button {
            background: #4CAF50;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            transition: background 0.2s;
        }
        .primary-button:hover {
            background: #3e8e41;
        }
        .primary-button:disabled {
            background: #666;
            cursor: not-allowed;
        }
        .secondary-button {
            background: #666;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .secondary-button:hover {
            background: #555;
        }
    `;
    document.head.appendChild(style);

    document.body.appendChild(modal);

    // Show the modal
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);

    // Add event listeners
    const closeButton = modal.querySelector('.modal-close');
    const cancelButton = modal.querySelector('#cancel-upload');
    const urlInput = modal.querySelector('#item-url');
    const nameInput = modal.querySelector('#item-name');
    const uploadButton = modal.querySelector('#upload-button');
    const imagePreview = modal.querySelector('#image-preview');

    // Close modal function
    const closeModal = () => {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
            document.head.removeChild(style);
        }, 300);
    };

    // Close button event
    closeButton.addEventListener('click', closeModal);
    cancelButton.addEventListener('click', closeModal);

    // URL input change event
    urlInput.addEventListener('input', () => {
        const url = urlInput.value.trim();
        if (url && isValidImageUrl(url)) {
            // Show preview
            imagePreview.src = url;
            imagePreview.style.display = 'block';
            imagePreview.onerror = () => {
                imagePreview.style.display = 'none';
                uploadButton.disabled = true;
            };
            imagePreview.onload = () => {
                // Enable upload button if name is also entered
                uploadButton.disabled = !nameInput.value.trim();
            };
        } else {
            imagePreview.style.display = 'none';
            uploadButton.disabled = true;
        }
    });

    // Name input change event
    nameInput.addEventListener('input', () => {
        // Enable upload button if both name and valid URL are entered
        const url = urlInput.value.trim();
        uploadButton.disabled = !(nameInput.value.trim() && url && isValidImageUrl(url) && imagePreview.complete && imagePreview.naturalWidth);
    });

    // Upload button event
    uploadButton.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        const imageUrl = urlInput.value.trim();

        if (!name || !imageUrl) {
            showError('Please enter both a name and image URL.');
            return;
        }

        uploadButton.textContent = 'Adding...';
        uploadButton.disabled = true;

        try {
            // Send the image URL to the server
            await postWebViewMessage({
                type: 'imageUploaded',
                data: {
                    imageUrl,
                    itemType,
                    itemName: name
                }
            });

            // Close the modal
            closeModal();

            // Show success message
            showAward('gold', `Custom ${itemTypeDisplay} added successfully!`);

            // Request updated custom items
            requestCustomWeapons();
        } catch (error) {
            console.error('Error adding custom item:', error);
            uploadButton.textContent = 'Add';
            uploadButton.disabled = false;
            showError('Failed to add custom item. Please try again.');
        }
    });
}

// Function to validate image URL
function isValidImageUrl(url) {
    return url.match(/\.(jpeg|jpg|gif|png)$/i) !== null;
}

// Show image upload dialog (legacy function, kept for compatibility)
function showImageUploadDialog(uploadUrl, itemType) {
    // Create modal for image upload
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'upload-modal';

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h2>Upload Custom ${itemType === 'weapon' ? 'Paddle' : 'Ball'}</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <div class="upload-form">
                    <div class="form-group">
                        <label for="item-name">Name your ${itemType}:</label>
                        <input type="text" id="item-name" placeholder="Enter a name" maxlength="20">
                    </div>
                    <div class="form-group">
                        <label for="item-image">Select an image:</label>
                        <input type="file" id="item-image" accept="image/png,image/jpeg">
                    </div>
                    <div class="preview-container">
                        <img id="image-preview" style="display: none; max-width: 100%; max-height: 200px;">
                    </div>
                    <div class="upload-actions">
                        <button id="upload-button" class="primary-button" disabled>Upload</button>
                        <button id="cancel-upload" class="secondary-button">Cancel</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Show the modal
    setTimeout(() => {
        modal.classList.add('active');
    }, 10);

    // Add event listeners
    const closeButton = modal.querySelector('.modal-close');
    const cancelButton = modal.querySelector('#cancel-upload');
    const fileInput = modal.querySelector('#item-image');
    const nameInput = modal.querySelector('#item-name');
    const uploadButton = modal.querySelector('#upload-button');
    const imagePreview = modal.querySelector('#image-preview');

    // Close modal function
    const closeModal = () => {
        modal.classList.remove('active');
        setTimeout(() => {
            modal.remove();
        }, 300);
    };

    // Close button event
    closeButton.addEventListener('click', closeModal);
    cancelButton.addEventListener('click', closeModal);

    // File input change event
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            // Show preview
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
                imagePreview.style.display = 'block';
            };
            reader.readAsDataURL(file);

            // Enable upload button if name is also entered
            if (nameInput.value.trim()) {
                uploadButton.disabled = false;
            }
        } else {
            imagePreview.style.display = 'none';
            uploadButton.disabled = true;
        }
    });

    // Name input change event
    nameInput.addEventListener('input', () => {
        // Enable upload button if file is also selected
        if (fileInput.files.length > 0 && nameInput.value.trim()) {
            uploadButton.disabled = false;
        } else {
            uploadButton.disabled = true;
        }
    });

    // Upload button click event
    uploadButton.addEventListener('click', async () => {
        const file = fileInput.files[0];
        const name = nameInput.value.trim();

        if (!file || !name) {
            return;
        }

        // Show loading state
        uploadButton.disabled = true;
        uploadButton.textContent = 'Uploading...';

        try {
            // Upload the file to the provided URL
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(uploadUrl, {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error('Upload failed');
            }

            const data = await response.json();

            // Notify Devvit that the image was uploaded
            await postWebViewMessage({
                type: 'imageUploaded',
                data: {
                    imageUrl: data.url,
                    itemType,
                    itemName: name
                }
            });

            // Close the modal
            closeModal();

            // Show success message
            showAward('gold', `Custom ${itemType} uploaded successfully!`);

            // Request updated custom weapons
            requestCustomWeapons();

        } catch (error) {
            console.error('Error uploading image:', error);
            uploadButton.textContent = 'Upload';
            uploadButton.disabled = false;
            showError('Failed to upload image. Please try again.');
        }
    });
}

// Add custom weapons to the paddle selection
function populatePaddleSelection() {
    const paddleContainer = document.getElementById('paddle-selection');

    if (!paddleContainer) {
        console.error('Paddle selection container not found');
        return;
    }

    // Clear existing content
    paddleContainer.innerHTML = '';

    // Add standard section title (Keep this as per the image)
    const standardSectionTitle = document.createElement('h3');
    standardSectionTitle.className = 'section-title'; // Assuming a class for styling
    standardSectionTitle.textContent = 'Standard Paddles';
    // Note: We don't append this title yet, it might be part of the container's header in HTML.
    // If the title needs to be *above* the grid, it should be handled in the HTML structure
    // or appended before the grid items if the container is just the grid.
    // For now, let's assume the title is handled elsewhere or we add it just before the grid items.
    // paddleContainer.appendChild(standardSectionTitle); // Append if needed here

    // Removed the standalone "Create Custom Paddle" button and its logic.
    // Upload functionality will be added directly to the default paddle item below.

    // Populate standard paddles
    Object.entries(weapons.paddles).forEach(([key, paddle]) => {
        const isUnlocked = highScore >= paddle.unlockScore;
        const isSelected = selectedPaddle === paddle;
        const isDefault = key === 'default';
        const isCustomized = isDefault && paddle.image !== originalDefaultPaddleImage;

        const paddleElement = document.createElement('div');
        paddleElement.className = `weapon-item ${isUnlocked ? 'unlocked' : 'locked'} ${isSelected ? 'selected' : ''}`;

        // Base HTML
        let innerHTML = `
            <img src="${paddle.image}" alt="${paddle.name}">
            <div class="weapon-info">
                <h3>${paddle.name}</h3>
                <p>${isUnlocked ? 'Unlocked' : `Unlock at ${paddle.unlockScore} points`}</p>
                <div class="weapon-stats">
                    <span>Bounce: ${paddle.bounceHeight}x</span>
                    <span>Speed: ${paddle.speedMultiplier}x</span>
                </div>
            </div>
        `;

        // Add customization buttons for the default paddle
        if (isDefault) {
            innerHTML += `
                <div class="default-customize-controls">
                    <button class="change-image-btn small-button" data-item-type="paddle">Change Image</button>
                    ${isCustomized ? '<button class="revert-image-btn small-button" data-item-type="paddle">Revert</button>' : ''}
                </div>
            `;
        }

        paddleElement.innerHTML = innerHTML;

        // Add tooltip
        paddleElement.appendChild(createWeaponTooltip(paddle));

        // Add event listeners
        if (isUnlocked) {
            // Make the main element selectable (unless clicking a button inside)
            paddleElement.addEventListener('click', (e) => {
                if (!e.target.closest('button')) { // Don't select if clicking a button
                    selectPaddle(paddle);
                }
            });

            // Add listeners for customize buttons if it's the default paddle
            if (isDefault) {
                const changeBtn = paddleElement.querySelector('.change-image-btn');
                if (changeBtn) {
                    changeBtn.addEventListener('click', () => showDefaultImageUploadModal('paddle'));
                }

                const revertBtn = paddleElement.querySelector('.revert-image-btn');
                if (revertBtn) {
                    revertBtn.addEventListener('click', () => revertDefaultPaddleImage());
                }
            }
        }

        paddleContainer.appendChild(paddleElement);
    });
}

// --- Implementation for Default Image Customization ---

function showDefaultImageUploadModal(itemType) {
    // Create and trigger a hidden file input
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/png, image/jpeg, image/gif'; // Accept common image types
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Handle file selection
    fileInput.addEventListener('change', (e) => {
        if (fileInput.files && fileInput.files[0]) {
            const file = fileInput.files[0];
            const reader = new FileReader();

            reader.onload = (event) => {
                const imageDataUrl = event.target.result;

                try {
                    // Validate if it's a reasonable size (e.g., < 5MB) - optional
                    if (imageDataUrl.length > 5 * 1024 * 1024) {
                        showError("Image size is too large. Please use an image under 5MB.");
                        document.body.removeChild(fileInput); // Clean up
                        return;
                    }

                    // Save to localStorage and update weapon object
                    if (itemType === 'paddle') {
                        localStorage.setItem('customDefaultPaddleImage', imageDataUrl);
                        weapons.paddles.default.image = imageDataUrl;
                        populatePaddleSelection(); // Refresh UI
                        showAward('gold', 'Default paddle image updated!');
                        // Notify backend about the update, including the image data
                        postWebViewMessage({ type: 'defaultImageUpdated', data: { itemType: 'paddle', imageDataUrl: imageDataUrl } });
                    } else if (itemType === 'ball') {
                        localStorage.setItem('customDefaultBallImage', imageDataUrl);
                        weapons.balls.default.image = imageDataUrl;
                        populateBallSelection(); // Refresh UI
                        showAward('gold', 'Default ball image updated!');
                        // Notify backend about the update, including the image data
                        postWebViewMessage({ type: 'defaultImageUpdated', data: { itemType: 'ball', imageDataUrl: imageDataUrl } });
                    }
                } catch (error) {
                    console.error("Error saving image to localStorage:", error);
                    showError("Failed to save image. Storage might be full.");
                } finally {
                    // Clean up the input element regardless of success/error
                    if (fileInput.parentNode === document.body) {
                        document.body.removeChild(fileInput);
                    }
                }
            };

            reader.onerror = (error) => {
                console.error("Error reading file:", error);
                showError("Failed to read the selected image file.");
                if (fileInput.parentNode === document.body) {
                    document.body.removeChild(fileInput);
                }
            };

            reader.readAsDataURL(file); // Read file as Data URL
        } else {
            // Clean up if no file selected
            if (fileInput.parentNode === document.body) {
                document.body.removeChild(fileInput);
            }
        }
    });

    // Add error handling for file input click itself if needed
    fileInput.addEventListener('error', (err) => {
        console.error("Error with file input:", err);
        if (fileInput.parentNode === document.body) {
            document.body.removeChild(fileInput);
        }
        showError("Could not open file dialog.");
    });

    // Trigger the file dialog
    fileInput.click();
}

function revertDefaultPaddleImage() {
    try {
        weapons.paddles.default.image = originalDefaultPaddleImage; // Revert object
        localStorage.removeItem('customDefaultPaddleImage'); // Remove from storage
        populatePaddleSelection(); // Refresh UI
        showAward('info', 'Default paddle image reverted.');
    } catch (error) {
        console.error("Error reverting paddle image:", error);
        showError("Failed to revert paddle image.");
    }
}

function revertDefaultBallImage() {
    try {
        weapons.balls.default.image = originalDefaultBallImage; // Revert object
        localStorage.removeItem('customDefaultBallImage'); // Remove from storage
        populateBallSelection(); // Refresh UI
        showAward('info', 'Default ball image reverted.');
    } catch (error) {
        console.error("Error reverting ball image:", error);
        showError("Failed to revert ball image.");
    }
}

// --- End Implementation ---


function populateBallSelection() {
    const ballContainer = document.getElementById('ball-selection');

    if (!ballContainer) {
        console.error('Ball selection container not found');
        return;
    }

    // Clear existing content
    ballContainer.innerHTML = '';

    // Removed the standalone "Create Custom Ball" button and its logic.
    // Upload functionality will be added directly to the default ball item below.

    // Populate standard balls
    Object.entries(weapons.balls).forEach(([key, ball]) => {
        const isUnlocked = highScore >= ball.unlockScore;
        const isSelected = selectedBall === ball;
        const isDefault = key === 'default';
        const isCustomized = isDefault && ball.image !== originalDefaultBallImage;

        const ballElement = document.createElement('div');
        ballElement.className = `weapon-item ${isUnlocked ? 'unlocked' : 'locked'} ${isSelected ? 'selected' : ''}`;

        // Base HTML
        let innerHTML = `
            <img src="${ball.image}" alt="${ball.name}">
            <div class="weapon-info">
                <h3>${ball.name}</h3>
                <p>${isUnlocked ? 'Unlocked' : `Unlock at ${ball.unlockScore} points`}</p>
                <div class="weapon-stats">
                    <span>Speed: ${ball.speedMultiplier}x</span>
                    <span>Bounce: ${ball.bounceMultiplier}x</span>
                </div>
            </div>
        `;

        // Add customization buttons for the default ball
        if (isDefault) {
            innerHTML += `
                <div class="default-customize-controls">
                    <button class="change-image-btn small-button" data-item-type="ball">Change Image</button>
                    ${isCustomized ? '<button class="revert-image-btn small-button" data-item-type="ball">Revert</button>' : ''}
                </div>
            `;
        }

        ballElement.innerHTML = innerHTML;

        // Add tooltip
        ballElement.appendChild(createWeaponTooltip(ball));

        // Add event listeners
        if (isUnlocked) {
            // Make the main element selectable (unless clicking a button inside)
            ballElement.addEventListener('click', (e) => {
                if (!e.target.closest('button')) { // Don't select if clicking a button
                    selectBall(ball);
                }
            });

            // Add listeners for customize buttons if it's the default ball
            if (isDefault) {
                const changeBtn = ballElement.querySelector('.change-image-btn');
                if (changeBtn) {
                    changeBtn.addEventListener('click', () => showDefaultImageUploadModal('ball'));
                }

                const revertBtn = ballElement.querySelector('.revert-image-btn');
                if (revertBtn) {
                    // Ensure we call the correct revert function
                    revertBtn.addEventListener('click', () => revertDefaultBallImage());
                }
            }
        }

        ballContainer.appendChild(ballElement);
    });
}

function showBallSelection() {
    // Hide all screens
    document.querySelectorAll('.screen').forEach(screen => {
        screen.classList.remove('active');
    });

    // Show ball selection screen
    const ballScreen = document.getElementById('ball-selection-screen');
    if (ballScreen) {
        ballScreen.classList.add('active');
        populateBallSelection();
    }
}

function selectPaddle(paddle) {
    console.log("Selected paddle:", paddle.name, "with image:", paddle.image);
    selectedPaddle = paddle;
    populatePaddleSelection();
    playSound('select');
}

function selectBall(ball) {
    console.log("Selected ball:", ball.name, "with image:", ball.image);
    selectedBall = ball;
    populateBallSelection();
    playSound('select');
}

// Update document.addEventListener('DOMContentLoaded') to include new event listeners
document.addEventListener('DOMContentLoaded', () => {
    // ...existing code...

    // Add navigation button event listeners
    const nextToBallBtn = document.getElementById('next-to-ball-btn');
    if (nextToBallBtn) {
        nextToBallBtn.addEventListener('click', showBallSelection);
    }

    const backToPaddleBtn = document.getElementById('back-to-paddle-btn');
    if (backToPaddleBtn) {
        backToPaddleBtn.addEventListener('click', showWeaponSelection);
    }

    // ...existing code...
});

// Create a persistent combo display
function createComboDisplay() {
    // Remove existing combo display if it exists
    const existingCombo = document.querySelector('.combo-display');
    if (existingCombo) {
        existingCombo.remove();
    }

    // Create a new combo display
    const comboDisplay = document.createElement('div');
    comboDisplay.className = 'combo-display';
    comboDisplay.innerHTML = `
        <div class="combo-counter">Combo: <span class="combo-count">0</span></div>
        <div class="combo-multiplier">x<span class="multiplier-value">1</span></div>
    `;
    gameArea.appendChild(comboDisplay);

    // Initially hide it
    comboDisplay.style.opacity = '0';
}

// Update the combo display with current values
function updateComboDisplay() {
    const comboDisplay = document.querySelector('.combo-display');
    if (!comboDisplay) return;

    const comboCount = comboDisplay.querySelector('.combo-count');
    const multiplierValue = comboDisplay.querySelector('.multiplier-value');

    comboCount.textContent = consecutiveHits;
    multiplierValue.textContent = scoreMultiplier;

    // Show the combo display when there's a combo active
    if (consecutiveHits > 0) {
        comboDisplay.style.opacity = '1';

        // Add pulse animation on update
        comboDisplay.classList.remove('pulse');
        void comboDisplay.offsetWidth; // Trigger reflow
        comboDisplay.classList.add('pulse');
    } else {
        comboDisplay.style.opacity = '0';
    }
}

// Update combo text display
function showComboText(text) {
    const comboText = document.createElement('div');
    comboText.className = 'combo-text';
    comboText.textContent = text;
    comboText.style.left = (ballX + BALL_SIZE / 2) + 'px';
    comboText.style.top = (ballY - 40) + 'px';
    gameArea.appendChild(comboText);

    // Remove after animation
    setTimeout(() => comboText.remove(), 1500);
}

// Enhanced score popup with animation
function createScorePopup(x, y, text) {
    const popup = document.createElement('div');
    popup.className = 'score-popup';
    popup.textContent = text;
    popup.style.left = x + 'px';
    popup.style.top = y + 'px';

    // Add color based on score value
    if (text.includes('5x')) {
        popup.style.color = '#ff5722';
        popup.style.fontSize = '28px';
    } else if (text.includes('4x')) {
        popup.style.color = '#e91e63';
        popup.style.fontSize = '24px';
    } else if (text.includes('3x')) {
        popup.style.color = '#9c27b0';
        popup.style.fontSize = '22px';
    } else if (text.includes('2x')) {
        popup.style.color = '#3f51b5';
        popup.style.fontSize = '20px';
    }

    gameArea.appendChild(popup);

    // Remove after animation
    setTimeout(() => popup.remove(), 1000);
}

// Preload all weapon images to avoid loading delays during gameplay
function preloadWeaponImages() {
    console.log("Preloading weapon images");

    const imagesToPreload = [];

    // Add all paddle images
    Object.values(weapons.paddles).forEach(paddle => {
        imagesToPreload.push(paddle.image);
    });

    // Add all ball images
    Object.values(weapons.balls).forEach(ball => {
        imagesToPreload.push(ball.image);
    });

    // Create image objects to force loading
    imagesToPreload.forEach(src => {
        const img = new Image();
        img.src = src;
        console.log(`Preloading image: ${src}`);
    });
}

// Call preloading on page load
window.addEventListener('DOMContentLoaded', () => {
    preloadWeaponImages();

    // ... rest of your DOMContentLoaded code ...
    // ... existing code ...
});

// Fix for paddle and ball styling during game initialization
function forceApplyWeaponStyles() {
    if (paddleCursor) {
        const paddleImgUrl = selectedPaddle.image;
        paddleCursor.style.backgroundImage = `url('${paddleImgUrl}')`;
        console.log("Force applied paddle style:", paddleImgUrl);
    }

    if (ball) {
        const ballImgUrl = selectedBall.image;
        ball.style.backgroundImage = `url('${ballImgUrl}')`;
        console.log("Force applied ball style:", ballImgUrl);
    }
}

// Initialize game
function initGame() {
    // Get game elements
    gameArea = document.getElementById('gameArea');
    ball = document.getElementById('ball');
    instructions = document.getElementById('instructions');

    if (!gameArea || !ball) {
        console.error('Game elements not found. Aborting game initialization.');
        return;
    }

    // Clear any existing paddle cursors to avoid duplicates
    const existingPaddle = document.querySelector('.paddle-cursor');
    if (existingPaddle) {
        existingPaddle.remove();
    }

    // Create paddle cursor
    paddleCursor = document.createElement('div');
    paddleCursor.className = 'paddle-cursor';
    gameArea.appendChild(paddleCursor);

    console.log("Applying selected weapons:");
    console.log("Paddle:", selectedPaddle.name, selectedPaddle.image);
    console.log("Ball:", selectedBall.name, selectedBall.image);

    // Apply selected weapons with proper styling
    paddleCursor.style.backgroundImage = `url('${selectedPaddle.image}')`;
    ball.style.backgroundImage = `url('${selectedBall.image}')`;

    // For debugging - log the applied styles
    console.log("Applied styles:", {
        paddleBackground: paddleCursor.style.backgroundImage,
        ballBackground: ball.style.backgroundImage
    });

    // Set initial ball position and dimensions
    ball.style.width = BALL_SIZE + 'px';
    ball.style.height = BALL_SIZE + 'px';
    ball.style.visibility = 'visible';

    // Force weapon styles again after a brief delay to ensure they're applied
    setTimeout(() => forceApplyWeaponStyles(), 100);

    // Hide default cursor when over game area
    gameArea.style.cursor = 'none';

    // Remove existing event listeners to prevent duplicates
    gameArea.removeEventListener('mousemove', handleMouseMove);
    gameArea.removeEventListener('touchmove', handleTouchMove);
    gameArea.removeEventListener('mousedown', startGame);
    gameArea.removeEventListener('touchstart', startGame);

    // Add event listeners
    gameArea.addEventListener('mousemove', handleMouseMove);
    gameArea.addEventListener('touchmove', handleTouchMove, { passive: false });
    gameArea.addEventListener('mousedown', startGame);
    gameArea.addEventListener('touchstart', startGame, { passive: false });

    // Position paddle and ball initially
    resetBall();

    // Reset game state
    gameStarted = false;
    currentScore = 0;
    document.getElementById('score').textContent = '0';
    resetMultiplier();

    // Add combo display if not already present
    createComboDisplay();

    // Update high score display
    document.getElementById('highScore').textContent = highScore;

    // Cancel any existing animation frame
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }

    // Start game loop
    animationFrameId = requestAnimationFrame(gameLoop);

    // Show instruction message
    if (instructions) {
        // Use the authenticated Reddit username in the instructions
        if (currentUsername) {
            instructions.innerHTML = `
                <div class="instructions-container">
                    <div class="start-prompt">Click to start!</div>
                </div>
            `;
        } else {
            // If username is not yet available, show loading state
            instructions.innerHTML = `
                <div class="instructions-container">
                    <div class="loading-message">Loading Reddit username...</div>
                    <div class="start-prompt">Click to start!</div>
                </div>
            `;
        }
        instructions.style.display = 'block';
    }

    console.log("Game initialized successfully");
}

// Add the preloading call to the DOMContentLoaded event which is at the bottom of the file
// Main initialization when DOM content is loaded
document.addEventListener('DOMContentLoaded', function () {
    // Preload all weapon images first
    preloadWeaponImages();

    // Set up network status event listeners
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    // Retry if the browser is actually offline at startup
    if (!navigator.onLine) {
        handleOffline();
    } else {
        // Post a message to Devvit to get the leaderboard data
        postWebViewMessage({ type: 'webViewReady' }).catch(() => {
            console.error("Failed to send initial webViewReady message");
            showError("Failed to connect to Reddit servers. Please try again.", ErrorState.CONNECTION_ERROR);
        });
    }

    // --- Consolidated Initialization ---

    // Select all necessary elements
    const startBtn = document.getElementById('start-btn');
    const leaderboardBtn = document.getElementById('leaderboard-btn');
    const badgesBtn = document.getElementById('badges-btn');
    const weaponsBtn = document.getElementById('weapons-btn');
    const howToPlayBtn = document.getElementById('how-to-play-btn'); // Added
    const backFromWeaponsBtn = document.getElementById('back-from-weapons-btn');
    const backFromBadgesBtn = document.getElementById('back-from-badges-btn');
    const backFromLeaderboardBtn = document.getElementById('back-from-leaderboard-btn');
    const startGameWithWeaponsBtn = document.getElementById('start-game-with-weapons-btn');
    const nextToBallBtn = document.getElementById('next-to-ball-btn'); // Added
    const backToPaddleBtn = document.getElementById('back-to-paddle-btn'); // Added

    // Screen Navigation Helpers
    function hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    function showMenu() {
        hideAllScreens();
        const menuScreen = document.getElementById('menu-screen');
        if (menuScreen) {
            menuScreen.classList.add('active');
        }
    }

    function startGame() { // Renamed from startGameWithWeapons for clarity
        hideAllScreens();
        const gameScreen = document.getElementById('game-screen');
        if (gameScreen) {
            gameScreen.classList.add('active');
            initGame(); // Initialize game after showing screen
        }
    }

    // function showLeaderboard() { // Functionality removed
    //     hideAllScreens();
    //     const leaderboardScreen = document.getElementById('leaderboard-screen');
    //     if (leaderboardScreen) {
    //         leaderboardScreen.classList.add('active');
    //         // Ensure screen is active before fetching/rendering
    //         console.log("[UI] Leaderboard screen activated.");
    //         refreshLeaderboard(); // Fetch fresh leaderboard data AFTER activating screen
    //     } else {
    //         console.error("[UI] Leaderboard screen element not found!");
    //     }
    // }

    function showBadges() {
        hideAllScreens();
        const badgesScreen = document.getElementById('badges-screen');
        if (badgesScreen) {
            badgesScreen.classList.add('active');
        }
    }

    function showPaddleSelection() { // Renamed from showWeapons
        hideAllScreens();
        const paddleScreen = document.getElementById('paddle-selection-screen');
        if (paddleScreen) {
            paddleScreen.classList.add('active');
            populatePaddleSelection();
        }
    }

    function showBallSelection() {
        hideAllScreens();
        const ballScreen = document.getElementById('ball-selection-screen');
        if (ballScreen) {
            ballScreen.classList.add('active');
            populateBallSelection();
        }
    }

    // Attach Event Listeners
    startBtn?.addEventListener('click', showPaddleSelection); // Go to paddle selection first
    leaderboardBtn?.addEventListener('click', () => {
        console.log("[UI] Leaderboard button clicked.");
        showLeaderboard();
    });
    badgesBtn?.addEventListener('click', showBadges);
    weaponsBtn?.addEventListener('click', showPaddleSelection); // Main weapons button also goes to paddle selection
    howToPlayBtn?.addEventListener('click', showHowToPlayModal); // Added listener

    // Back buttons
    backFromWeaponsBtn?.addEventListener('click', showMenu); // Back from paddle selection goes to menu
    backFromBadgesBtn?.addEventListener('click', showMenu);
    backFromLeaderboardBtn?.addEventListener('click', showMenu);

    // Weapon selection flow buttons
    nextToBallBtn?.addEventListener('click', showBallSelection);
    backToPaddleBtn?.addEventListener('click', showPaddleSelection); // Back from ball selection goes to paddle selection

    // Start game button (after selecting ball)
    startGameWithWeaponsBtn?.addEventListener('click', startGame); // This button now starts the game

    // Initialize Leaderboard Tabs
    setupLeaderboardTabs();

    // Show the initial screen
    showMenu();

    console.log("Consolidated DOMContentLoaded initialization complete.");
});

// Update start game function to ensure proper weapon initialization
function startGameWithWeapons() {
    if (!selectedPaddle || !selectedBall) {
        console.error('No weapons selected!');
        return;
    }
    hideAllScreens();
    document.getElementById('game-screen').classList.add('active');
    initGame();
}

// Update leaderboard tabs functionality
function setupLeaderboardTabs() {
    const tabButtons = document.querySelectorAll('.tab-button');
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            // Update active tab
            tabButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            // Show corresponding content
            const tabId = button.getAttribute('data-tab');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('active', content.id === `${tabId}-leaderboard`);
            });

            // Fetch data for this tab
            refreshLeaderboard();
        });
    });
}


function refreshLeaderboard() {
    const now = Date.now();
    // Only prevent concurrent requests, not requests shortly after completion
    if (leaderboardRequestInProgress) {
        console.log("[Leaderboard] Request already in progress. Skipping.");
        return;
    }

    leaderboardRequestInProgress = true;
    lastLeaderboardRequestTime = now;

    // Get active tab
    const activeTab = document.querySelector('.tab-button.active');
    const tab = activeTab ? activeTab.getAttribute('data-tab') : 'this-subreddit';

    console.log(`[Leaderboard] Requesting data for tab: ${tab}`);
    // Don't show loading here; let renderLeaderboard handle UI updates upon receiving data or error

    postWebViewMessage({
        type: 'fetchLeaderboard',
        data: { tab }
    }).catch(error => {
        console.error(`[Leaderboard] Failed to send fetchLeaderboard message for tab ${tab}:`, error);
        // Show error in UI if sending the message fails
        showLeaderboardError(`Could not request leaderboard data. Please check connection.`, tab);
        leaderboardRequestInProgress = false;
    });
}

function renderLeaderboard(data) {
    // This function now handles rendering data, empty state, or implicitly showing loading/error states
    // by clearing the content if data is invalid or not yet available.
    // The actual loading/error messages are handled by showLeaderboardLoading/showLeaderboardError called elsewhere.

    console.log(`[Render] Received data for rendering:`, data);

    // Ensure data structure is valid before proceeding
    if (!data || !data.tab || !Array.isArray(data.entries)) {
        console.error('[Render] Invalid or incomplete leaderboard data received. Cannot render.', data);
        // Don't show an error here directly, assume showLeaderboardError was called if fetch failed.
        // If data structure is wrong from a successful fetch, the console error is the primary feedback.
        return;
    }

    const { tab, entries } = data;
    const tabBodyId = `${tab}-leaderboard-body`;
    const tabBody = document.getElementById(tabBodyId);

    // Critical check: Ensure the target element exists before manipulating
    if (!tabBody) {
        console.error(`[Render] CRITICAL: Could not find leaderboard body element with ID: #${tabBodyId}. Aborting render.`);
        // Optionally, show a general UI error if this happens, as it indicates an HTML/JS mismatch
        // showError("Internal UI Error: Leaderboard display area not found.");
        return;
    }

    console.log(`[Render] Found target element: #${tabBodyId}. Clearing and rendering for tab '${tab}'.`);

    // Clear previous content (loading, error, or old data)
    tabBody.innerHTML = '';

    // Handle empty leaderboard
    if (entries.length === 0) {
        console.log(`[Render] Leaderboard for tab '${tab}' is empty. Displaying empty state.`);
        const emptyRow = document.createElement('tr');
        const emptyCell = document.createElement('td');
        // Adjust colspan: 4 for 'this-subreddit', 5 for 'all-subreddits'
        emptyCell.colSpan = tab === 'all-subreddits' ? 5 : 4;
        emptyCell.className = 'chalk-text chalk-white empty-state';
        emptyCell.textContent = 'No scores yet! Be the first to play!';
        emptyRow.appendChild(emptyCell);
        tabBody.appendChild(emptyRow);
        console.log(`[Render] Appended empty state row to #${tabBodyId}`);
        return; // Finished rendering empty state
    }

    // Process and render entries
    console.log(`[Render] Processing ${entries.length} entries for tab '${tab}'...`);
    let rowsHTML = ''; // Build HTML string for efficiency
    entries.forEach((entry, index) => {
        if (!entry || typeof entry !== 'object') {
            console.warn(`[Render] Skipping invalid entry at index ${index}:`, entry);
            return; // Skip invalid entries
        }

        // Safely access properties with defaults
        const rank = entry.rank || (index + 1);
        const username = entry.username || 'Unknown';
        const score = typeof entry.score === 'number' ? entry.score.toLocaleString() : 'N/A';
        const date = entry.updatedAt ? formatDate(entry.updatedAt) : 'N/A';
        const subreddit = entry.subreddit || 'N/A';

        const isCurrentUserClass = entry.username === currentUsername ? 'current-user' : '';
        let rankDisplay = rank.toString();
        if (rank === 1) rankDisplay = '🥇 ' + rankDisplay;
        else if (rank === 2) rankDisplay = '🥈 ' + rankDisplay;
        else if (rank === 3) rankDisplay = '🥉 ' + rankDisplay;

        // Log processed entry details
        // console.log(`[Render] Entry ${index}: Rank=${rank}, User=${username}, Score=${score}, Date=${date}, Subreddit=${subreddit}`);

        // Build row HTML
        rowsHTML += `<tr class="${isCurrentUserClass}">`;
        rowsHTML += `<td class="chalk-text chalk-yellow">${rankDisplay}</td>`;
        rowsHTML += `<td class="chalk-text chalk-white">${username} ${entry.username === currentUsername ? '<span class="current-user-tag">(You)</span>' : ''}</td>`;
        rowsHTML += `<td class="chalk-text chalk-yellow">${score}</td>`;
        if (tab === 'all-subreddits') {
            rowsHTML += `<td class="chalk-text chalk-white">${subreddit}</td>`;
        }
        rowsHTML += `<td class="chalk-text chalk-white date-col">${date}</td>`;
        rowsHTML += `</tr>`;
    });

    console.log(`[Render] Generated HTML for ${entries.length} valid rows.`);
    tabBody.innerHTML = rowsHTML; // Update DOM with all rows at once
    console.log(`[Render] Successfully updated #${tabBodyId} with new rows.`);
}

// Initialize when document is ready
document.addEventListener('DOMContentLoaded', () => {
    // Initialize game elements
    gameArea = document.getElementById('gameArea');
    ball = document.getElementById('ball');
    instructions = document.getElementById('instructions');

    // Set default weapons if not already set
    if (!selectedPaddle) selectedPaddle = weapons.paddles.default;
    if (!selectedBall) selectedBall = weapons.balls.default;

    // Initialize menu buttons and event listeners
    const startBtn = document.getElementById('start-btn');
    const leaderboardBtn = document.getElementById('leaderboard-btn');
    const badgesBtn = document.getElementById('badges-btn');
    const weaponsBtn = document.getElementById('weapons-btn');
    const howToPlayBtn = document.getElementById('how-to-play-btn');

    function hideAllScreens() {
        document.querySelectorAll('.screen').forEach(screen => {
            screen.classList.remove('active');
        });
    }

    // Initialize weapon selection
    if (startBtn) {
        startBtn.addEventListener('click', () => {
            hideAllScreens();
            document.getElementById('paddle-selection-screen').classList.add('active');
            populatePaddleSelection();
        });
    }

    // Initialize leaderboard functionality
    setupLeaderboardTabs();

    // Show menu screen initially
    hideAllScreens();
    document.getElementById('menu-screen').classList.add('active');
});

// Add these functions after the gameOver function
function checkTopPlayerAchievement(score) {
    if (leaderboard.length === 0) return false;

    // Find player's position in leaderboard
    const position = leaderboard.findIndex(entry => entry.score < score);

    // Check if score is in top 5
    if (position !== -1 && position < 5) {
        const newRank = position + 1;
        scheduleTopPlayerPost({
            username: currentUsername,
            score: score,
            rank: newRank,
            timestamp: new Date().toISOString()
        });
        return true;
    }
    return false;
}

function scheduleTopPlayerPost(playerData) {
    postWebViewMessage({
        type: 'schedulePost',
        data: {
            template: 'top-player.html',
            data: playerData,
            scheduledTime: new Date(Date.now() + 5 * 60000).toISOString(), // Schedule 5 minutes after achievement
            title: `🎯 New Top 5 Achievement by ${playerData.username}!`
        }
    });
}

function scheduleWeeklyLeaderboard() {
    const now = new Date();
    const nextSunday = new Date();
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(0, 0, 0, 0);

    const topPlayer = leaderboard[0] || null;

    postWebViewMessage({
        type: 'schedulePost',
        data: {
            template: 'leaderboard.html',
            data: leaderboard.slice(0, 10), // Top 10 players
            topPlayer: topPlayer, // Include top player details
            scheduledTime: nextSunday.toISOString(),
            title: '🏆 Weekly Don\'t Drop Leaderboard'
        }
    });
}

// Add weekly leaderboard scheduling on init
document.addEventListener('DOMContentLoaded', () => {
    // ...existing initialization code...

    // Schedule weekly leaderboard post
    scheduleWeeklyLeaderboard();

    // ...rest of existing initialization code...
});

/**
 * SOTA Idle RPG - Red/Blue Edition
 * A fully autonomous, infinite progression HTML5 Canvas Game.
 */

// --- ENUMS & CONSTANTS ---
const TILE_SIZE = 40;
const MAP_WIDTH = 15;
const MAP_HEIGHT = 15;
const GAME_STATES = { WANDERING: 0, BATTLING: 1, CAPTURING: 2 };
const TYPES = ['Grass', 'Fire', 'Water'];
const TYPE_COLORS = { 'Grass': '#44ff44', 'Fire': '#ff4444', 'Water': '#4444ff' };

const PAL_NAMES = {
    'Grass': ['LeafSaur', 'VineSnake', 'MossTurtle', 'RootDog'],
    'Fire': ['EmberTail', 'FlameBat', 'AshBird', 'LavaCat'],
    'Water': ['AquaTurtle', 'TideFish', 'ShellCrab', 'WaveSeal']
};

// --- GAME STATE ---
let state = {
    lastSave: Date.now(),
    zone: 1,
    killsInZone: 0,
    gold: 0,
    badges: 0,
    pals: [],
    activePalIndex: 0,
    upgrades: {
        catchRate: 0, // Increases catch chance
        speed: 0,     // Player movement speed
        heal: 0       // Out of combat heal rate
    }
};

let gameEngine = {
    currentState: GAME_STATES.WANDERING,
    map: [],
    player: { x: 7, y: 7, targetX: 7, targetY: 7, moving: false, pixelsToMove: 0, dir: 'down' },
    wildPal: null,
    battleTimer: 0,
    floatingTexts: [],
    logs: []
};

// --- UTILITIES ---
const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const getCost = (base, lvl, mult) => Math.floor(base * Math.pow(mult, lvl));

// --- PAL GENERATOR ---
function generatePal(level, isStarter = false) {
    const type = TYPES[rand(0, 2)];
    const name = PAL_NAMES[type][rand(0, PAL_NAMES[type].length - 1)];
    // Base stats scale with level exponentially for infinite scaling
    const scale = Math.pow(1.15, level - 1); 
    const badgeMult = 1 + (state.badges * 1); // +100% per badge
    
    return {
        id: Date.now() + rand(0, 1000),
        name: isStarter ? "Starter " + name : name,
        type: type,
        level: level,
        exp: 0,
        maxExp: Math.floor(100 * Math.pow(1.1, level)),
        hp: Math.floor(50 * scale * badgeMult),
        maxHp: Math.floor(50 * scale * badgeMult),
        atk: Math.floor(10 * scale * badgeMult),
        def: Math.floor(5 * scale * badgeMult)
    };
}

// --- MAP GENERATION ---
// 0: Path, 1: Grass, 2: Obstacle/Tree
function generateMap() {
    gameEngine.map = [];
    for (let y = 0; y < MAP_HEIGHT; y++) {
        let row = [];
        for (let x = 0; x < MAP_WIDTH; x++) {
            if (x === 0 || y === 0 || x === MAP_WIDTH - 1 || y === MAP_HEIGHT - 1) {
                row.push(2); // Border trees
            } else {
                // 30% grass, 10% obstacle, 60% path
                let r = Math.random();
                if (r < 0.3 && (x !== 7 || y !== 7)) row.push(1);
                else if (r < 0.4 && (x !== 7 || y !== 7)) row.push(2);
                else row.push(0);
            }
        }
        gameEngine.map.push(row);
    }
}

// --- SAVE / LOAD / OFFLINE ---
function saveGame() {
    state.lastSave = Date.now();
    localStorage.setItem('idlePalSave', JSON.stringify(state));
}

function loadGame() {
    const saved = localStorage.getItem('idlePalSave');
    if (saved) {
        let parsed = JSON.parse(saved);
        state = { ...state, ...parsed };
        
        // Handle backwards compatibility of upgrades object
        if(!state.upgrades) state.upgrades = { catchRate:0, speed:0, heal:0 };
        
        calculateOfflineProgress();
    } else {
        // First play
        state.pals.push(generatePal(1, true));
    }
    updateUI();
}

function calculateOfflineProgress() {
    const now = Date.now();
    const diffMs = now - state.lastSave;
    const diffSec = Math.floor(diffMs / 1000);
    
    if (diffSec > 60) { // More than 1 minute offline
        const active = state.pals[state.activePalIndex];
        
        // Rough estimate: A battle takes ~3 seconds of idle time.
        // We only simulate wins based on if player out-levels or out-stats the zone roughly.
        // For simplicity in infinite scaling, assume 1 win every 5 seconds.
        const simulatedBattles = Math.floor(diffSec / 5);
        const goldEarned = simulatedBattles * Math.floor(10 * Math.pow(1.1, state.zone) * (1 + state.badges * 0.5));
        const xpEarned = simulatedBattles * Math.floor(20 * Math.pow(1.15, state.zone));

        state.gold += goldEarned;
        active.exp += xpEarned;
        checkLevelUp(active);

        // Show offline modal
        document.getElementById('offline-time').innerText = formatTime(diffSec);
        document.getElementById('offline-battles').innerText = simulatedBattles;
        document.getElementById('offline-gold').innerText = goldEarned;
        document.getElementById('offline-xp').innerText = xpEarned;
        document.getElementById('offline-modal').classList.remove('hidden');
    }
}

function formatTime(sec) {
    let h = Math.floor(sec / 3600);
    let m = Math.floor((sec % 3600) / 60);
    return `${h}h ${m}m`;
}

function hardReset() {
    if(confirm("Are you sure? This deletes ALL progress!")) {
        localStorage.removeItem('idlePalSave');
        location.reload();
    }
}

function prestige() {
    if (state.zone < 10) return alert("Reach Zone 10 to prestige!");
    const badgesEarned = Math.floor(state.zone / 5);
    state.badges += badgesEarned;
    state.zone = 1;
    state.gold = 0;
    state.killsInZone = 0;
    state.upgrades = { catchRate:0, speed:0, heal:0 };
    state.pals = [generatePal(1, true)];
    state.activePalIndex = 0;
    saveGame();
    generateMap();
    updateUI();
    logAction(`Prestiged! Gained ${badgesEarned} Badges.`);
}

// --- COMBAT & MECHANICS ---
function logAction(msg) {
    const logDiv = document.getElementById('action-log');
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    entry.innerText = msg;
    logDiv.appendChild(entry);
    if (logDiv.children.length > 5) logDiv.firstChild.remove();
}

function addFloatingText(x, y, text, color) {
    gameEngine.floatingTexts.push({ x, y, text, color, life: 1.0 });
}

function checkLevelUp(pal) {
    while (pal.exp >= pal.maxExp) {
        pal.exp -= pal.maxExp;
        pal.level++;
        pal.maxExp = Math.floor(100 * Math.pow(1.1, pal.level));
        
        // Recalculate stats based on level, heal to full
        const scale = Math.pow(1.15, pal.level - 1);
        const badgeMult = 1 + (state.badges * 1);
        
        pal.maxHp = Math.floor(50 * scale * badgeMult);
        pal.hp = pal.maxHp;
        pal.atk = Math.floor(10 * scale * badgeMult);
        pal.def = Math.floor(5 * scale * badgeMult);
        
        logAction(`${pal.name} grew to Lvl ${pal.level}!`);
    }
}

function getDamage(attacker, defender) {
    let typeMult = 1.0;
    if (attacker.type === 'Water' && defender.type === 'Fire') typeMult = 1.5;
    if (attacker.type === 'Fire' && defender.type === 'Grass') typeMult = 1.5;
    if (attacker.type === 'Grass' && defender.type === 'Water') typeMult = 1.5;
    
    if (attacker.type === 'Fire' && defender.type === 'Water') typeMult = 0.5;
    if (attacker.type === 'Grass' && defender.type === 'Fire') typeMult = 0.5;
    if (attacker.type === 'Water' && defender.type === 'Grass') typeMult = 0.5;

    let dmg = Math.floor((attacker.atk * typeMult) - (defender.def * 0.5));
    if (dmg < 1) dmg = 1;
    return { dmg, typeMult };
}

function startBattle() {
    gameEngine.currentState = GAME_STATES.BATTLING;
    // Wild pal level scales with zone
    const wildLevel = state.zone + rand(0, 2);
    gameEngine.wildPal = generatePal(wildLevel);
    gameEngine.battleTimer = 0;
    
    document.getElementById('battle-ui').classList.remove('hidden');
    updateBattleUI();
    logAction(`Wild ${gameEngine.wildPal.name} appeared!`);
}

function endBattle(won) {
    document.getElementById('battle-ui').classList.add('hidden');
    
    if (won) {
        const active = state.pals[state.activePalIndex];
        const xpGain = Math.floor(20 * Math.pow(1.15, gameEngine.wildPal.level));
        const baseGold = 10 * Math.pow(1.1, state.zone);
        const goldGain = Math.floor(baseGold * (1 + state.badges * 0.5)); // Badges give +50% gold each
        
        active.exp += xpGain;
        state.gold += goldGain;
        logAction(`Won! Gained ${goldGain}G & ${xpGain}XP.`);
        checkLevelUp(active);

        // Catch logic
        const baseCatchChance = 0.1 + (state.upgrades.catchRate * 0.05); // max ~ 1.0 depending on upgrades
        if (Math.random() < baseCatchChance) {
            if (state.pals.length < 20) {
                gameEngine.wildPal.hp = gameEngine.wildPal.maxHp; // Heal on catch
                state.pals.push(gameEngine.wildPal);
                logAction(`Caught ${gameEngine.wildPal.name}!`);
            } else {
                logAction(`Pal Box full! Released ${gameEngine.wildPal.name} for 50G.`);
                state.gold += 50;
            }
        }

        // Zone Progression
        state.killsInZone++;
        if (state.killsInZone >= 10) {
            state.zone++;
            state.killsInZone = 0;
            logAction(`Advanced to Zone ${state.zone}!`);
            generateMap(); // Regenerate map to simulate moving to a new route
        }
    } else {
        logAction(`Your Pal fainted! Resting...`);
    }

    gameEngine.wildPal = null;
    gameEngine.currentState = GAME_STATES.WANDERING;
    updateUI();
    saveGame();
}

function battleTick(dt) {
    gameEngine.battleTimer += dt;
    // Attack every 1 second
    if (gameEngine.battleTimer > 1000) {
        gameEngine.battleTimer = 0;
        const active = state.pals[state.activePalIndex];
        const wild = gameEngine.wildPal;

        // Player attacks wild
        let pAtk = getDamage(active, wild);
        wild.hp -= pAtk.dmg;
        addFloatingText(350, 200, `-${pAtk.dmg}`, pAtk.typeMult > 1 ? '#ffcc00' : '#fff');
        
        if (wild.hp <= 0) {
            wild.hp = 0;
            updateBattleUI();
            setTimeout(() => endBattle(true), 500);
            return;
        }

        // Wild attacks player
        let wAtk = getDamage(wild, active);
        active.hp -= wAtk.dmg;
        addFloatingText(150, 400, `-${wAtk.dmg}`, '#ff0000');

        if (active.hp <= 0) {
            active.hp = 0;
            updateBattleUI();
            setTimeout(() => endBattle(false), 500);
            return;
        }

        updateBattleUI();
    }
}

// --- MOVEMENT & ENGINE ---
function movePlayerTick(dt) {
    const p = gameEngine.player;
    
    // Auto-heal while wandering
    const active = state.pals[state.activePalIndex];
    if (active.hp < active.maxHp) {
        const healAmt = (active.maxHp * 0.05) * (1 + state.upgrades.heal * 0.5) * (dt/1000);
        active.hp += healAmt;
        if(active.hp > active.maxHp) active.hp = active.maxHp;
    }

    if (p.moving) {
        const speed = 100 + (state.upgrades.speed * 20); // Pixels per second
        const moveDist = (speed * dt) / 1000;
        p.pixelsToMove -= moveDist;

        if (p.pixelsToMove <= 0) {
            p.moving = false;
            p.x = p.targetX;
            p.y = p.targetY;
            
            // Check grass encounter
            if (gameEngine.map[p.y][p.x] === 1) {
                if (active.hp > 0 && Math.random() < 0.25) { // 25% chance in grass
                    startBattle();
                    return;
                }
            }
        }
    } else {
        // Pick new random direction
        const dirs = [
            { dx: 0, dy: -1, str: 'up' },
            { dx: 0, dy: 1, str: 'down' },
            { dx: -1, dy: 0, str: 'left' },
            { dx: 1, dy: 0, str: 'right' }
        ];
        const validDirs = [];
        dirs.forEach(d => {
            const nx = p.x + d.dx;
            const ny = p.y + d.dy;
            if (nx >= 0 && nx < MAP_WIDTH && ny >= 0 && ny < MAP_HEIGHT) {
                if (gameEngine.map[ny][nx] !== 2) { // 2 = obstacle
                    validDirs.push(d);
                }
            }
        });

        if (validDirs.length > 0) {
            const pick = validDirs[rand(0, validDirs.length - 1)];
            p.targetX = p.x + pick.dx;
            p.targetY = p.y + pick.dy;
            p.dir = pick.str;
            p.moving = true;
            p.pixelsToMove = TILE_SIZE;
        }
    }
}

// --- RENDERER ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function renderMap() {
    // Camera centers on player
    const p = gameEngine.player;
    let px = p.x * TILE_SIZE;
    let py = p.y * TILE_SIZE;
    
    // Interpolate for smooth movement
    if (p.moving) {
        if (p.dir === 'up') py -= (TILE_SIZE - p.pixelsToMove);
        if (p.dir === 'down') py += (TILE_SIZE - p.pixelsToMove);
        if (p.dir === 'left') px -= (TILE_SIZE - p.pixelsToMove);
        if (p.dir === 'right') px += (TILE_SIZE - p.pixelsToMove);
    }

    const camX = px - (canvas.width / 2) + (TILE_SIZE / 2);
    const camY = py - (canvas.height / 2) + (TILE_SIZE / 2);

    // Draw Map
    ctx.fillStyle = '#8bac0f'; // Default BG
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    for (let y = 0; y < MAP_HEIGHT; y++) {
        for (let x = 0; x < MAP_WIDTH; x++) {
            const tile = gameEngine.map[y][x];
            const drawX = (x * TILE_SIZE) - camX;
            const drawY = (y * TILE_SIZE) - camY;

            if (drawX < -TILE_SIZE || drawX > canvas.width || drawY < -TILE_SIZE || drawY > canvas.height) continue;

            if (tile === 0) {
                // Path
                ctx.fillStyle = '#e8d2a5';
                ctx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
            } else if (tile === 1) {
                // Grass
                ctx.fillStyle = '#306230';
                ctx.fillRect(drawX, drawY, TILE_SIZE, TILE_SIZE);
                // Grass blades decoration
                ctx.fillStyle = '#0f380f';
                ctx.fillRect(drawX + 10, drawY + 10, 4, 10);
                ctx.fillRect(drawX + 25, drawY + 20, 4, 10);
            } else if (tile === 2) {
                // Tree
                ctx.fillStyle = '#0f380f';
                ctx.beginPath();
                ctx.arc(drawX + TILE_SIZE/2, drawY + TILE_SIZE/2, TILE_SIZE/2 - 2, 0, Math.PI*2);
                ctx.fill();
            }
        }
    }

    // Draw Player
    const playerScreenX = (px) - camX;
    const playerScreenY = (py) - camY;
    
    // Player Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(playerScreenX + TILE_SIZE/2, playerScreenY + TILE_SIZE - 5, 12, 6, 0, 0, Math.PI*2);
    ctx.fill();

    // Player Sprite (Placeholder red cap boy)
    ctx.fillStyle = '#ff0000'; // Hat
    ctx.fillRect(playerScreenX + 10, playerScreenY + 5, 20, 10);
    ctx.fillStyle = '#ffccaa'; // Face
    ctx.fillRect(playerScreenX + 10, playerScreenY + 15, 20, 10);
    ctx.fillStyle = '#4444ff'; // Body
    ctx.fillRect(playerScreenX + 8, playerScreenY + 25, 24, 15);
}

function renderBattle() {
    // Battle Background
    ctx.fillStyle = '#8bac0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Platforms
    ctx.fillStyle = '#306230';
    ctx.beginPath(); ctx.ellipse(450, 200, 100, 30, 0, 0, Math.PI*2); ctx.fill(); // Enemy Platform
    ctx.beginPath(); ctx.ellipse(150, 400, 120, 40, 0, 0, Math.PI*2); ctx.fill(); // Player Platform

    const active = state.pals[state.activePalIndex];
    const wild = gameEngine.wildPal;

    // Draw Wild Pal (Top Right) - Color based on type
    ctx.fillStyle = TYPE_COLORS[wild.type];
    ctx.fillRect(400, 100, 100, 100);
    ctx.fillStyle = '#000'; // Eyes
    ctx.fillRect(420, 120, 10, 10);
    ctx.fillRect(470, 120, 10, 10);

    // Draw Player Pal (Bottom Left)
    ctx.fillStyle = TYPE_COLORS[active.type];
    ctx.fillRect(100, 280, 100, 100);
    ctx.fillStyle = '#000'; // Eyes (facing right)
    ctx.fillRect(160, 300, 10, 10);
    ctx.fillRect(180, 300, 10, 10);
}

function renderFloatingTexts(dt) {
    ctx.font = "16px 'Press Start 2P', monospace";
    ctx.textAlign = "center";
    for (let i = gameEngine.floatingTexts.length - 1; i >= 0; i--) {
        let ft = gameEngine.floatingTexts[i];
        ft.life -= dt / 1000;
        ft.y -= (20 * dt) / 1000; // Float up
        
        ctx.fillStyle = ft.color;
        ctx.globalAlpha = Math.max(0, ft.life);
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.globalAlpha = 1.0;

        if (ft.life <= 0) gameEngine.floatingTexts.splice(i, 1);
    }
}

// --- GAME LOOP ---
let lastTime = 0;
function loop(time) {
    const dt = time - lastTime;
    lastTime = time;

    // Update Logic
    if (gameEngine.currentState === GAME_STATES.WANDERING) {
        movePlayerTick(dt);
        renderMap();
    } else if (gameEngine.currentState === GAME_STATES.BATTLING) {
        battleTick(dt);
        renderBattle();
    }

    renderFloatingTexts(dt);
    
    requestAnimationFrame(loop);
}

// --- UI UPDATES & EVENT LISTENERS ---
function updateUI() {
    document.getElementById('current-zone').innerText = state.zone;
    document.getElementById('gold-amount').innerText = state.gold;
    document.getElementById('badge-amount').innerText = state.badges;
    
    // Prestige tab
    const potentialBadges = state.zone >= 10 ? Math.floor(state.zone / 5) : 0;
    document.getElementById('pending-badges').innerText = potentialBadges;

    // Upgrades
    const upg = state.upgrades;
    document.getElementById('upg-catch-lvl').innerText = upg.catchRate;
    document.getElementById('upg-catch-cost').innerText = getCost(10, upg.catchRate, 1.5);
    
    document.getElementById('upg-speed-lvl').innerText = upg.speed;
    document.getElementById('upg-speed-cost').innerText = getCost(50, upg.speed, 2.0);
    
    document.getElementById('upg-heal-lvl').innerText = upg.heal;
    document.getElementById('upg-heal-cost').innerText = getCost(100, upg.heal, 1.8);

    renderPals();
}

function updateBattleUI() {
    if (gameEngine.currentState !== GAME_STATES.BATTLING || !gameEngine.wildPal) return;
    const active = state.pals[state.activePalIndex];
    const wild = gameEngine.wildPal;

    document.getElementById('player-name').innerText = `${active.name} Lv.${active.level}`;
    document.getElementById('enemy-name').innerText = `Wild ${wild.name} Lv.${wild.level}`;

    const pPct = Math.max(0, (active.hp / active.maxHp) * 100);
    const ePct = Math.max(0, (wild.hp / wild.maxHp) * 100);

    const pBar = document.getElementById('player-hp-bar');
    const eBar = document.getElementById('enemy-hp-bar');
    
    pBar.style.width = `${pPct}%`;
    eBar.style.width = `${ePct}%`;

    // Change colors based on health
    pBar.style.backgroundColor = pPct > 50 ? '#00ff00' : pPct > 20 ? '#ffff00' : '#ff0000';
    eBar.style.backgroundColor = ePct > 50 ? '#00ff00' : ePct > 20 ? '#ffff00' : '#ff0000';
}

function renderPals() {
    const activeContainer = document.getElementById('active-pal-card');
    const invContainer = document.getElementById('pal-inventory');
    
    activeContainer.innerHTML = '';
    invContainer.innerHTML = '';
    document.getElementById('pal-count').innerText = state.pals.length;

    state.pals.forEach((pal, index) => {
        let hpPct = Math.floor((pal.hp / pal.maxHp) * 100);
        let xpPct = Math.floor((pal.exp / pal.maxExp) * 100);
        const cardHtml = `
            <div class="pal-header">
                <strong>${pal.name} <span style="color:#aaa;">Lv.${pal.level}</span></strong>
                <span class="pal-type type-${pal.type.toLowerCase()}">${pal.type}</span>
            </div>
            <div class="pal-stats">
                HP: ${Math.floor(pal.hp)}/${pal.maxHp} (${hpPct}%) | EXP: ${xpPct}% <br>
                ATK: ${pal.atk} | DEF: ${pal.def}
            </div>
        `;
        
        let card = document.createElement('div');
        card.className = `pal-card ${index === state.activePalIndex ? 'active-pal' : ''}`;
        card.innerHTML = cardHtml;
        
        if (index === state.activePalIndex) {
            activeContainer.appendChild(card);
        } else {
            card.onclick = () => {
                state.activePalIndex = index;
                updateUI();
                saveGame();
            };
            invContainer.appendChild(card);
        }
    });
}

// Upgrade Buttons
function buyUpgrade(type, baseCost, mult) {
    const cost = getCost(baseCost, state.upgrades[type], mult);
    if (state.gold >= cost) {
        state.gold -= cost;
        state.upgrades[type]++;
        updateUI();
        saveGame();
    }
}
document.getElementById('btn-upg-catch').onclick = () => buyUpgrade('catchRate', 10, 1.5);
document.getElementById('btn-upg-speed').onclick = () => buyUpgrade('speed', 50, 2.0);
document.getElementById('btn-upg-heal').onclick = () => buyUpgrade('heal', 100, 1.8);
document.getElementById('btn-prestige').onclick = prestige;
document.getElementById('btn-hard-reset').onclick = hardReset;
document.getElementById('btn-claim-offline').onclick = () => {
    document.getElementById('offline-modal').classList.add('hidden');
};

// Tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    };
});

// Periodic Saving and UI updates
setInterval(() => {
    saveGame();
    updateUI(); // Keep UI fresh for HP regen etc
}, 1000);

// --- INIT ---
function init() {
    generateMap();
    loadGame();
    requestAnimationFrame((t) => { lastTime = t; loop(t); });
}

window.onload = init;

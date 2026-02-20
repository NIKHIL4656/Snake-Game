// DOM
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const scoreDisplay = document.getElementById("score");
const finalScoreDisplay = document.getElementById("finalScore");
const bestDisplay = document.getElementById("bestDisplay");
const difficultyDisplay = document.getElementById("difficultyDisplay");
const pauseBtn = document.getElementById("pauseBtn");
const menuBtn = document.getElementById("menuBtn");
const themeBtn = document.getElementById("themeBtn");
const skinSelectStart = document.getElementById("skinSelectStart");
const skinSelectPause = document.getElementById("skinSelectPause");

// Simple synth SFX
let audioCtx = null;
function ensureAudio() { if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
function playTone(freq = 600, duration = 120, type = "sine", gain = 0.08) {
  ensureAudio();
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq;
  amp.gain.setValueAtTime(0, t0);
  amp.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration / 1000);
  osc.connect(amp).connect(audioCtx.destination);
  osc.start(t0); osc.stop(t0 + Math.max(0.05, duration / 1000));
}
const sound = {
  eat: () => playTone(880, 110, "triangle"),
  pause: () => playTone(520, 80, "sine"),
  resume: () => playTone(720, 80, "sine"),
  over: () => playTone(240, 280, "sawtooth", 0.12)
};

// Storage helpers
const STORAGE_KEY = "snakeScores";
const SKIN_KEY = "snakeSkin";
function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }
function getScores() {
  const raw = safeParse(localStorage.getItem(STORAGE_KEY)) || [];
  const arr = Array.isArray(raw) ? raw : [];
  return arr.map(v => typeof v === "number" ? { score: v, difficulty: "-", date: null } :
    (v && typeof v.score === "number" ? { score: v.score, difficulty: v.difficulty || "-", date: v.date || null } : null))
    .filter(Boolean).sort((a, b) => b.score - a.score);
}
function saveScore(s, diff) {
  const scores = getScores();
  scores.push({ score: Number(s) || 0, difficulty: diff || "-", date: new Date().toISOString() });
  scores.sort((a, b) => b.score - a.score);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, 10))); } catch {}
  updateBestBadge();
}
function loadScores() {
  const scores = getScores();
  const ul = document.getElementById("scoreList");
  ul.innerHTML = scores.length
    ? scores.slice(0, 5).map(s => `<li>${s.score} <span class="difficulty-badge">${(s.difficulty || "-").toUpperCase()}</span></li>`).join("")
    : "<li>No scores yet - be the first!</li>";
}
function updateBestBadge() {
  const best = getScores()[0]?.score ?? 0;
  bestDisplay.textContent = "Best: " + best;
}
function saveSkin(name) {
  try { localStorage.setItem(SKIN_KEY, name); } catch {}
}
function loadSkin() {
  const v = localStorage.getItem(SKIN_KEY);
  return v || "classic";
}

// Skins
let currentSkin = loadSkin();
let hueBase = 0;
let patternCache = {};
function setSkin(name) {
  currentSkin = name;
  saveSkin(name);
  if (skinSelectStart) skinSelectStart.value = name;
  if (skinSelectPause) skinSelectPause.value = name;
  patternCache = {};
}
function getZebraPattern() {
  if (patternCache.zebra) return patternCache.zebra;
  const tile = document.createElement("canvas");
  tile.width = 20; tile.height = 20;
  const tctx = tile.getContext("2d");
  tctx.fillStyle = "rgba(255,255,255,0.15)";
  tctx.fillRect(0, 0, 20, 20);
  tctx.strokeStyle = "rgba(255,255,255,0.5)";
  tctx.lineWidth = 6;
  tctx.beginPath();
  tctx.moveTo(-5, 5); tctx.lineTo(25, -5);
  tctx.moveTo(-5, 25); tctx.lineTo(25, 15);
  tctx.stroke();
  patternCache.zebra = ctx.createPattern(tile, "repeat");
  return patternCache.zebra;
}
function getCanvasGradient(colors) {
  if (patternCache.gradient && patternCache.gradientKey === colors.join("|")) return patternCache.gradient;
  const g = ctx.createLinearGradient(0, 0, canvas.width, 0);
  const step = 1 / (colors.length - 1);
  colors.forEach((c, i) => g.addColorStop(i * step, c));
  patternCache.gradient = g;
  patternCache.gradientKey = colors.join("|");
  return g;
}

// Game state
const TILE = 20;
let cols, rows;
let snake = [];
let dir = { x: 0, y: 0 };
let nextDir = { x: 0, y: 0 };
let food = { x: 0, y: 0 };
let score = 0;
let running = false;
let paused = false;
let speed = 120;
let lastTs = 0;
let rafId = null;
let difficulty = "";

function fitCanvas() {
  const maxW = window.innerWidth - 40;
  const maxH = window.innerHeight * 0.6;
  cols = Math.max(10, Math.floor(maxW / TILE));
  rows = Math.max(10, Math.floor(maxH / TILE));
  canvas.width = cols * TILE;
  canvas.height = rows * TILE;
  patternCache = {};
}

function hideAllScreens() { document.querySelectorAll(".overlay").forEach(el => el.style.display = "none"); }
function showScreen(name) {
  hideAllScreens();
  const map = { menu: "startMenu", pause: "pauseMenu", gameOver: "gameOverScreen", scores: "scoresScreen", info: "infoScreen" };
  const id = map[name];
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.style.display = "flex";
  if (name === "scores") loadScores();
  if (name === "menu" || name === "pause") {
    skinSelectStart.value = currentSkin;
    skinSelectPause.value = currentSkin;
  }
}

function startGame(level) {
  difficulty = level;
  speed = level === "easy" ? 150 : level === "medium" ? 100 : 70;
  difficultyDisplay.textContent = "Mode: " + level.toUpperCase();
  fitCanvas();
  snake = [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }];
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  score = 0;
  scoreDisplay.textContent = "0";
  running = true;
  paused = false;
  pauseBtn.textContent = "⏸️";
  spawnFood();
  hideAllScreens();
  lastTs = performance.now();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(loop);
  updateBestBadge();
}
function restartGame() {
  if (!difficulty) difficulty = "medium";
  startGame(difficulty);
}
function toMainMenu() {
  running = false;
  hideAllScreens();
  showScreen("menu");
}

function togglePause() {
  if (!running) { showScreen("menu"); return; }
  if (!paused) openPause();
  else resumeGame();
}
function openPause() {
  paused = true;
  pauseBtn.textContent = "▶️";
  document.getElementById("pausedDifficulty").textContent = (difficulty || "-").toUpperCase();
  showScreen("pause");
  sound.pause();
}
function resumeGame() {
  hideAllScreens();
  paused = false;
  pauseBtn.textContent = "⏸️";
  lastTs = performance.now();
  sound.resume();
}

function spawnFood() {
  do {
    food = { x: Math.floor(Math.random() * cols), y: Math.floor(Math.random() * rows) };
  } while (snake.some(s => s.x === food.x && s.y === food.y));
}

function loop(ts) {
  if (!running) return;
  rafId = requestAnimationFrame(loop);
  if (paused) return;
  if (ts - lastTs < speed) return;
  lastTs = ts;
  update();
  render();
}

function update() {
  dir = { ...nextDir };
  const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
  const hitWall = head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows;
  const hitSelf = snake.some(seg => seg.x === head.x && seg.y === head.y);
  if (hitWall || hitSelf) {
    running = false;
    sound.over();
    finalScoreDisplay.textContent = String(score);
    saveScore(score, difficulty);
    showScreen("gameOver");
    return;
  }
  snake.unshift(head);
  if (head.x === food.x && head.y === food.y) {
    score++;
    scoreDisplay.textContent = String(score);
    sound.eat();
    spawnFood();
  } else {
    snake.pop();
  }
  if (currentSkin === "rainbow") hueBase = (hueBase + 6) % 360;
}

function render() {
  const style = getComputedStyle(document.body);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = style.getPropertyValue("--canvas-bg");
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = style.getPropertyValue("--food");
  ctx.fillRect(food.x * TILE, food.y * TILE, TILE - 2, TILE - 2);

  let gradient = null;
  if (currentSkin === "lava") gradient = getCanvasGradient(["#ff8c00", "#ff0033"]);
  if (currentSkin === "ice") gradient = getCanvasGradient(["#a8e6ff", "#e0f7ff"]);
  const zebraPattern = currentSkin === "zebra" ? getZebraPattern() : null;

  ctx.save();
  if (currentSkin === "glass") {
    ctx.globalAlpha = 0.75;
    ctx.shadowColor = "rgba(255,255,255,0.5)";
    ctx.shadowBlur = 8;
  }
  snake.forEach((seg, i) => {
    let fill;
    switch (currentSkin) {
      case "classic":
        fill = i === 0 ? style.getPropertyValue("--snake-head") : style.getPropertyValue("--snake-body");
        break;
      case "neon":
        fill = i === 0 ? "#00fff2" : "#00ff88";
        break;
      case "lava":
      case "ice":
        fill = gradient;
        break;
      case "zebra":
        fill = zebraPattern;
        break;
      case "rainbow":
        fill = `hsl(${(hueBase + i * 20) % 360} 90% 55%)`;
        break;
      case "glass":
        fill = i === 0 ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)";
        break;
      default:
        fill = style.getPropertyValue("--snake-body");
    }
    ctx.fillStyle = fill;
    ctx.fillRect(seg.x * TILE, seg.y * TILE, TILE - 2, TILE - 2);
  });
  ctx.restore();
}

window.addEventListener("keydown", (e) => {
  if (e.key === " " || e.key === "Escape") { e.preventDefault(); togglePause(); return; }
  if (e.key === "Shift") { e.preventDefault(); toggleTheme(); return; }
  if (!running || paused) return;
  if (e.key === "ArrowUp" && dir.y === 0) nextDir = { x: 0, y: -1 };
  if (e.key === "ArrowDown" && dir.y === 0) nextDir = { x: 0, y: 1 };
  if (e.key === "ArrowLeft" && dir.x === 0) nextDir = { x: -1, y: 0 };
  if (e.key === "ArrowRight" && dir.x === 0) nextDir = { x: 1, y: 0 };
});
pauseBtn.addEventListener("click", togglePause);
menuBtn.addEventListener("click", togglePause);
themeBtn.addEventListener("click", toggleTheme);

skinSelectStart.addEventListener("change", (e) => { setSkin(e.target.value); });
skinSelectPause.addEventListener("change", (e) => { setSkin(e.target.value); });

function toggleTheme() {
  const body = document.body;
  body.setAttribute("data-theme", body.getAttribute("data-theme") === "light" ? "dark" : "light");
}

window.addEventListener("resize", () => {
  const wasRunning = running;
  const wasPaused = paused;
  fitCanvas();
  if (wasRunning && !wasPaused) lastTs = performance.now();
});

window.addEventListener("load", () => {
  fitCanvas();
  updateBestBadge();
  setSkin(currentSkin);
  showScreen("menu");
});

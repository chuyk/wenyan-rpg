import * as THREE from "three";
import { LEVELS, RESULT_RANKS, SAVE_KEY } from "./data.js";
import { buildWorld } from "./world.js";
import { createPlayer } from "./player.js";
import { openQuiz, forceCloseQuiz } from "./quiz.js";
import { initQuality, pixelRatioFor, getQuality, toggleQuality } from "./quality.js";
import * as audioModule from "./audio.js";
import {
  play as playTrack,
  setDuck as duckAudio,
  setVolume as setAudioVolume,
  setMuted as setAudioMuted,
  toggleMuted as toggleAudioMuted,
  loadPrefs as loadAudioPrefs,
  onAudioState as onAudio,
  playThudSound,
  playSplashSound,
  playCurrentBoostSound,
  playScoreChimeSound,
} from "./audio.js";
import {
  showHUD,
  hideHUD,
  setChapter,
  setScore,
  setHearts,
  setObjective,
  setPause,
  openStory,
  drawMinimap,
  showResult,
  hideResult,
} from "./hud.js";

const canvas = document.getElementById("scene");
const damageVignette = document.getElementById("damage-vignette");
const titleScreen = document.getElementById("title-screen");
const savedSummary = document.getElementById("saved-summary");
const savedChapterText = document.getElementById("saved-chapter-text");
const savedStatsText = document.getElementById("saved-stats-text");
const btnContinue = document.getElementById("btn-continue");
const btnStart = document.getElementById("btn-start");
const btnReset = document.getElementById("btn-reset");
const btnReplay = document.getElementById("btn-replay");
const btnCredits = document.getElementById("btn-credits");
const btnCreditsClose = document.getElementById("btn-credits-close");
const creditsLayer = document.getElementById("credits-layer");
const btnMute = document.getElementById("btn-mute");
const volumeSlider = document.getElementById("volume");
const trackName = document.getElementById("track-name");
const btnMute2 = document.getElementById("btn-mute-2");
const volumeSlider2 = document.getElementById("volume-2");
const trackName2 = document.getElementById("track-name-2");
const btnQuality = document.getElementById("btn-quality");
const qualityNote = document.getElementById("quality-note");
const btnPauseTouch = document.getElementById("btn-pause-touch");
const touchControls = document.getElementById("touch-controls");
const joystickZone = document.getElementById("touch-joystick-zone");
const joystickBase = document.getElementById("touch-joystick-base");
const joystickThumb = document.getElementById("touch-joystick-thumb");
const touchLookZone = document.getElementById("touch-look-zone");
const btnTouchBoost = document.getElementById("btn-touch-boost");
const mobileWarning = document.getElementById("mobile-warning");
const btnWarningContinue = document.getElementById("btn-warning-continue");
const btnWarningBack = document.getElementById("btn-warning-back");
const btnResume = document.getElementById("btn-resume");
const btnRestartLevel = document.getElementById("btn-restart-level");
const btnQuitTitle = document.getElementById("btn-quit-title");
const pauseSaveStatus = document.getElementById("pause-save-status");

const npcToast = document.getElementById("npc-toast");
const toastAvatar = document.getElementById("toast-avatar");
const toastName = document.getElementById("toast-name");
const toastText = document.getElementById("toast-text");
let toastTimeout = null;

function showNpcToast(name, avatar, text) {
  if (!npcToast) return;
  toastName.textContent = name;
  toastAvatar.textContent = avatar;
  toastText.textContent = text;
  npcToast.classList.remove("hidden");
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    npcToast.classList.add("hidden");
  }, 5200);
}

function handleFlaskReward(info) {
  if (info.type === "boost") {
    input.tempBoostTimer = 4.0;
  } else if (info.type === "heal") {
    lives = Math.min(MAX_LIVES, lives + 1);
    setHearts(lives, MAX_LIVES);
  } else if (info.type === "bonus") {
    score += 30;
    setScore(score);
  }
  showNpcToast("江中漂流竹筒", info.avatar, info.title);
}

const isTouchDevice =
  "ontouchstart" in window ||
  navigator.maxTouchPoints > 0 ||
  window.matchMedia("(pointer: coarse)").matches;

const MAX_LIVES = 6;
const STELE_SCORE = 100;
const LEVEL_CLEAR_SCORE = 100;
const PERFECT_BONUS = 50;
const WRONG_PENALTY = 25;
const TIME_BONUS_MAX = 400;

const quality = initQuality();

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: quality.id === "high",
  powerPreference: "high-performance",
});
renderer.setPixelRatio(pixelRatioFor(renderer));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = quality.shadows;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(72, window.innerWidth / window.innerHeight, 0.1, 2000);
const clock = new THREE.Clock();

const input = {
  pressed: new Set(),
  touchMove: { x: 0, y: 0 },
  touchBoost: false,
  tempBoostTimer: 0,
  inWater: false,
  sprinting: false,
  onLockChange() {},
  report(inWater, sprinting) {
    this.inWater = inWater;
    this.sprinting = sprinting;
  },
};

let world = null;
let player = null;
let state = "title";

let levelIndex = 0;
let score = 0;
let lives = MAX_LIVES;
let wrongTotal = 0;
let firstTryCorrect = 0;
let questionTotal = 0;
let levelStats = [];
let levelChars = [];
let levelMistakes = 0;
let levelStartTime = 0;
let runStartTime = 0;
let quizActive = false;

let rockHitCooldown = 0;
let rockConsecutiveHits = 0;
let smoothSailingTimer = 0;

function saveProgress() {
  try {
    const data = {
      version: 2,
      levelIndex,
      score,
      lives,
      wrongTotal,
      firstTryCorrect,
      questionTotal,
      levelStats,
      savedAt: Date.now(),
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    if (pauseSaveStatus && LEVELS[levelIndex]) {
      pauseSaveStatus.textContent = `💾 進度已儲存：第 ${levelIndex + 1} 關「${LEVELS[levelIndex].name}」（得分 ${score}）`;
    }
  } catch (e) {
    void e;
  }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    void e;
    return null;
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {
    void e;
  }
}

function refreshTitleMenu() {
  const saved = loadProgress();
  if (saved && typeof saved.levelIndex === "number" && LEVELS[saved.levelIndex]) {
    const curLevel = LEVELS[saved.levelIndex];
    if (savedSummary) savedSummary.classList.remove("hidden");
    if (savedChapterText) savedChapterText.textContent = `第 ${saved.levelIndex + 1} 關・${curLevel.name}`;
    if (savedStatsText) savedStatsText.textContent = `得分 ${saved.score || 0} ｜ 生命 ${saved.lives || MAX_LIVES} ❤️`;
    if (btnContinue) {
      btnContinue.classList.remove("hidden");
      btnContinue.textContent = `繼續航程（第 ${saved.levelIndex + 1} 關・${curLevel.name}）`;
    }
    btnStart.textContent = "開始全新旅程（從第一關）";
    if (btnReset) {
      btnReset.classList.remove("hidden");
      btnReset.textContent = "清除存檔";
    }
  } else {
    if (savedSummary) savedSummary.classList.add("hidden");
    if (btnContinue) btnContinue.classList.add("hidden");
    btnStart.textContent = "開始遊戲";
    if (btnReset) {
      btnReset.classList.add("hidden");
    }
  }
}

function continueGame() {
  const saved = loadProgress();
  if (!saved || typeof saved.levelIndex !== "number") {
    startNewGame();
    return;
  }
  titleScreen.classList.add("hidden");
  levelIndex = saved.levelIndex;
  score = typeof saved.score === "number" ? saved.score : 0;
  lives = typeof saved.lives === "number" ? saved.lives : MAX_LIVES;
  wrongTotal = typeof saved.wrongTotal === "number" ? saved.wrongTotal : 0;
  firstTryCorrect = typeof saved.firstTryCorrect === "number" ? saved.firstTryCorrect : 0;
  questionTotal = typeof saved.questionTotal === "number" ? saved.questionTotal : 0;
  levelStats = Array.isArray(saved.levelStats) ? saved.levelStats : [];
  runStartTime = clock.getElapsedTime();
  smoothSailingTimer = 0;
  rockConsecutiveHits = 0;
  rockHitCooldown = 0;
  setupLevel(saved.levelIndex, { withMusic: true });
}

function setState(next) {
  state = next;
  duckAudio(next !== "playing");
  if (player) player.setEnabled(next === "playing");
  if (next !== "playing" && player && player.locked) player.exitLock();
  if (touchControls) {
    touchControls.classList.toggle("hidden", next !== "playing" || !isTouchDevice);
  }
}

function resetRun() {
  score = 0;
  lives = MAX_LIVES;
  wrongTotal = 0;
  firstTryCorrect = 0;
  questionTotal = 0;
  levelStats = [];
  runStartTime = clock.getElapsedTime();
}

function setupLevel(index, { autoStart = false, withMusic = true } = {}) {
  if (world) {
    world.dispose();
    world = null;
  }

  levelIndex = index;
  levelChars = [];
  levelMistakes = 0;

  const level = LEVELS[index];
  world = buildWorld(scene, level);
  world.mistakes = 0;
  world.exit.userData.locked = true;

  player = createPlayer(camera, canvas, world, input);
  levelStartTime = clock.getElapsedTime();

  if (withMusic) playTrack(String(level.id));
  setChapter(level);
  setScore(score);
  setHearts(lives, MAX_LIVES);
  setObjective(`從流飄蕩，順流尋訪 ${level.steles.length} 面江中字碑`);
  setPause(false);
  quizActive = false;
  showHUD();
  saveProgress();

  if (autoStart) {
    setState("playing");
    return;
  }

  setState("story");
  openStory(level, () => {
    setState("playing");
    if (!isTouchDevice) player.requestLock();
  });
}

function onSteleSolved(stele) {
  stele.userData.solved = true;
  levelChars.push(stele.userData.char);
  score += STELE_SCORE;
  setScore(score);

  const remaining = world.steles.filter((s) => !s.userData.solved).length;
  if (remaining === 0) {
    world.exit.userData.locked = false;
    setObjective("字碑全破——前方水月江門已開，順流穿門前進");
    const level = LEVELS[levelIndex];
    const elapsed = Math.max(0, Math.round(clock.getElapsedTime() - levelStartTime));
    const bonus = levelMistakes === 0 ? PERFECT_BONUS : 0;
    score += LEVEL_CLEAR_SCORE + bonus;
    setScore(score);
    levelStats[levelIndex] = {
      title: level.name,
      text: `${levelChars.join("・")}　${elapsed} 秒${bonus ? "　全對" : ""}`,
    };
  } else {
    setObjective(`江中字碑還剩 ${remaining} 面`);
  }
  saveProgress();
}

function onWrongAnswer() {
  if (quizActive === false) return;
  lives -= 1;
  wrongTotal += 1;
  levelMistakes += 1;
  score = Math.max(0, score - WRONG_PENALTY);
  setHearts(lives, MAX_LIVES);
  setScore(score);
  saveProgress();

  if (lives <= 0) {
    forceCloseQuiz();
    quizActive = false;
    endRun(false);
  }
}

function triggerQuiz(stele) {
  const index = stele.userData.index;
  questionTotal += 1;
  let firstTry = true;
  quizActive = true;

  setState("quiz");
  setObjective(`字碑「${stele.userData.char}」`);

  openQuiz(LEVELS[levelIndex].steles[index], {
    onWrong() {
      if (!firstTry) return false;
      firstTry = false;
      onWrongAnswer();
      return true;
    },
    onSolved() {
      if (state === "gameover" || state === "result") return;
      if (firstTry) firstTryCorrect += 1;
      quizActive = false;
      setState("playing");
      if (!isTouchDevice) player.requestLock();
      onSteleSolved(stele);
    },
  });
}

function accuracy() {
  if (questionTotal === 0) return 0;
  return Math.round((firstTryCorrect / questionTotal) * 100);
}

function endRun(completed) {
  hideHUD();
  quizActive = false;
  setState(completed ? "result" : "gameover");

  const acc = accuracy();
  const rank = completed ? RESULT_RANKS.find((r) => acc >= r.min) || null : null;
  const breakdown = LEVELS.map((level, i) => levelStats[i] || { title: level.name, text: "未完成" });
  const elapsedAll = Math.round(clock.getElapsedTime() - runStartTime);
  const timeBonus = completed ? Math.max(0, TIME_BONUS_MAX - elapsedAll * 2) : 0;

  showResult({
    score: score + timeBonus,
    accuracy: acc,
    wrongTotal,
    rank,
    breakdown,
  });

  if (completed) clearProgress();
}

function tryTriggerExit() {
  if (world.exit.userData.locked) return;
  const d = world.exit.userData.position.distanceTo(camera.position);
  if (d > world.exit.userData.triggerRadius) return;

  if (levelIndex + 1 < LEVELS.length) {
    setupLevel(levelIndex + 1);
  } else {
    endRun(true);
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  if (world) {
    world.update(dt, time, camera.position);

    if (player) {
      player.update(dt);

      if (state === "playing" && !quizActive) {
        if (rockHitCooldown > 0) {
          rockHitCooldown -= dt;
        }

        // Smooth sailing streak check
        smoothSailingTimer += dt;
        if (smoothSailingTimer >= 22.0) {
          smoothSailingTimer = 0;
          score += 20;
          setScore(score);
          playScoreChimeSound();
          showNpcToast("富春江順流", "⛵", "「從流飄蕩，平穩如鏡」行舟流暢，獲得 +20 雅興分！");
          saveProgress();
        }

        // 1. 江中暗礁險灘碰撞機制（泉水激石，泠泠作響）
        if (world.rocks) {
          const boatPos = player.position;
          for (const rock of world.rocks) {
            const dist = boatPos.distanceTo(rock.position);
            const hitDist = rock.radius + 1.25;
            if (dist < hitDist) {
              // 物理彈退，避免卡在礁石內部
              const nx = (boatPos.x - rock.position.x) / (dist || 1);
              const nz = (boatPos.z - rock.position.z) / (dist || 1);
              player.pushVelocity(nx * 9.0, nz * 9.0);

              if (rockHitCooldown <= 0) {
                rockHitCooldown = 1.6;
                smoothSailingTimer = 0;
                rockConsecutiveHits++;

                // 音效與震顫回饋
                playThudSound();
                playSplashSound();
                player.applyShake(0.35, 0.45);

                // 畫面受損紅暈暗角
                if (damageVignette) {
                  damageVignette.classList.add("active");
                  setTimeout(() => damageVignette.classList.remove("active"), 80);
                }

                // 觸礁扣分懲罰
                score = Math.max(0, score - 15);
                setScore(score);

                // 每觸礁 3 次損耗 1 點生命
                if (rockConsecutiveHits % 3 === 0) {
                  lives = Math.max(1, lives - 1);
                  setHearts(lives, MAX_LIVES);
                  showNpcToast("富春江險灘", "💥", "觸礁劇烈！「泉水激石」船體受損，分數 -15，損耗 1 點生命！");
                } else {
                  showNpcToast("富春江暗礁", "⚠️", "觸礁震盪！「泉水激石」船身微損，分數 -15！請小心操舵繞行！");
                }
                saveProgress();
              }
              break;
            }
          }
        }

        // 2. 急流衝浪帶加速機制（急湍甚箭，猛浪若奔）
        if (world.rapids) {
          const boatPos = player.position;
          for (const rap of world.rapids) {
            if (
              boatPos.z >= rap.startZ &&
              boatPos.z <= rap.endZ &&
              Math.abs(boatPos.x - rap.centerX) < rap.width / 2 + 1.2
            ) {
              player.setRapidBoost(0.6, rap.speedBonus);
              if (!rap.triggered) {
                rap.triggered = true;
                score += 10;
                setScore(score);
                playCurrentBoostSound();
                showNpcToast("急流浪潮", "🌊", "「急湍甚箭，猛浪若奔！」乘急流飛馳前進！+10 分");
                saveProgress();
              }
              break;
            }
          }
        }

        let opened = false;
        for (const stele of world.steles) {
          if (stele.userData.solved) continue;
          if (stele.userData.position.distanceTo(camera.position) < stele.userData.triggerRadius) {
            triggerQuiz(stele);
            opened = true;
            break;
          }
        }
        if (!opened) tryTriggerExit();

        // 沿江 NPC 幽默互動
        if (world.encounters) {
          for (const enc of world.encounters) {
            const u = enc.userData;
            if (u.visited) continue;
            if (u.position.distanceTo(camera.position) < u.triggerRadius) {
              u.visited = true;
              showNpcToast(u.name, u.avatar, u.lines[0]);
              if (u.bonusScore) {
                score += u.bonusScore;
                setScore(score);
              }
              break;
            }
          }
        }

        // 江中漂流竹筒拾取
        if (world.flasks) {
          for (const flask of world.flasks) {
            const u = flask.userData;
            if (u.picked) continue;
            if (u.position.distanceTo(camera.position) < u.triggerRadius) {
              u.picked = true;
              flask.visible = false;
              handleFlaskReward(u.info);
              break;
            }
          }
        }
      }

      drawMinimap(world, player.position, player.yaw);
    }
  }

  renderer.render(scene, camera);
}

let isPaused = false;
function togglePause(forced) {
  if (state !== "playing" && state !== "paused") return;
  const target = typeof forced === "boolean" ? forced : state === "playing";
  isPaused = target;
  if (isPaused) {
    setState("paused");
    setPause(true);
  } else {
    setPause(false);
    setState("playing");
    if (!isTouchDevice && player) player.requestLock();
  }
}

if (btnPauseTouch) {
  btnPauseTouch.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePause();
  });
}

if (btnResume) {
  btnResume.addEventListener("click", togglePause);
}

if (btnRestartLevel) {
  btnRestartLevel.addEventListener("click", () => {
    isPaused = false;
    setPause(false);
    setupLevel(levelIndex);
  });
}

if (btnQuitTitle) {
  btnQuitTitle.addEventListener("click", () => {
    saveProgress();
    isPaused = false;
    setPause(false);
    hideHUD();
    setState("title");
    titleScreen.classList.remove("hidden");
    playTrack("menu");
    refreshTitleMenu();
  });
}

document.getElementById("pause-layer").addEventListener("click", (e) => {
  if (e.target.closest("button") || e.target.closest("input")) return;
  if (state === "paused") {
    togglePause();
  }
});

input.onLockChange = (locked) => {
  if (!isTouchDevice && state === "playing" && !locked) {
    isPaused = true;
    setState("paused");
    setPause(true);
  }
};

canvas.addEventListener("click", () => {
  if (!isTouchDevice && state === "playing" && !player.locked) player.requestLock();
});

for (const btn of [btnMute, btnMute2]) {
  btn.addEventListener("click", () => toggleAudioMuted());
}

for (const slider of [volumeSlider, volumeSlider2]) {
  const apply = () => setAudioVolume(Number(slider.value) / 100);
  slider.addEventListener("input", apply);
  slider.addEventListener("change", apply);
}

btnQuality.addEventListener("click", () => {
  const q = toggleQuality();
  renderer.setPixelRatio(pixelRatioFor(renderer));
  renderer.shadowMap.enabled = q.shadows;
  renderer.setSize(window.innerWidth, window.innerHeight);
  btnQuality.textContent = q.label;
  qualityNote.textContent = q.id === "low"
    ? "已切到低畫質：關閉陰影、降低解析度。需要重新載入畫面才會完整套用。"
    : "已切回完整畫質，需要重新載入畫面才會完整套用。";
  setupLevel(levelIndex, { autoStart: state === "playing" });
});

btnCredits.addEventListener("click", () => creditsLayer.classList.remove("hidden"));
btnCreditsClose.addEventListener("click", () => creditsLayer.classList.add("hidden"));

document.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement;
  if (!typing && (event.code === "Escape" || event.code === "KeyP")) {
    event.preventDefault();
    togglePause();
    return;
  }
  if (!typing && event.code === "KeyM") {
    toggleAudioMuted();
    return;
  }
  if (typing) return;
  const audio = audioModule.getState();
  if (event.code === "Minus") {
    event.preventDefault();
    setAudioVolume(audio.volume - 0.1);
  } else if (event.code === "Equal") {
    event.preventDefault();
    setAudioVolume(audio.volume + 0.1);
  }
});

onAudio((audio) => {
  const label = audio.failed ? "音樂無法載入" : audio.title ? `♪ ${audio.title}` : "♪";
  for (const btn of [btnMute, btnMute2]) {
    btn.classList.toggle("off", audio.muted);
    btn.setAttribute("aria-label", audio.muted ? "開啟音樂" : "靜音");
    btn.setAttribute("title", audio.muted ? "開啟音樂（M）" : "靜音（M）");
  }
  const pct = String(Math.round(audio.volume * 100));
  volumeSlider.value = pct;
  volumeSlider2.value = pct;
  trackName.textContent = label;
  trackName2.textContent = audio.failed ? "音樂無法載入" : audio.title ? `${audio.title}　${audio.credit}` : "";
});

function isSmallScreen() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const minDim = Math.min(w, h);
  // Detect mobile phone screen (usually short dimension < 560px or portrait phone)
  // Tablets (iPad etc) typically have min dimension >= 768px
  return minDim < 560 || (w < 720 && h < 460);
}

let warningAccepted = false;

function startNewGame() {
  titleScreen.classList.add("hidden");
  playTrack(String(LEVELS[0].id));
  clearProgress();
  resetRun();
  setupLevel(0);
}

if (btnContinue) {
  btnContinue.addEventListener("click", () => {
    if (isSmallScreen() && !warningAccepted) {
      mobileWarning.classList.remove("hidden");
      return;
    }
    continueGame();
  });
}

btnStart.addEventListener("click", () => {
  if (isSmallScreen() && !warningAccepted) {
    mobileWarning.classList.remove("hidden");
    return;
  }
  startNewGame();
});

if (btnWarningContinue) {
  btnWarningContinue.addEventListener("click", () => {
    warningAccepted = true;
    mobileWarning.classList.add("hidden");
    const saved = loadProgress();
    if (saved && typeof saved.levelIndex === "number" && LEVELS[saved.levelIndex]) {
      continueGame();
    } else {
      startNewGame();
    }
  });
}

if (btnWarningBack) {
  btnWarningBack.addEventListener("click", () => {
    mobileWarning.classList.add("hidden");
  });
}

// --- Tablet / Mobile Touch Controls Setup ---
if (joystickZone && joystickBase && joystickThumb) {
  let joystickTouchId = null;
  const maxRadius = 45;
  let baseRect = null;

  function updateJoystick(cx, cy) {
    if (!baseRect) return;
    const centerX = baseRect.left + baseRect.width / 2;
    const centerY = baseRect.top + baseRect.height / 2;
    let dx = cx - centerX;
    let dy = cy - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > maxRadius) {
      dx = (dx / dist) * maxRadius;
      dy = (dy / dist) * maxRadius;
    }
    joystickThumb.style.transform = `translate(${dx}px, ${dy}px)`;
    input.touchMove = {
      x: dx / maxRadius,
      y: -dy / maxRadius,
    };
  }

  joystickZone.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      if (joystickTouchId !== null) return;
      const touch = e.changedTouches[0];
      joystickTouchId = touch.identifier;
      baseRect = joystickBase.getBoundingClientRect();
      updateJoystick(touch.clientX, touch.clientY);
    },
    { passive: false }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (joystickTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystickTouchId) {
          e.preventDefault();
          updateJoystick(touch.clientX, touch.clientY);
          break;
        }
      }
    },
    { passive: false }
  );

  const endJoystick = (e) => {
    if (joystickTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === joystickTouchId) {
        joystickTouchId = null;
        joystickThumb.style.transform = "translate(0px, 0px)";
        input.touchMove = { x: 0, y: 0 };
        break;
      }
    }
  };
  window.addEventListener("touchend", endJoystick);
  window.addEventListener("touchcancel", endJoystick);
}

if (touchLookZone) {
  let lookTouchId = null;
  let lastTouchX = 0;
  let lastTouchY = 0;

  touchLookZone.addEventListener(
    "touchstart",
    (e) => {
      if (lookTouchId !== null) return;
      const touch = e.changedTouches[0];
      lookTouchId = touch.identifier;
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
    },
    { passive: true }
  );

  window.addEventListener(
    "touchmove",
    (e) => {
      if (lookTouchId === null) return;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === lookTouchId) {
          const dx = touch.clientX - lastTouchX;
          const dy = touch.clientY - lastTouchY;
          lastTouchX = touch.clientX;
          lastTouchY = touch.clientY;
          if (player) player.applyTouchLook(dx, dy);
          break;
        }
      }
    },
    { passive: true }
  );

  const endLook = (e) => {
    if (lookTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouchId) {
        lookTouchId = null;
        break;
      }
    }
  };
  window.addEventListener("touchend", endLook);
  window.addEventListener("touchcancel", endLook);
}

if (btnTouchBoost) {
  btnTouchBoost.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      input.touchBoost = true;
      btnTouchBoost.classList.add("active");
    },
    { passive: false }
  );

  const endBoost = () => {
    input.touchBoost = false;
    btnTouchBoost.classList.remove("active");
  };
  btnTouchBoost.addEventListener("touchend", endBoost);
  btnTouchBoost.addEventListener("touchcancel", endBoost);
  btnTouchBoost.addEventListener("mousedown", () => {
    input.touchBoost = true;
    btnTouchBoost.classList.add("active");
  });
  window.addEventListener("mouseup", endBoost);
}

btnReset.addEventListener("click", () => {
  clearProgress();
  refreshTitleMenu();
  showNpcToast("本機存檔", "🗑️", "已成功清除本機遊玩進度！");
});

btnReplay.addEventListener("click", () => {
  hideResult();
  playTrack(String(LEVELS[0].id));
  resetRun();
  setupLevel(0);
});

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(pixelRatioFor(renderer));
  renderer.setSize(window.innerWidth, window.innerHeight);
});

refreshTitleMenu();

btnQuality.textContent = quality.label;
loadAudioPrefs();
resetRun();
setupLevel(0, { autoStart: true, withMusic: false });
setState("title");
hideHUD();
playTrack("menu");

animate();

window.__wenyanDebug = {
  get state() {
    return state;
  },
  get level() {
    return levelIndex + 1;
  },
  get score() {
    return score;
  },
  get lives() {
    return lives;
  },
  get solved() {
    return world ? world.steles.filter((s) => s.userData.solved).length : 0;
  },
  get questionTotal() {
    return questionTotal;
  },
  stelePositions() {
    return world
      ? world.steles.map((s) => ({ char: s.userData.char, x: s.userData.position.x, y: s.userData.position.y, z: s.userData.position.z }))
      : [];
  },
  steleInfo() {
    return world
      ? world.steles.map((s) => ({
          char: s.userData.char,
          solved: s.userData.solved,
          terrainY: world.model.heightAt(s.userData.position.x, s.userData.position.z),
          steleY: s.userData.position.y,
        }))
      : [];
  },
  cameraY: () => camera.position.y,
  spawn: () => ({ x: player.position.x, y: player.position.y, z: player.position.z }),
  exitPos: () => (world ? { x: world.exit.userData.position.x, z: world.exit.userData.position.z } : null),
  pathClear: () => {
    if (!world || !player) return null;
    const samples = [];
    for (let z = player.position.z; z < player.position.z + 300; z += 5) {
      const x = world.model.pathX(z);
      samples.push({
        z: Math.round(z),
        pathX: +x.toFixed(2),
        y: +world.model.heightAt(x, z).toFixed(2),
        slope: +world.model.slopeAt(x, z).toFixed(3),
      });
    }
    return samples;
  },
  placeOnPath: (dz) => {
    const z = player.position.z + dz;
    player.teleport(world.model.pathX(z), z);
  },
  walkTo: (z) => {
    if (!world || !player) return;
    player.teleport(world.model.pathX(z), z);
  },
  setDpr: (d) => { renderer.setPixelRatio(d); renderer.setSize(window.innerWidth, window.innerHeight); },
  renderInfo: () => ({
    calls: renderer.info.render.calls,
    triangles: renderer.info.render.triangles,
  }),
  stepLogic: () => {
    const time = clock.elapsedTime;
    world.update(0.016, time, camera.position);
    player.update(0.016);
    drawMinimap(world, player.position, player.yaw);
  },
  renderOnly: () => renderer.render(scene, camera),
  lookAt: (yaw, pitch) => player.look(yaw, pitch),
  worldStats: () => (world ? world.stats() : null),
  solveAll: () => {
    if (!world) return;
    world.steles.forEach((s) => {
      if (!s.userData.solved) onSteleSolved(s);
    });
  },
  openNext: () => {
    if (levelIndex + 1 < LEVELS.length) setupLevel(levelIndex + 1);
    else endRun(true);
  },
  start: () => btnStart.click(),
  skipStory: () => {
    document.getElementById("story-next").click();
  },
};
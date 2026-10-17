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
const titleScreen = document.getElementById("title-screen");
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

function saveProgress() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ levelIndex, score, lives }));
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

function setState(next) {
  state = next;
  duckAudio(next !== "playing");
  if (player) player.setEnabled(next === "playing");
  if (next !== "playing" && player && player.locked) player.exitLock();
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
  setObjective(`沿江前行，尋找 ${level.steles.length} 面字碑`);
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
    player.requestLock();
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
    setObjective("字碑全破——前方山門已開，向前走");
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
    setObjective(`字碑還剩 ${remaining} 面`);
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
      player.requestLock();
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
      }

      drawMinimap(world, player.position, player.yaw);
    }
  }

  renderer.render(scene, camera);
}

input.onLockChange = (locked) => {
  if (state === "playing") setPause(!locked);
};

canvas.addEventListener("click", () => {
  if (state === "playing" && !player.locked) player.requestLock();
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

btnStart.addEventListener("click", () => {
  titleScreen.classList.add("hidden");
  playTrack(String(LEVELS[0].id));
  clearProgress();
  resetRun();
  setupLevel(0);
});

btnReset.addEventListener("click", () => {
  clearProgress();
  btnStart.textContent = "開始遊戲";
  const original = "清除進度";
  btnReset.textContent = "已清除進度";
  setTimeout(() => {
    btnReset.textContent = original;
  }, 1600);
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

const saved = loadProgress();
if (saved && typeof saved.levelIndex === "number" && saved.levelIndex > 0) {
  btnStart.textContent = `繼續第 ${saved.levelIndex + 1} 關`;
}

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
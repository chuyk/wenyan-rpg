import { TERRAIN_W, TERRAIN_START_Z, TERRAIN_L } from "./world.js";

const hud = document.getElementById("hud");
const chapterIndex = document.getElementById("chapter-index");
const chapterTitle = document.getElementById("chapter-title");
const chapterLine = document.getElementById("chapter-line");
const heartsEl = document.getElementById("hearts");
const scoreEl = document.getElementById("score");
const objectiveEl = document.getElementById("objective-text");
const minimapCanvas = document.getElementById("minimap-canvas");
const minimapLabel = document.getElementById("minimap-label");
const minimapCtx = minimapCanvas.getContext("2d");

const storyLayer = document.getElementById("story-layer");
const storyTitle = document.getElementById("story-title");
const storyBody = document.getElementById("story-body");
const storyNext = document.getElementById("story-next");
const resultLayer = document.getElementById("result-layer");
const pauseLayer = document.getElementById("pause-layer");

const MM_W = minimapCanvas.width;
const MM_H = minimapCanvas.height;
const SCALE = MM_W / TERRAIN_L;

function toMapX(x) {
  return ((x + TERRAIN_W / 2) / TERRAIN_W) * MM_W;
}

function toMapY(z) {
  return ((z - TERRAIN_START_Z) / TERRAIN_L) * MM_H;
}

function hexColor(value) {
  return "#" + value.toString(16).padStart(6, "0");
}

export function showHUD() {
  hud.classList.remove("hidden");
}

export function hideHUD() {
  hud.classList.add("hidden");
}

export function setChapter(level) {
  chapterIndex.textContent = level.subtitle;
  chapterTitle.textContent = level.name;
  chapterLine.textContent = level.line;
}

export function setScore(score) {
  scoreEl.textContent = `分數 ${score}`;
}

export function setHearts(lives, maxLives) {
  heartsEl.innerHTML = Array.from({ length: maxLives }, (_, i) => (i < lives ? "◆" : "◇")).join(" ");
  heartsEl.style.color = lives <= 1 ? "#e0776a" : "#f2ece0";
}

export function setObjective(text) {
  objectiveEl.textContent = text;
}

export function setPause(visible) {
  pauseLayer.classList.toggle("hidden", !visible);
}

export function openStory(level, onClose) {
  storyTitle.textContent = level.intro.title;
  storyBody.innerHTML = level.intro.body
    .map((p, i) => {
      if (i === 0) return `<p>${p}</p>`;
      return `<p class="${i === level.intro.body.length - 1 ? "note" : ""}">${p}</p>`;
    })
    .join("");
  storyLayer.classList.remove("hidden");

  const handler = () => {
    storyLayer.classList.add("hidden");
    storyNext.removeEventListener("click", handler);
    document.removeEventListener("keydown", onEnter);
    onClose();
  };
  const onEnter = (e) => {
    if (e.code === "Enter" || e.code === "Space") handler();
  };
  storyNext.addEventListener("click", handler);
  document.addEventListener("keydown", onEnter);
}

export function isOverlayOpen() {
  return (
    !storyLayer.classList.contains("hidden") ||
    !resultLayer.classList.contains("hidden")
  );
}

export function drawMinimap(world, playerPos, yaw) {
  const ctx = minimapCtx;
  ctx.clearRect(0, 0, MM_W, MM_H);

  ctx.fillStyle = "rgba(30,38,32,0.85)";
  ctx.fillRect(0, 0, MM_W, MM_H);

  const theme = world.theme;
  const riverW = theme.riverWidth * (MM_W / TERRAIN_W);
  const cx = toMapX(0);
  ctx.fillStyle = hexColor(theme.waterDeep);
  ctx.fillRect(cx - riverW / 2, 0, riverW, MM_H);

  ctx.strokeStyle = "rgba(242,236,224,0.28)";
  ctx.lineWidth = 2;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  for (let z = TERRAIN_START_Z; z <= TERRAIN_START_Z + TERRAIN_L; z += 8) {
    const x = world.model.riverPathX ? world.model.riverPathX(z) : world.model.pathX(z);
    const px = toMapX(x);
    const py = toMapY(z);
    if (z === TERRAIN_START_Z) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  if (world.rapids) {
    ctx.fillStyle = "rgba(102, 217, 238, 0.35)";
    for (const rap of world.rapids) {
      const sy = toMapY(rap.startZ);
      const ey = toMapY(rap.endZ);
      const cx = toMapX(rap.centerX);
      ctx.fillRect(cx - 3.5, sy, 7, ey - sy);
    }
  }

  if (world.rocks) {
    ctx.fillStyle = "#7a4338";
    for (const rk of world.rocks) {
      const rx = toMapX(rk.position.x);
      const ry = toMapY(rk.position.z);
      ctx.beginPath();
      ctx.arc(rx, ry, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const stele of world.steles) {
    const u = stele.userData;
    const px = toMapX(u.position.x);
    const py = toMapY(u.position.z);
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fillStyle = u.solved ? "rgba(180,170,150,0.5)" : "#f0c46a";
    ctx.fill();
    if (!u.solved) {
      ctx.strokeStyle = "rgba(240,196,106,0.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 10, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = u.solved ? "rgba(240,236,224,0.45)" : "#fff6e2";
    ctx.font = "10px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(u.char, px, py + 0.5);
  }

  const ex = world.exit.userData;
  const exx = toMapX(ex.position.x);
  const exy = toMapY(ex.position.z);
  ctx.fillStyle = "#9c2b1e";
  ctx.fillRect(exx - 5, exy - 2.5, 10, 5);

  const ppx = toMapX(playerPos.x);
  const ppy = toMapY(playerPos.z);
  ctx.save();
  ctx.translate(ppx, ppy);
  ctx.rotate(-yaw);
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fillStyle = "#f2ece0";
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  const solved = world.steles.filter((s) => s.userData.solved).length;
  minimapLabel.textContent = `字碑 ${solved} / ${world.steles.length}`;
}

export function showResult({ score, accuracy, wrongTotal, rank, breakdown }) {
  const rows = breakdown
    .map(
      (b) =>
        `<div class="result-row"><span class="k">${b.title}</span><span class="v">${b.text}</span></div>`
    )
    .join("");

  document.getElementById("result-title").textContent = rank ? "山高水長" : "遊戲結束";
  document.getElementById("result-body").innerHTML = `
    ${rows}
    <div class="result-row"><span class="k">總分</span><span class="v">${score}</span></div>
    <div class="result-row"><span class="k">答題正確率</span><span class="v">${accuracy}%</span></div>
    <div class="result-row"><span class="k">失誤次數</span><span class="v">${wrongTotal}</span></div>
    <div class="result-grade">${rank ? rank.label : ""}</div>
    <p style="text-align:center;color:#55534d">${rank ? rank.note : ""}</p>
  `;
  resultLayer.classList.remove("hidden");
}

export function hideResult() {
  resultLayer.classList.add("hidden");
}
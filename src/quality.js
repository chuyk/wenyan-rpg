const KEY = "wenyan-rpg-quality-v1";

const LOW = {
  id: "low",
  label: "低畫質",
  pixelRatio: 0.6,
  shadows: false,
  trees: 120,
  rocks: 45,
  mist: 0,
  peaks: 1,
  birdsScale: 0,
  waterSegments: [24, 48],
  terrainSegments: [80, 120],
  groundTexture: false,
  birds: false,
};

const HIGH = {
  id: "high",
  label: "完整畫質",
  pixelRatio: null,
  shadows: true,
  trees: 460,
  rocks: 130,
  mist: 12,
  peaks: 3,
  birdsScale: 1,
  waterSegments: [60, 120],
  terrainSegments: [132, 196],
  groundTexture: true,
  birds: true,
};

let active = HIGH;

function detectRenderer() {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") || canvas.getContext("webgl");
    if (!gl) return "";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : "";
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
    return String(name);
  } catch (e) {
    void e;
    return "";
  }
}

export function isSoftwareRenderer(name = detectRenderer()) {
  return /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic/i.test(name);
}

export function initQuality() {
  const forced = new URLSearchParams(location.search).get("quality");
  if (forced === "low" || forced === "high") {
    active = forced === "low" ? LOW : HIGH;
  } else {
    let saved = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch (e) {
      void e;
    }
    if (saved === "low" || saved === "high") {
      active = saved === "low" ? LOW : HIGH;
    } else {
      active = isSoftwareRenderer() ? LOW : HIGH;
    }
  }
  return active;
}

export function getQuality() {
  return active;
}

export function pixelRatioFor(renderer) {
  if (active.pixelRatio !== null) return active.pixelRatio;
  return Math.min(window.devicePixelRatio || 1, 2);
}

export function setQuality(id) {
  active = id === "low" ? LOW : HIGH;
  try {
    localStorage.setItem(KEY, active.id);
  } catch (e) {
    void e;
  }
  return active;
}

export function toggleQuality() {
  return setQuality(active.id === "low" ? "high" : "low");
}
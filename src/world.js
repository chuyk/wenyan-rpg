import * as THREE from "three";
import { getQuality } from "./quality.js";

export const TERRAIN_W = 320;
export const TERRAIN_L = 500;
export const TERRAIN_START_Z = -40;
export const TERRAIN_END_Z = TERRAIN_START_Z + TERRAIN_L;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function makeValueNoise(seed) {
  const rnd = mulberry32(seed);
  const size = 256;
  const table = new Float32Array(size * size);
  for (let i = 0; i < table.length; i++) table[i] = rnd();
  const at = (ix, iy) => table[(ix & 255) + ((iy & 255) << 8)];
  return function noise2(x, y) {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = fade(xf);
    const v = fade(yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
  };
}

function makeFbm(seed) {
  const noise2 = makeValueNoise(seed);
  return function fbm(x, y, octaves = 4) {
    let sum = 0;
    let amp = 1;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += noise2(x * freq, y * freq) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
}

export function createTerrainModel(level) {
  const t = level.theme;
  const fbm = makeFbm(level.id * 9173 + 4211);
  const fbm2 = makeFbm(level.id * 3119 + 88);
  const halfRiver = t.riverWidth / 2;

  const pathX = (z) => halfRiver + 11 + Math.sin(z * 0.017) * 6 + Math.sin(z * 0.0061 + 1.2) * 4;

  const riverPathX = (z) => Math.sin(z * 0.015) * (halfRiver * 0.22) + Math.sin(z * 0.005 + 0.8) * (halfRiver * 0.12);

  const pathBaseY = (z) => 2.2 + Math.sin(z * 0.0105 + 0.7) * 1.15 + fbm(z * 0.009, 17.3, 2) * 1.6;

  function heightAt(x, z) {
    const ax = Math.abs(x);
    let h;

    if (ax < halfRiver) {
      const k = ax / halfRiver;
      h = -9 + 4 * k * k;
      h += fbm(x * 0.05, z * 0.05, 2) * 0.9;
    } else {
      const bank = ax - halfRiver;
      h = 1.1 + Math.pow(Math.min(bank / 78, 1), 1.7) * t.height;
      h += Math.min(bank / 9, 1) * 2.2;
      const landMask = smoothstep(halfRiver, halfRiver + 22, ax);
      h += fbm(x * 0.011, z * 0.011, 4) * 9 * landMask;
      h += fbm2(x * 0.05, z * 0.05, 3) * 1.4 * landMask;
    }

    const dPath = Math.abs(x - pathX(z));
    const flatWeight = 1 - smoothstep(3, 17, dPath);
    if (flatWeight > 0) h = lerp(h, pathBaseY(z), flatWeight);

    const zMask = smoothstep(TERRAIN_START_Z - 14, TERRAIN_START_Z + 14, z);
    h = lerp(pathBaseY(z) - 9, h, zMask);

    return h;
  }

  function slopeAt(x, z) {
    const e = 1.4;
    const hx = heightAt(x + e, z) - heightAt(x - e, z);
    const hz = heightAt(x, z + e) - heightAt(x, z - e);
    return Math.sqrt(hx * hx + hz * hz) / (2 * e);
  }

  return { heightAt, slopeAt, pathX, riverPathX, pathBaseY, halfRiver };
}

function makeSoftTexture(inner = "rgba(255,255,255,1)", outer = "rgba(255,255,255,0)") {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, inner.replace(/[\d.]+\)$/, "0.55)"));
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGroundTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);

  const rnd = mulberry32(9182);
  const cells = 64;
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();

  const sample = (x, y) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const xi = Math.floor(fx);
      const yi = Math.floor(fy);
      const tx = fade(fx - xi);
      const ty = fade(fy - yi);
      const a = sample(xi, yi);
      const b = sample(xi + 1, yi);
      const c = sample(xi, yi + 1);
      const d = sample(xi + 1, yi + 1);
      const v = lerp(lerp(a, b, tx), lerp(c, d, tx), ty);

      const speckle = rnd() * 0.12 - 0.06;
      const value = Math.max(0, Math.min(1, 0.86 + v * 0.16 + speckle * 0.5));
      const i = (y * size + x) * 4;
      image.data[i] = value * 255;
      image.data[i + 1] = value * 255;
      image.data[i + 2] = value * 255;
      image.data[i + 3] = 255;
    }
  }

  ctx.putImageData(image, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(96, 144);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeCharacterTexture(char) {
  const w = 512;
  const h = 640;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#efe6d2");
  grad.addColorStop(1, "#d8caab");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = "rgba(60,50,36,.35)";
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, w - 28, h - 28);

  ctx.fillStyle = "#7c1f16";
  ctx.font = '700 60px "Noto Serif TC", "Songti TC", "AR PL UMing", serif';
  ctx.textAlign = "center";
  ctx.fillText("字碑", w / 2, 96);

  ctx.fillStyle = "#221d16";
  ctx.font = '700 300px "Noto Serif TC", "Songti TC", "AR PL UMing", serif';
  ctx.fillText(char, w / 2, h / 2 + 110);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function buildTerrainGeometry(model, level) {
  const t = level.theme;
  const [SX, SZ] = getQuality().terrainSegments;
  const cols = SX + 1;
  const count = cols * (SZ + 1);

  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const uvs = new Float32Array(count * 2);

  const cLow = new THREE.Color(t.groundDeep);
  const cMid = new THREE.Color(t.ground);
  const cHigh = new THREE.Color(0x9a9384);
  const cSilt = new THREE.Color(0xb7ab8c);
  const cRock = new THREE.Color(0x6f6a60);
  const cTrail = new THREE.Color(0xa8977a);
  const tmp = new THREE.Color();

  for (let j = 0; j <= SZ; j++) {
    for (let i = 0; i <= SX; i++) {
      const k = j * cols + i;
      const x = -TERRAIN_W / 2 + (i / SX) * TERRAIN_W;
      const z = TERRAIN_START_Z + (j / SZ) * TERRAIN_L;
      const y = model.heightAt(x, z);

      positions[k * 3] = x;
      positions[k * 3 + 1] = y;
      positions[k * 3 + 2] = z;
      uvs[k * 2] = i / SX;
      uvs[k * 2 + 1] = j / SZ;

      const slope = model.slopeAt(x, z);
      const highness = smoothstep(t.height * 0.35, t.height * 1.05, y);

      tmp.copy(cLow).lerp(cMid, smoothstep(-4, 6, y));
      tmp.lerp(cHigh, highness * 0.85);
      tmp.lerp(cSilt, (1 - smoothstep(0.4, 3.2, y)) * 0.75);
      tmp.lerp(cRock, smoothstep(0.45, 1.05, slope) * 0.8);
      const onTrail = 1 - smoothstep(2.5, 7.5, Math.abs(x - model.pathX(z)));
      tmp.lerp(cTrail, onTrail * 0.42);
      colors[k * 3] = tmp.r;
      colors[k * 3 + 1] = tmp.g;
      colors[k * 3 + 2] = tmp.b;
    }
  }

  const indices = new Uint32Array(SX * SZ * 6);
  let p = 0;
  for (let j = 0; j < SZ; j++) {
    for (let i = 0; i < SX; i++) {
      const a = j * cols + i;
      const c = a + cols;
      const b = a + 1;
      const d = c + 1;
      indices[p++] = a;
      indices[p++] = c;
      indices[p++] = b;
      indices[p++] = b;
      indices[p++] = c;
      indices[p++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function buildWater(theme) {
  const [wx, wz] = getQuality().waterSegments;
  const geo = new THREE.PlaneGeometry(theme.riverWidth * 1.35, TERRAIN_L + 60, wx, wz);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, TERRAIN_START_Z + TERRAIN_L / 2);

  const material = new THREE.ShaderMaterial({
    transparent: true,
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(theme.water) },
      uDeep: { value: new THREE.Color(theme.waterDeep) },
      uSun: { value: new THREE.Color(theme.sun) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.55).normalize() },
      uHalfWidth: { value: (theme.riverWidth / 2) * 1.35 },
    },
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      void main() {
        vec3 p = position;
        float w1 = sin(p.x * 0.09 + uTime * 1.35) * 0.34;
        float w2 = sin(p.z * 0.15 - uTime * 0.95) * 0.26;
        float w3 = sin((p.x + p.z) * 0.045 + uTime * 0.6) * 0.42;
        p.y += w1 + w2 + w3;
        vec3 dx = vec3(1.0, 0.09 * cos(p.x * 0.09 + uTime * 1.35), 0.0);
        vec3 dz = vec3(0.0, 0.15 * cos(p.z * 0.15 - uTime * 0.95), 1.0);
        vNormalW = normalize(cross(dz, dx));
        vec4 world = modelMatrix * vec4(p, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uShallow;
      uniform vec3 uDeep;
      uniform vec3 uSun;
      uniform vec3 uSunDir;
      uniform float uHalfWidth;
      varying vec3 vWorld;
      varying vec3 vNormalW;

      void main() {
        vec3 n = normalize(vNormalW);
        vec3 viewDir = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 2.6);

        float edge = 1.0 - smoothstep(uHalfWidth * 0.55, uHalfWidth * 0.98, abs(vWorld.x));
        vec3 base = mix(uShallow, uDeep, edge * 0.85);
        base = mix(base, uShallow, fres * 0.5);

        vec3 h = normalize(uSunDir + viewDir);
        float spec = pow(max(dot(n, h), 0.0), 90.0);

        float ripple = sin(vWorld.z * 0.55 - uTime * 2.1 + vWorld.x * 0.2) * 0.5 + 0.5;
        float foam = smoothstep(0.86, 1.0, ripple) * (1.0 - edge) * 0.5;

        vec3 color = base + uSun * spec * 0.85 + vec3(foam);
        float alpha = mix(0.72, 0.94, edge);
        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = 0;
  mesh.renderOrder = 1;
  return { mesh, material };
}

function buildSky(theme) {
  const geo = new THREE.SphereGeometry(900, 24, 14);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(theme.sky[0]) },
      uBottom: { value: new THREE.Color(theme.sky[1]) },
      uSun: { value: new THREE.Color(theme.sun) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uTop;
      uniform vec3 uBottom;
      uniform vec3 uSun;
      varying vec3 vPos;
      void main() {
        vec3 dir = normalize(vPos);
        float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        vec3 c = mix(uBottom, uTop, pow(t, 0.85));
        float sun = pow(max(dot(dir, normalize(vec3(0.4, 0.55, 0.72))), 0.0), 26.0);
        c += uSun * sun * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -1;
  return mesh;
}

function buildForest(model, theme, seed) {
  const group = new THREE.Group();
  const rnd = mulberry32(seed);

  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.4, 4.4, 6);
  trunkGeo.translate(0, 2.2, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: theme.treeAlt, roughness: 0.95 });

  const crownGeo = new THREE.ConeGeometry(2.1, 5.4, 7);
  crownGeo.translate(0, 6.2, 0);
  const crownMat = new THREE.MeshStandardMaterial({ color: theme.tree, roughness: 0.88, flatShading: true });

  const COUNT = getQuality().trees;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, COUNT);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, COUNT);
  const castShadow = getQuality().shadows;
  trunks.castShadow = castShadow;
  crowns.castShadow = castShadow;
  crowns.receiveShadow = castShadow;

  const dummy = new THREE.Object3D();
  let placed = 0;
  let attempts = 0;

  while (placed < COUNT && attempts < COUNT * 14) {
    attempts++;
    const x = (rnd() - 0.5) * (TERRAIN_W - 24);
    const z = TERRAIN_START_Z + rnd() * TERRAIN_L;
    const y = model.heightAt(x, z);
    const ax = Math.abs(x);

    if (ax < theme.riverWidth / 2 + 3.5) continue;
    if (y < 1.6) continue;
    if (model.slopeAt(x, z) > 0.85) continue;
    if (Math.abs(x - model.pathX(z)) < 7.5) continue;
    if (y > theme.height * 1.15) continue;

    const scale = 0.7 + rnd() * 0.9;
    dummy.position.set(x, y - 0.3, z);
    dummy.rotation.set((rnd() - 0.5) * 0.08, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.08);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();

    trunks.setMatrixAt(placed, dummy.matrix);
    crowns.setMatrixAt(placed, dummy.matrix);
    placed++;
  }

  trunks.count = placed;
  crowns.count = placed;
  trunks.instanceMatrix.needsUpdate = true;
  crowns.instanceMatrix.needsUpdate = true;
  group.add(trunks, crowns);
  return group;
}

function buildRocks(model, theme, seed) {
  const rnd = mulberry32(seed);
  const COUNT = getQuality().rocks;
  const geo = new THREE.DodecahedronGeometry(1, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0x8b847b, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.castShadow = getQuality().shadows;
  mesh.receiveShadow = true;

  const dummy = new THREE.Object3D();
  let placed = 0;
  let attempts = 0;
  while (placed < COUNT && attempts < COUNT * 12) {
    attempts++;
    const x = (rnd() - 0.5) * (TERRAIN_W - 20);
    const z = TERRAIN_START_Z + rnd() * TERRAIN_L;
    const y = model.heightAt(x, z);
    if (y < 0.8) continue;
    if (Math.abs(x - model.pathX(z)) < 5) continue;
    const s = 0.7 + rnd() * 2.1;
    dummy.position.set(x, y + s * 0.15, z);
    dummy.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
    dummy.scale.set(s * (0.7 + rnd() * 0.6), s * (0.5 + rnd() * 0.4), s * (0.7 + rnd() * 0.6));
    dummy.updateMatrix();
    mesh.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

function buildDistantPeaks(theme, seed) {
  const rnd = mulberry32(seed);
  const group = new THREE.Group();
  const bandColors = [0x5c7189, 0x78899e, 0x94a1b1];
  const closingColors = [0x50647a, 0x6e8196, 0x47596e];

  const bands = [
    { count: 14, distMin: 250, distMax: 340, hMin: 90, hMax: 175, rMin: 42, rMax: 78 },
    { count: 12, distMin: 360, distMax: 460, hMin: 130, hMax: 240, rMin: 58, rMax: 100 },
    { count: 10, distMin: 480, distMax: 640, hMin: 180, hMax: 320, rMin: 74, rMax: 128 },
  ];

  const qBands = getQuality().peaks;
  bands.slice(0, qBands).forEach((band, bi) => {
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(bandColors[bi]), fog: false });

    for (let i = 0; i < band.count; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const dist = band.distMin + rnd() * (band.distMax - band.distMin);
      const x = side * dist + (rnd() - 0.5) * 70;
      const z = TERRAIN_START_Z - 120 + rnd() * (TERRAIN_L + 300);
      const h = band.hMin + rnd() * (band.hMax - band.hMin);
      const r = band.rMin + rnd() * (band.rMax - band.rMin);
      const segs = 5 + Math.floor(rnd() * 4);
      const geo = new THREE.ConeGeometry(r, h, segs);
      const peak = new THREE.Mesh(geo, mat);
      peak.position.set(x, h / 2 - 55, z);
      peak.rotation.y = rnd() * Math.PI;
      peak.scale.z = 0.55 + rnd() * 0.5;
      group.add(peak);
    }
  });

  const closing = [
    { r: 150, h: 250, z: TERRAIN_END_Z + 210, sx: -90 },
    { r: 205, h: 320, z: TERRAIN_END_Z + 330, sx: 60 },
    { r: 130, h: 195, z: TERRAIN_END_Z + 170, sx: 150 },
  ];
  closing.forEach((c, i) => {
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(closingColors[i]),
      fog: false,
    });
    const peak = new THREE.Mesh(new THREE.ConeGeometry(c.r, c.h, 6 + (i % 2)), mat);
    peak.position.set(c.sx, c.h / 2 - 70, c.z);
    peak.scale.z = 0.42;
    group.add(peak);
  });

  return group;
}

function buildBirds(theme, count) {
  const group = new THREE.Group();
  const geo = new THREE.ConeGeometry(0.7, 2.6, 4);
  geo.rotateX(Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 1, flatShading: true });
  const birds = [];

  for (let i = 0; i < count; i++) {
    const bird = new THREE.Mesh(geo, mat);
    bird.scale.setScalar(0.8 + Math.random() * 0.6);
    group.add(bird);
    birds.push({
      mesh: bird,
      radius: 26 + Math.random() * 60,
      height: 48 + Math.random() * 70,
      z: TERRAIN_START_Z + 60 + Math.random() * (TERRAIN_L - 120),
      speed: 0.16 + Math.random() * 0.22,
      phase: Math.random() * Math.PI * 2,
    });
  }

  return {
    group,
    update(dt, time) {
      for (const b of birds) {
        const a = time * b.speed + b.phase;
        b.mesh.position.set(Math.cos(a) * b.radius, b.height + Math.sin(a * 1.7) * 6, b.z + Math.sin(a) * b.radius);
        b.mesh.rotation.set(0, -a + Math.PI / 2, Math.sin(time * 3 + b.phase) * 0.5);
      }
    },
  };
}

function buildMist(theme) {
  const group = new THREE.Group();
  const count = getQuality().mist;
  if (count === 0) {
    group.userData.update = () => {};
    return group;
  }
  const tex = makeSoftTexture("rgba(240,245,242,1)", "rgba(240,245,242,0)");
  for (let i = 0; i < count; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0.1 + Math.random() * 0.14,
      depthWrite: false,
    });
    const s = new THREE.Sprite(mat);
    const x = (Math.random() - 0.5) * 220;
    s.position.set(x, 2 + Math.random() * 12, TERRAIN_START_Z + Math.random() * TERRAIN_L);
    const scale = 40 + Math.random() * 70;
    s.scale.set(scale, scale * 0.45, 1);
    group.add(s);
  }
  group.userData.update = (time) => {
    group.children.forEach((s, i) => {
      s.position.x += Math.sin(time * 0.12 + i) * 0.06;
    });
  };
  return group;
}

function buildStele(model, level, index, side) {
  const total = level.steles.length;
  const z = TERRAIN_START_Z + 62 + (index / total) * (TERRAIN_L * 0.72) + 24;
  const stele = level.steles[index];
  // Positioned along the sides of the river channel
  const x = model.riverPathX(z) + side * (model.halfRiver * 0.44);
  const y = 0; // Floating / anchored at water surface level

  const group = new THREE.Group();
  group.position.set(x, y, z);

  // Natural river islet / crag rocks supporting the stele in the water
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x484b46, roughness: 0.95 });
  const cragGeo = new THREE.DodecahedronGeometry(2.4, 1);
  const crag1 = new THREE.Mesh(cragGeo, rockMat);
  crag1.position.set(0, 0.2, 0);
  crag1.scale.set(1.5, 0.6, 1.3);
  crag1.receiveShadow = getQuality().shadows;
  crag1.castShadow = getQuality().shadows;

  const crag2 = new THREE.Mesh(cragGeo, rockMat);
  crag2.position.set(-side * 1.6, -0.1, 0.8);
  crag2.scale.set(1.1, 0.5, 1.0);
  crag2.rotation.y = 0.8;
  crag2.receiveShadow = getQuality().shadows;

  const crag3 = new THREE.Mesh(cragGeo, rockMat);
  crag3.position.set(side * 1.5, -0.1, -0.7);
  crag3.scale.set(1.0, 0.45, 0.9);
  crag3.rotation.y = -0.5;
  crag3.receiveShadow = getQuality().shadows;

  const baseGeo = new THREE.BoxGeometry(4.4, 0.8, 2.8);
  const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x6b655c, roughness: 1 }));
  base.position.y = 0.9;
  base.receiveShadow = getQuality().shadows;

  const slabGeo = new THREE.BoxGeometry(3.6, 6.4, 0.7);
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 0.95 }));
  slab.position.y = 4.5;
  slab.castShadow = getQuality().shadows;

  const faceMat = new THREE.MeshStandardMaterial({
    map: makeCharacterTexture(stele.char),
    roughness: 0.85,
    emissive: 0x2a2419,
    emissiveIntensity: 0.5,
  });
  // Stele face angled towards the river channel
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 4.2), faceMat);
  const angleToRiver = side > 0 ? -Math.PI / 8 : Math.PI + Math.PI / 8;
  group.rotation.y = angleToRiver;

  face.position.set(0, 4.5, 0.37);

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSoftTexture("rgba(255,226,160,1)", "rgba(255,226,160,0)"),
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(9.5, 9.5, 1);
  halo.position.y = 4.8;

  const lamp = new THREE.PointLight(0xffca7a, 2.8, 24, 2);
  lamp.position.set(0, 4.8, 1.8);

  group.add(crag1, crag2, crag3, base, slab, face, halo, lamp);

  group.userData = {
    kind: "stele",
    index,
    char: stele.char,
    position: new THREE.Vector3(x, y, z),
    triggerRadius: 9.2,
    solved: false,
    faceMat,
    halo,
    slab,
    lamp,
    baseY: y,
  };

  return group;
}

function buildExitGate(model, level) {
  const t = level.theme;
  const z = TERRAIN_END_Z - 34;
  const x = model.riverPathX(z);
  const y = 0;

  const group = new THREE.Group();
  group.position.set(x, y, z);

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8a2b1e, roughness: 0.7 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x6f2318, roughness: 0.8 });
  const goldMat = new THREE.MeshStandardMaterial({ color: 0xb08b3f, metalness: 0.3, roughness: 0.5 });

  // Wide span gate arching across the Fuchun river
  const halfSpan = Math.min(model.halfRiver * 0.85, 20);

  const left = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 15, 12), pillarMat);
  left.position.set(-halfSpan, 7, 0);
  left.castShadow = getQuality().shadows;

  const right = left.clone();
  right.position.x = halfSpan;

  // Base stone pedestals in water
  const baseStoneGeo = new THREE.CylinderGeometry(1.6, 2.0, 3, 10);
  const baseStoneMat = new THREE.MeshStandardMaterial({ color: 0x4a4a46, roughness: 0.9 });
  const leftBase = new THREE.Mesh(baseStoneGeo, baseStoneMat);
  leftBase.position.set(-halfSpan, 0.5, 0);
  const rightBase = leftBase.clone();
  rightBase.position.x = halfSpan;

  const totalWidth = halfSpan * 2 + 5;
  const beam = new THREE.Mesh(new THREE.BoxGeometry(totalWidth, 1.2, 1.8), beamMat);
  beam.position.y = 13.8;
  beam.castShadow = getQuality().shadows;

  const top = new THREE.Mesh(new THREE.BoxGeometry(totalWidth + 3, 0.8, 2.4), goldMat);
  top.position.y = 15.0;

  const veilMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.18,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(halfSpan * 2 - 1, 13), veilMat);
  veil.position.set(0, 6.5, 0);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSoftTexture("rgba(255,210,150,1)", "rgba(255,210,150,0)"),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.scale.set(halfSpan * 2 + 8, 22, 1);
  glow.position.y = 7.0;

  group.add(leftBase, rightBase, left, right, beam, top, veil, glow);

  group.userData = {
    kind: "exit",
    position: new THREE.Vector3(x, y, z),
    triggerRadius: 12.0,
    veil,
    glow,
  };

  return group;
}

function buildRiverEncounters(model, level) {
  const encounters = [];
  const flasks = [];
  const animators = [];

  // 1. 富春江釣叟 (嚴子陵釣台後人)
  {
    const z = TERRAIN_START_Z + 115;
    const x = model.riverPathX(z) - model.halfRiver * 0.46;
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 竹筏
    const raftMat = new THREE.MeshStandardMaterial({ color: 0x8a724d, roughness: 0.9 });
    for (let i = -2; i <= 2; i++) {
      const bamboo = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.8, 8), raftMat);
      bamboo.rotation.x = Math.PI / 2;
      bamboo.position.set(i * 0.38, 0.05, 0);
      group.add(bamboo);
    }

    // 老翁身軀
    const robeMat = new THREE.MeshStandardMaterial({ color: 0x556066, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.45, 0.9, 8), robeMat);
    body.position.set(0, 0.5, 0);
    group.add(body);

    // 斗笠
    const hatMat = new THREE.MeshStandardMaterial({ color: 0xc49b45, roughness: 0.75 });
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.55, 0.22, 10), hatMat);
    hat.position.set(0, 1.05, 0);
    group.add(hat);

    // 釣竿與魚線
    const rodMat = new THREE.MeshStandardMaterial({ color: 0x3d2719, roughness: 0.8 });
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 2.6, 6), rodMat);
    rod.rotation.z = -0.65;
    rod.rotation.y = 0.4;
    rod.position.set(0.6, 0.9, 0.6);
    group.add(rod);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSoftTexture("rgba(180,220,255,0.8)", "rgba(180,220,255,0)"),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(5.5, 5.5, 1);
    halo.position.y = 1.0;
    group.add(halo);

    group.userData = {
      kind: "npc",
      name: "富春江釣叟",
      avatar: "🎣",
      lines: [
        "船家慢點～「游魚細石」都被衝跑啦！千丈見底把魚看得清清楚楚，魚就是不咬鉤……罷了，老夫贈你躍魚一尾，前程大順！",
        "自富陽至桐廬一百許里，老夫在此垂釣三十載，這山水真是「天下獨絕」啊！"
      ],
      bonusScore: 35,
      triggerRadius: 13.5,
      visited: false,
      position: new THREE.Vector3(x, 0, z),
    };

    encounters.push(group);
    animators.push((t) => {
      group.position.y = Math.sin(t * 1.8 + 1) * 0.04;
      rod.rotation.z = -0.65 + Math.sin(t * 3.2) * 0.05;
    });
  }

  // 2. 宋府信鴿 (好鳥相鳴)
  {
    const z = TERRAIN_START_Z + 225;
    const x = model.riverPathX(z) + model.halfRiver * 0.45;
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 江中石樁
    const postMat = new THREE.MeshStandardMaterial({ color: 0x4d504b, roughness: 0.95 });
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 2.2, 8), postMat);
    post.position.set(0, 0.6, 0);
    group.add(post);

    // 白鳥身體
    const birdMat = new THREE.MeshStandardMaterial({ color: 0xf5f6f8, roughness: 0.6 });
    const birdBody = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 8), birdMat);
    birdBody.position.set(0, 1.85, 0);
    birdBody.scale.set(0.9, 0.7, 1.3);

    // 翅膀
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.05, 0.45), wingMat);
    wingL.position.set(-0.3, 1.9, 0);
    const wingR = wingL.clone();
    wingR.position.x = 0.3;

    // 喙
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xe6a122 });
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 5), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 1.85, 0.38);

    group.add(post, birdBody, wingL, wingR, beak);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSoftTexture("rgba(255,245,200,0.8)", "rgba(255,245,200,0)"),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(5.0, 5.0, 1);
    halo.position.y = 1.9;
    group.add(halo);

    group.userData = {
      kind: "npc",
      name: "宋府信鴿",
      avatar: "🕊️",
      lines: [
        "嚶嚶～吳大人！宋元思老爺在桐廬等你的信都快等睡著了！你是不是在江上「從流飄蕩」摸魚啊？",
        "好鳥相鳴，嚶嚶成韻……看在江水這麼縹碧的份上，我就晚半個時辰回去交差吧～"
      ],
      bonusScore: 25,
      triggerRadius: 13.5,
      visited: false,
      position: new THREE.Vector3(x, 0, z),
    };

    encounters.push(group);
    animators.push((t) => {
      wingL.rotation.z = Math.sin(t * 8.5) * 0.45;
      wingR.rotation.z = -Math.sin(t * 8.5) * 0.45;
      birdBody.rotation.y = Math.sin(t * 1.5) * 0.3;
    });
  }

  // 3. 經綸世務者 (窺谷忘反)
  {
    const z = TERRAIN_START_Z + 335;
    const x = model.riverPathX(z) - model.halfRiver * 0.44;
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 漂浮大酒葫蘆
    const gourdMat = new THREE.MeshStandardMaterial({ color: 0xb55a2a, roughness: 0.7 });
    const g1 = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), gourdMat);
    g1.position.set(0, 0.25, 0);
    const g2 = new THREE.Mesh(new THREE.SphereGeometry(0.36, 8, 8), gourdMat);
    g2.position.set(0, 0.75, 0);
    group.add(g1, g2);

    // 歪戴的官帽
    const hatMat = new THREE.MeshStandardMaterial({ color: 0x1f232b, roughness: 0.8 });
    const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.35, 8), hatMat);
    hat.position.set(0.4, 0.45, 0.3);
    hat.rotation.z = 0.4;
    group.add(hat);

    // 漂浮竹簡
    const scrollMat = new THREE.MeshStandardMaterial({ color: 0xd9c28b, roughness: 0.9 });
    const scroll = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.08, 0.35), scrollMat);
    scroll.position.set(-0.6, 0.05, 0.4);
    scroll.rotation.y = 0.5;
    group.add(scroll);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSoftTexture("rgba(255,200,160,0.8)", "rgba(255,200,160,0)"),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(5.5, 5.5, 1);
    halo.position.y = 0.6;
    group.add(halo);

    group.userData = {
      kind: "npc",
      name: "經綸世務者",
      avatar: "📜",
      lines: [
        "呼～天天在衙門加班批公文！今日一見富春江奇山異水……本官決定「忘反」了！公文丟水裡，誰愛批誰批！",
        "少年郎，鳶飛戾天者望峰息心，經綸世務者窺谷忘反……功名利祿轉頭空，不如江上一壺酒！"
      ],
      bonusScore: 30,
      triggerRadius: 13.5,
      visited: false,
      position: new THREE.Vector3(x, 0, z),
    };

    encounters.push(group);
    animators.push((t) => {
      group.position.y = Math.sin(t * 2.0 + 2.5) * 0.06;
      group.rotation.z = Math.sin(t * 1.5) * 0.08;
      scroll.position.y = Math.sin(t * 2.4) * 0.03;
    });
  }

  // 4. 百叫靈猿 (猿則百叫無絕)
  {
    const z = TERRAIN_START_Z + 415;
    const x = model.riverPathX(z) + model.halfRiver * 0.52;
    const group = new THREE.Group();
    group.position.set(x, 0, z);

    // 突出崖石
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x484b45, roughness: 0.95 });
    const ledge = new THREE.Mesh(new THREE.DodecahedronGeometry(1.4, 1), rockMat);
    ledge.scale.set(1.4, 1.8, 1.2);
    ledge.position.set(0, 1.2, 0);
    group.add(ledge);

    // 靈猿身軀
    const monkeyMat = new THREE.MeshStandardMaterial({ color: 0x6e4727, roughness: 0.85 });
    const mBody = new THREE.Mesh(new THREE.SphereGeometry(0.38, 8, 8), monkeyMat);
    mBody.position.set(0, 2.7, 0);
    const mHead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 8), monkeyMat);
    mHead.position.set(0, 3.2, 0.1);

    // 尾巴
    const tailMat = new THREE.MeshStandardMaterial({ color: 0x5a391d });
    const tail = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.06, 6, 12, Math.PI * 1.2), tailMat);
    tail.position.set(0, 2.6, -0.3);
    tail.rotation.x = Math.PI / 2;

    group.add(ledge, mBody, mHead, tail);

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSoftTexture("rgba(255,225,180,0.8)", "rgba(255,225,180,0)"),
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
      })
    );
    halo.scale.set(5.5, 5.5, 1);
    halo.position.y = 2.8;
    group.add(halo);

    group.userData = {
      kind: "npc",
      name: "百叫靈猿",
      avatar: "🐒",
      lines: [
        "吱吱！聽說有人嫌我們「猿則百叫無絕」太吵？這叫大自然天然立體環繞音效，懂不懂文人雅興！",
        "千峰競秀，互相軒邈～少年郎好船技，快往前闖過金光水門吧！"
      ],
      bonusScore: 25,
      triggerRadius: 14.5,
      visited: false,
      position: new THREE.Vector3(x, 0, z),
    };

    encounters.push(group);
    animators.push((t) => {
      mHead.rotation.y = Math.sin(t * 3.0) * 0.35;
      mBody.position.y = 2.7 + Math.sin(t * 4.5) * 0.04;
    });
  }

  // 5. 漂流竹筒 (江中驚喜彩蛋)
  const flaskZOffsets = [170, 280, 370];
  const flaskTypes = [
    { type: "boost", title: "【猛浪若奔】順流急湍！獲得 4 秒破浪衝刺！", avatar: "🌊" },
    { type: "heal", title: "【清泉甘露】山泉泠泠作響，清潤怡神，回覆 1 顆心！", avatar: "💖" },
    { type: "bonus", title: "【富春奇石】拾得江底美石，直視無礙，+30 分！", avatar: "💎" },
  ];

  flaskZOffsets.forEach((zOff, i) => {
    const z = TERRAIN_START_Z + zOff;
    const x = model.riverPathX(z) + (i % 2 === 0 ? 3.5 : -3.5);
    const flask = new THREE.Group();
    flask.position.set(x, 0, z);

    // 竹筒管身
    const bambooMat = new THREE.MeshStandardMaterial({
      color: 0x4a7a50,
      roughness: 0.7,
      metalness: 0.1,
    });
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.9, 8), bambooMat);
    tube.rotation.x = Math.PI / 2;
    tube.rotation.z = 0.4;

    // 紅布塞
    const corkMat = new THREE.MeshStandardMaterial({ color: 0x9c2b1e });
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.18, 6), corkMat);
    cork.position.set(0, 0, 0.48);
    cork.rotation.x = Math.PI / 2;

    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeSoftTexture("rgba(255,225,120,0.9)", "rgba(255,225,120,0)"),
        transparent: true,
        opacity: 0.65,
        blending: THREE.AdditiveBlending,
      })
    );
    glow.scale.set(3.5, 3.5, 1);
    glow.position.y = 0.2;

    flask.add(tube, cork, glow);

    flask.userData = {
      kind: "flask",
      info: flaskTypes[i % flaskTypes.length],
      picked: false,
      position: new THREE.Vector3(x, 0, z),
      triggerRadius: 4.8,
      glow,
    };

    flasks.push(flask);
    animators.push((t) => {
      if (!flask.userData.picked) {
        flask.position.y = Math.sin(t * 2.8 + i) * 0.08;
        flask.rotation.y = t * 1.2;
        glow.material.opacity = 0.45 + Math.sin(t * 3.5) * 0.2;
      }
    });
  });

  // 6. 游魚躍水 (游魚細石，直視無礙)
  const fishGroup = new THREE.Group();
  const fishMat = new THREE.MeshStandardMaterial({
    color: 0xd8e8f0,
    metalness: 0.4,
    roughness: 0.4,
  });
  const fishGeo = new THREE.ConeGeometry(0.18, 0.8, 5);
  fishGeo.rotateX(Math.PI / 2);

  const fishes = [];
  const fishSpawns = [
    { z: TERRAIN_START_Z + 80, side: -1 },
    { z: TERRAIN_START_Z + 195, side: 1 },
    { z: TERRAIN_START_Z + 360, side: 0 },
  ];

  fishSpawns.forEach((sp, idx) => {
    const fMesh = new THREE.Mesh(fishGeo, fishMat);
    const fx = model.riverPathX(sp.z) + sp.side * 4.5;
    fMesh.position.set(fx, -0.4, sp.z);
    fishGroup.add(fMesh);
    fishes.push({
      mesh: fMesh,
      baseX: fx,
      baseZ: sp.z,
      phase: idx * 2.2,
    });
  });

  animators.push((t) => {
    fishes.forEach((f) => {
      const cycle = (t * 1.6 + f.phase) % 4.5;
      if (cycle < 1.2) {
        const p = cycle / 1.2;
        const jumpY = Math.sin(p * Math.PI) * 1.2 - 0.2;
        f.mesh.position.y = jumpY;
        f.mesh.rotation.x = (p - 0.5) * Math.PI * 1.4;
        f.mesh.rotation.z = Math.sin(t * 12) * 0.25;
        f.mesh.visible = true;
      } else {
        f.mesh.position.y = -1.5;
        f.mesh.visible = false;
      }
    });
  });

  return { encounters, flasks, fishGroup, animators };
}

function buildRiverHazards(model, level) {
  const rocks = [];
  const rapids = [];
  const group = new THREE.Group();
  const animators = [];

  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x3d3f3b,
    roughness: 0.96,
    metalness: 0.05,
    flatShading: true,
  });
  const mossMat = new THREE.MeshStandardMaterial({
    color: 0x47563c,
    roughness: 0.98,
    flatShading: true,
  });

  const foamTex = makeSoftTexture("rgba(255,255,255,0.85)", "rgba(220,240,250,0)");
  const foamMat = new THREE.MeshBasicMaterial({
    map: foamTex,
    transparent: true,
    opacity: 0.6,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const configs = {
    1: [
      { z: 90, side: -0.32, r: 2.2 },
      { z: 155, side: 0.35, r: 2.4 },
      { z: 230, side: -0.28, r: 2.5 },
      { z: 310, side: 0.32, r: 2.3 },
      { z: 395, side: -0.25, r: 2.6 },
    ],
    2: [
      { z: 75, side: -0.35, r: 2.5 },
      { z: 110, side: 0.32, r: 2.8 },
      { z: 145, side: -0.15, r: 2.2 },
      { z: 185, side: 0.38, r: 3.0 },
      { z: 220, side: -0.36, r: 2.6 },
      { z: 255, side: 0.18, r: 2.4 },
      { z: 290, side: -0.32, r: 2.7 },
      { z: 325, side: 0.35, r: 2.9 },
      { z: 360, side: -0.18, r: 2.3 },
      { z: 390, side: 0.28, r: 2.8 },
      { z: 415, side: -0.35, r: 2.5 },
      { z: 440, side: 0.22, r: 2.6 },
    ],
    3: [
      { z: 80, side: 0.34, r: 2.6 },
      { z: 115, side: -0.32, r: 2.8 },
      { z: 150, side: 0.22, r: 2.4 },
      { z: 190, side: -0.25, r: 2.9 },
      { z: 225, side: 0.36, r: 2.7 },
      { z: 260, side: -0.35, r: 2.5 },
      { z: 295, side: 0.15, r: 2.5 },
      { z: 330, side: -0.28, r: 3.1 },
      { z: 365, side: 0.32, r: 2.6 },
      { z: 400, side: -0.22, r: 2.7 },
      { z: 430, side: 0.35, r: 2.8 },
      { z: 450, side: -0.32, r: 2.5 },
    ],
    4: [
      { z: 85, side: -0.3, r: 2.5 },
      { z: 125, side: 0.32, r: 2.7 },
      { z: 170, side: -0.2, r: 2.4 },
      { z: 215, side: 0.35, r: 3.0 },
      { z: 260, side: -0.35, r: 2.8 },
      { z: 305, side: 0.25, r: 2.5 },
      { z: 350, side: -0.28, r: 2.9 },
      { z: 395, side: 0.32, r: 2.7 },
      { z: 435, side: -0.25, r: 2.6 },
    ],
  };

  const rockList = configs[level.id] || configs[1];

  rockList.forEach((cfg, idx) => {
    const z = TERRAIN_START_Z + cfg.z;
    const riverX = model.riverPathX(z);
    const x = riverX + cfg.side * (model.halfRiver * 0.82);
    const r = cfg.r;

    const rockGroup = new THREE.Group();
    rockGroup.position.set(x, 0, z);

    const geo1 = new THREE.DodecahedronGeometry(r, 1);
    const m1 = new THREE.Mesh(geo1, rockMat);
    m1.position.set(0, r * 0.45 - 0.2, 0);
    m1.scale.set(1.1, 0.75, 1.2);
    m1.rotation.set((idx % 3) * 0.4, (idx * 1.3) % Math.PI, (idx % 2) * 0.2);
    m1.castShadow = getQuality().shadows;
    m1.receiveShadow = getQuality().shadows;
    rockGroup.add(m1);

    const geo2 = new THREE.DodecahedronGeometry(r * 0.65, 0);
    const m2 = new THREE.Mesh(geo2, mossMat);
    m2.position.set(r * 0.4, r * 0.25 - 0.1, -r * 0.3);
    m2.scale.set(0.9, 0.6, 1.1);
    m2.rotation.set(0.3, idx, -0.2);
    m2.receiveShadow = getQuality().shadows;
    rockGroup.add(m2);

    const foamGeo = new THREE.RingGeometry(r * 0.7, r * 1.55, 16);
    foamGeo.rotateX(-Math.PI / 2);
    const foam = new THREE.Mesh(foamGeo, foamMat.clone());
    foam.position.y = 0.05;
    rockGroup.add(foam);

    const spray = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: foamTex,
        transparent: true,
        opacity: 0.25,
        blending: THREE.AdditiveBlending,
      })
    );
    spray.scale.set(r * 2.5, r * 1.4, 1);
    spray.position.set(0, 0.8, 0);
    rockGroup.add(spray);

    group.add(rockGroup);

    animators.push((time) => {
      foam.scale.setScalar(1.0 + Math.sin(time * 3.5 + idx * 1.2) * 0.08);
      foam.material.opacity = 0.45 + Math.sin(time * 2.8 + idx) * 0.15;
    });

    rocks.push({
      mesh: rockGroup,
      position: new THREE.Vector3(x, 0, z),
      radius: r * 0.95,
      z,
    });
  });

  const rapidConfigs = {
    1: [{ z: 200, length: 45, width: 9 }],
    2: [
      { z: 120, length: 55, width: 11 },
      { z: 235, length: 65, width: 10 },
      { z: 340, length: 60, width: 11 },
    ],
    3: [
      { z: 165, length: 55, width: 10 },
      { z: 310, length: 60, width: 11 },
    ],
    4: [
      { z: 190, length: 55, width: 11 },
      { z: 320, length: 60, width: 11 },
    ],
  };

  const rapidList = rapidConfigs[level.id] || rapidConfigs[1];
  rapidList.forEach((rc, rIdx) => {
    const startZ = TERRAIN_START_Z + rc.z;
    const endZ = startZ + rc.length;
    const midZ = (startZ + endZ) / 2;
    const centerX = model.riverPathX(midZ);

    const rapidGeo = new THREE.PlaneGeometry(rc.width, rc.length, 4, 16);
    rapidGeo.rotateX(-Math.PI / 2);

    const rapidMat = new THREE.MeshBasicMaterial({
      color: 0x66d9ee,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const rapidMesh = new THREE.Mesh(rapidGeo, rapidMat);
    rapidMesh.position.set(centerX, 0.08, midZ);
    group.add(rapidMesh);

    const chevronGeo = new THREE.ConeGeometry(0.8, 2.2, 3);
    chevronGeo.rotateX(-Math.PI / 2);
    const chevronMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });
    for (let c = 0; c < 5; c++) {
      const ch = new THREE.Mesh(chevronGeo, chevronMat);
      ch.position.set(0, 0.04, -rc.length / 2 + (c + 0.5) * (rc.length / 5));
      rapidMesh.add(ch);
    }

    rapids.push({
      mesh: rapidMesh,
      startZ,
      endZ,
      centerX,
      width: rc.width,
      speedBonus: 7.5,
      triggered: false,
    });

    animators.push((time) => {
      rapidMat.opacity = 0.18 + Math.sin(time * 4.5 + rIdx) * 0.08;
      rapidMesh.position.x = model.riverPathX(midZ);
    });
  });

  return { group, rocks, rapids, animators };
}

export function buildWorld(scene, level) {
  const theme = level.theme;
  const model = createTerrainModel(level);
  const root = new THREE.Group();

  const disposables = [];
  const track = (obj) => {
    obj.traverse((o) => {
      if (o.geometry) disposables.push(o.geometry);
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => {
          disposables.push(m);
          if (m.map) disposables.push(m.map);
        });
      }
    });
  };

  const fog = new THREE.FogExp2(theme.fog, theme.fogStrength * 0.0021);
  scene.fog = fog;

  const sky = buildSky(theme);
  root.add(sky);

  const terrain = new THREE.Mesh(
    buildTerrainGeometry(model, level),
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: getQuality().groundTexture ? makeGroundTexture() : null,
      roughness: 0.97,
      metalness: 0,
    })
  );
  terrain.receiveShadow = getQuality().shadows;
  root.add(terrain);

  const water = buildWater(theme);
  root.add(water.mesh);

  const peaks = buildDistantPeaks(theme, level.id * 7717);
  const forest = buildForest(model, theme, level.id * 3313);
  const rocks = buildRocks(model, theme, level.id * 5501);
  root.add(peaks, forest, rocks);

  const mist = buildMist(theme);
  root.add(mist);

  const birds = buildBirds(theme, getQuality().birds ? theme.birds : 0);
  root.add(birds.group);

  const stats = () => {
    let trees = 0;
    forest.traverse((o) => {
      if (o.isInstancedMesh) trees = Math.max(trees, o.count);
    });
    return {
      trees,
      rocks: rocks.count,
      peaks: peaks.children.length,
      mist: mist.children.length,
      birds: birds.group.children.length,
      steles: steles.length,
      drawables: root.children.length,
    };
  };

  const steles = [];
  level.steles.forEach((_, i) => {
    const side = i % 2 === 0 ? -1 : 1;
    const s = buildStele(model, level, i, side);
    steles.push(s);
    root.add(s);
  });

  const exit = buildExitGate(model, level);
  root.add(exit);

  const { encounters, flasks, fishGroup, animators } = buildRiverEncounters(model, level);
  encounters.forEach((e) => root.add(e));
  flasks.forEach((f) => root.add(f));
  root.add(fishGroup);

  const hazards = buildRiverHazards(model, level);
  root.add(hazards.group);
  hazards.animators.forEach((fn) => animators.push(fn));

  const hemi = new THREE.HemisphereLight(theme.sky[0], theme.groundDeep, 1.5);
  const sun = new THREE.DirectionalLight(theme.sun, 2.1);
  sun.position.set(90, 140, 70);
  sun.castShadow = getQuality().shadows;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 420;
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.bias = -0.0008;

  root.add(hemi, sun);

  scene.add(root);

  track(root);

  return {
    model,
    root,
    stats,
    steles,
    exit,
    encounters,
    flasks,
    rocks: hazards.rocks,
    rapids: hazards.rapids,
    light: sun,
    theme,
    spawn: new THREE.Vector3(model.riverPathX(TERRAIN_START_Z + 26), 0, TERRAIN_START_Z + 26),
    update(dt, time, focus) {
      water.material.uniforms.uTime.value = time;
      mist.userData.update(time);
      birds.update(dt, time);
      animators.forEach((fn) => fn(time));

      const fx = focus ? focus.x : 0;
      const fz = focus ? focus.z : 0;
      sun.position.set(fx + 70, 150, fz + 45);
      sun.target.position.set(fx, 0, fz);
      sun.target.updateMatrixWorld();

      for (const s of steles) {
        const u = s.userData;
        u.halo.material.opacity = u.solved ? 0.1 + Math.sin(time * 2.4) * 0.07 : 0.34 + Math.sin(time * 1.7) * 0.1;
        u.lamp.intensity = u.solved ? 0.5 : 2.2 + Math.sin(time * 1.7) * 0.6;
        u.faceMat.emissiveIntensity = u.solved ? 0.15 : 0.45 + Math.sin(time * 1.7) * 0.12;
        if (!u.solved) s.rotation.y = Math.sin(time * 0.6 + u.index) * 0.05;
      }

      const locked = exit.userData.locked !== false;
      exit.userData.veil.material.color.set(locked ? 0x9c2b1e : 0xffd9a0);
      exit.userData.glow.material.color.set(locked ? 0xff7a5a : 0xffd28a);
      exit.userData.veil.material.opacity =
        (locked ? 0.3 : 0.12) + Math.sin(time * 1.9) * (locked ? 0.12 : 0.07);
      exit.userData.glow.material.opacity =
        (locked ? 0.3 : 0.42) + Math.sin(time * 1.5) * (locked ? 0.1 : 0.16);
    },
    dispose() {
      scene.remove(root);
      for (const d of disposables) {
        if (d && typeof d.dispose === "function") d.dispose();
      }
      scene.fog = null;
    },
  };
}
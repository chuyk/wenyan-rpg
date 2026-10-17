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

  return { heightAt, slopeAt, pathX, pathBaseY, halfRiver };
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
  const x = model.pathX(z) + side * 4.4;
  const y = model.heightAt(x, z);

  const group = new THREE.Group();
  group.position.set(x, y, z);

  const baseGeo = new THREE.BoxGeometry(4.6, 0.8, 3);
  const base = new THREE.Mesh(baseGeo, new THREE.MeshStandardMaterial({ color: 0x6b655c, roughness: 1 }));
  base.position.y = 0.35;
  base.receiveShadow = getQuality().shadows;

  const slabGeo = new THREE.BoxGeometry(3.6, 6.4, 0.7);
  const slab = new THREE.Mesh(slabGeo, new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 0.95 }));
  slab.position.y = 4;
  slab.castShadow = getQuality().shadows;

  const faceMat = new THREE.MeshStandardMaterial({
    map: makeCharacterTexture(stele.char),
    roughness: 0.85,
    emissive: 0x2a2419,
    emissiveIntensity: 0.5,
  });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.3, 4.2), faceMat);
  face.position.set(0, 4, side > 0 ? 0.37 : -0.37);
  face.rotation.y = side > 0 ? 0 : Math.PI;

  const halo = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSoftTexture("rgba(255,226,160,1)", "rgba(255,226,160,0)"),
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  halo.scale.set(9, 9, 1);
  halo.position.y = 4.4;

  const lamp = new THREE.PointLight(0xffca7a, 2.6, 22, 2);
  lamp.position.set(0, 4.4, side > 0 ? 1.6 : -1.6);

  group.add(base, slab, face, halo, lamp);

  group.userData = {
    kind: "stele",
    index,
    char: stele.char,
    position: new THREE.Vector3(x, y, z),
    triggerRadius: 6.5,
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
  const x = model.pathX(z);
  const y = model.heightAt(x, z);

  const group = new THREE.Group();
  group.position.set(x, y, z);

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x8a2b1e, roughness: 0.7 });
  const beamMat = new THREE.MeshStandardMaterial({ color: 0x6f2318, roughness: 0.8 });

  const left = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 11, 10), pillarMat);
  left.position.set(-5, 5.5, 0);
  left.castShadow = getQuality().shadows;

  const right = left.clone();
  right.position.x = 5;

  const beam = new THREE.Mesh(new THREE.BoxGeometry(13.5, 0.9, 1.2), beamMat);
  beam.position.y = 11.2;
  beam.castShadow = getQuality().shadows;

  const top = new THREE.Mesh(new THREE.BoxGeometry(15, 0.5, 1.6), beamMat);
  top.position.y = 12.3;
  top.rotation.z = 0.03;

  const veilMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    opacity: 0.16,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const veil = new THREE.Mesh(new THREE.PlaneGeometry(10, 11), veilMat);
  veil.position.set(0, 5.5, 0);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeSoftTexture("rgba(255,210,150,1)", "rgba(255,210,150,0)"),
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  glow.scale.set(26, 20, 1);
  glow.position.y = 5.5;

  group.add(left, right, beam, top, veil, glow);

  group.userData = {
    kind: "exit",
    position: new THREE.Vector3(x, y, z),
    triggerRadius: 5.5,
    veil,
    glow,
  };

  return group;
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
    light: sun,
    theme,
    spawn: new THREE.Vector3(model.pathX(TERRAIN_START_Z + 26), 0, TERRAIN_START_Z + 26),
    update(dt, time, focus) {
      water.material.uniforms.uTime.value = time;
      mist.userData.update(time);
      birds.update(dt, time);

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
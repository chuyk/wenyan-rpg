import * as THREE from "three";
import { TERRAIN_START_Z, TERRAIN_END_Z } from "./world.js";

// Eye height while seated / standing aboard the river boat
const EYE_HEIGHT = 1.25;
const CRUISE_SPEED = 11.5;
const BOOST_SPEED = 19.5;
const REVERSE_SPEED = 6.0;
const LATERAL_SPEED = 9.0;
const DRIFT_SPEED = 1.6; // Natural gentle downstream drift: "從流飄蕩"
const MOUSE_SENSITIVITY = 0.0022;
const TOUCH_SENSITIVITY = 0.0038;

function buildBoatMesh() {
  const boat = new THREE.Group();

  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x5a3d28,
    roughness: 0.82,
    metalness: 0.05,
  });
  const darkWoodMat = new THREE.MeshStandardMaterial({
    color: 0x3d2719,
    roughness: 0.9,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x423524,
    roughness: 0.94,
    side: THREE.DoubleSide,
  });

  // Boat floor / bottom plank
  const floorGeo = new THREE.BoxGeometry(1.5, 0.12, 3.8);
  const floor = new THREE.Mesh(floorGeo, darkWoodMat);
  floor.position.set(0, -0.65, 0.4);
  boat.add(floor);

  // Pointed prow (船首)
  const prowGeo = new THREE.ConeGeometry(0.82, 1.8, 5);
  prowGeo.rotateX(-Math.PI / 2);
  const prow = new THREE.Mesh(prowGeo, woodMat);
  prow.position.set(0, -0.42, 2.8);
  prow.scale.set(0.9, 0.45, 1.2);
  boat.add(prow);

  // Left & right gunwales (船舷)
  const gunwaleLeftGeo = new THREE.BoxGeometry(0.12, 0.55, 3.8);
  const gunwaleLeft = new THREE.Mesh(gunwaleLeftGeo, woodMat);
  gunwaleLeft.position.set(-0.82, -0.38, 0.4);
  gunwaleLeft.rotation.z = -0.14;
  boat.add(gunwaleLeft);

  const gunwaleRight = gunwaleLeft.clone();
  gunwaleRight.position.x = 0.82;
  gunwaleRight.rotation.z = 0.14;
  boat.add(gunwaleRight);

  // Crossbeams (橫梁)
  const barGeo = new THREE.BoxGeometry(1.68, 0.08, 0.16);
  const bar1 = new THREE.Mesh(barGeo, darkWoodMat);
  bar1.position.set(0, -0.2, 2.0);
  const bar2 = bar1.clone();
  bar2.position.set(0, -0.2, -0.8);
  boat.add(bar1, bar2);

  // Wupeng canopy (烏篷頂) - arched bamboo canopy overhead & behind
  const archGeo = new THREE.CylinderGeometry(0.98, 0.98, 2.1, 16, 1, true, 0, Math.PI);
  archGeo.rotateZ(Math.PI / 2);
  archGeo.rotateY(Math.PI / 2);
  const awning = new THREE.Mesh(archGeo, canopyMat);
  awning.position.set(0, 0.12, -0.65);
  awning.scale.set(1.02, 0.88, 1.0);
  boat.add(awning);

  // Lantern at prow (船首暖光風燈)
  const lanternMat = new THREE.MeshStandardMaterial({
    color: 0xffe299,
    emissive: 0xffaa33,
    emissiveIntensity: 0.85,
  });
  const lanternGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.32, 6);
  const lantern = new THREE.Mesh(lanternGeo, lanternMat);
  lantern.position.set(0, -0.12, 3.2);

  const lanternLight = new THREE.PointLight(0xffb855, 1.1, 10, 2);
  lanternLight.position.set(0, -0.05, 3.3);
  boat.add(lantern, lanternLight);

  return boat;
}

export function createPlayer(camera, domElement, world, input) {
  const feet = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();

  let yaw = Math.PI; // Facing downstream along positive Z (towards steles)
  let pitch = 0;
  let waveTime = 0;
  let locked = false;
  let enabled = false;
  let screenShakeTime = 0;
  let screenShakeIntensity = 0;
  let rapidBoostTimer = 0;
  let rapidBoostSpeed = 0;

  // Initialize at river spawn point
  feet.copy(world.spawn);
  velocity.set(0, 0, 0);

  // Initialize camera and boat initial orientation immediately
  camera.rotation.order = "YXZ";
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;
  camera.position.set(feet.x, feet.y + EYE_HEIGHT, feet.z);

  // Create boat in the scene
  const boat = buildBoatMesh();
  boat.position.set(feet.x, feet.y, feet.z);
  boat.rotation.order = "YXZ";
  boat.rotation.y = yaw + Math.PI;
  if (camera.parent) {
    camera.parent.add(boat);
  } else {
    world.root.add(boat);
  }

  let isMouseDown = false;
  let lastMouseX = 0;
  let lastMouseY = 0;

  function onMouseDown(event) {
    if (event.button === 0) {
      isMouseDown = true;
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
    }
  }

  function onMouseUp(event) {
    if (event.button === 0) {
      isMouseDown = false;
    }
  }

  function onMouseMove(event) {
    if (!enabled) return;
    if (locked) {
      yaw -= event.movementX * MOUSE_SENSITIVITY;
      pitch -= event.movementY * MOUSE_SENSITIVITY;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    } else if (isMouseDown && (event.buttons & 1)) {
      const dx = event.movementX !== undefined && Math.abs(event.movementX) < 120
        ? event.movementX
        : (event.clientX - lastMouseX);
      const dy = event.movementY !== undefined && Math.abs(event.movementY) < 120
        ? event.movementY
        : (event.clientY - lastMouseY);
      lastMouseX = event.clientX;
      lastMouseY = event.clientY;
      yaw -= dx * MOUSE_SENSITIVITY;
      pitch -= dy * MOUSE_SENSITIVITY;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    }
  }

  function onKeyDown(event) {
    if (event.code === "Space" && enabled) event.preventDefault();
    input.pressed.add(event.code);
  }

  function onKeyUp(event) {
    input.pressed.delete(event.code);
  }

  function onLockChange() {
    locked = document.pointerLockElement === domElement;
    if (!locked) {
      input.pressed.clear();
      isMouseDown = false;
    }
    input.onLockChange(locked);
  }

  domElement.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  window.addEventListener("mousemove", onMouseMove);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("pointerlockchange", onLockChange);

  return {
    get locked() {
      return locked;
    },
    get position() {
      return feet;
    },
    get yaw() {
      return yaw;
    },
    get boat() {
      return boat;
    },
    setEnabled(value) {
      enabled = value;
      if (!value) input.pressed.clear();
    },
    requestLock() {
      try {
        const request = domElement.requestPointerLock();
        if (request && typeof request.catch === "function") request.catch(() => {});
      } catch (e) {
        void e;
      }
    },
    exitLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    applyTouchLook(dx, dy) {
      if (!enabled) return;
      yaw -= dx * TOUCH_SENSITIVITY;
      pitch -= dy * TOUCH_SENSITIVITY;
      pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, pitch));
    },
    applyShake(duration = 0.35, intensity = 0.4) {
      screenShakeTime = duration;
      screenShakeIntensity = intensity;
    },
    pushVelocity(vx, vz) {
      velocity.x += vx;
      velocity.z += vz;
    },
    setRapidBoost(timer = 2.0, bonusSpeed = 7.5) {
      rapidBoostTimer = Math.max(rapidBoostTimer, timer);
      rapidBoostSpeed = bonusSpeed;
    },
    teleport(x, z) {
      const riverCenter = world.model.riverPathX ? world.model.riverPathX(z) : 0;
      const maxOffset = world.model.halfRiver * 0.72;
      const cx = THREE.MathUtils.clamp(x, riverCenter - maxOffset, riverCenter + maxOffset);
      const cz = THREE.MathUtils.clamp(z, TERRAIN_START_Z + 4, TERRAIN_END_Z);
      feet.set(cx, 0, cz);
      velocity.set(0, 0, 0);
    },
    look(newYaw, newPitch) {
      yaw = newYaw;
      pitch = newPitch;
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
    },
    update(dt) {
      if (!enabled) return;

      waveTime += dt;

      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(-forward.z, 0, forward.x);

      wish.set(0, 0, 0);

      // Keyboard controls
      if (input.pressed.has("KeyW") || input.pressed.has("ArrowUp")) wish.add(forward);
      if (input.pressed.has("KeyS") || input.pressed.has("ArrowDown")) wish.sub(forward);
      if (input.pressed.has("KeyD") || input.pressed.has("ArrowRight")) wish.add(right);
      if (input.pressed.has("KeyA") || input.pressed.has("ArrowLeft")) wish.sub(right);

      // Touch joystick controls (virtual joystick on tablets)
      if (input.touchMove && (input.touchMove.x !== 0 || input.touchMove.y !== 0)) {
        wish.addScaledVector(forward, input.touchMove.y);
        wish.addScaledVector(right, input.touchMove.x);
      }

      if (input.tempBoostTimer > 0) {
        input.tempBoostTimer -= dt;
      }
      if (rapidBoostTimer > 0) {
        rapidBoostTimer -= dt;
      }

      // Boosting / Sprinting ("奮楫疾行")
      const boosting =
        input.pressed.has("ShiftLeft") ||
        input.pressed.has("ShiftRight") ||
        input.pressed.has("Space") ||
        Boolean(input.touchBoost) ||
        (input.tempBoostTimer > 0);

      const rapidBonus = rapidBoostTimer > 0 ? rapidBoostSpeed : 0;
      const targetSpeed = (boosting ? BOOST_SPEED : CRUISE_SPEED) + rapidBonus;

      // Natural gentle river current push downstream (+Z)
      const currentPush = new THREE.Vector3(0, 0, DRIFT_SPEED + (rapidBoostTimer > 0 ? 3.0 : 0));

      let wishSpeed = targetSpeed;
      if (wish.lengthSq() > 1) wish.normalize();
      if (wish.lengthSq() === 0) {
        // Drifting downstream smoothly
        wish.copy(currentPush).multiplyScalar(1 / (DRIFT_SPEED + (rapidBoostTimer > 0 ? 3.0 : 0)));
        wishSpeed = DRIFT_SPEED + (rapidBoostTimer > 0 ? 4.5 : 0);
      }

      // Smooth boat water glide inertia
      const blend = 1 - Math.pow(0.0012, dt);
      velocity.x = THREE.MathUtils.lerp(velocity.x, wish.x * wishSpeed, blend);
      velocity.z = THREE.MathUtils.lerp(velocity.z, wish.z * wishSpeed, blend);

      // Move the boat
      feet.x += velocity.x * dt;
      feet.z = THREE.MathUtils.clamp(feet.z + velocity.z * dt, TERRAIN_START_Z + 4, TERRAIN_END_Z);

      // River banks soft boundary clamp - keep boat in the water
      const riverCenter = world.model.riverPathX ? world.model.riverPathX(feet.z) : 0;
      const maxOffset = world.model.halfRiver * 0.72;
      feet.x = THREE.MathUtils.clamp(feet.x, riverCenter - maxOffset, riverCenter + maxOffset);

      // Floating wave dynamics on the water surface (y = 0)
      const waveBob = Math.sin(waveTime * 2.2) * 0.06 + Math.sin(waveTime * 1.3 + feet.z * 0.05) * 0.03;
      const waveRoll = Math.sin(waveTime * 1.7) * 0.018;
      const speedNorm = velocity.length() / targetSpeed;
      const speedPitch = THREE.MathUtils.clamp((wish.dot(forward) * speedNorm) * 0.035, -0.02, 0.04);

      feet.y = waveBob;

      // Update 3D boat mesh position and orientation
      boat.position.set(feet.x, feet.y, feet.z);
      boat.rotation.order = "YXZ";
      boat.rotation.y = yaw + Math.PI; // Boat faces same direction as player
      boat.rotation.x = speedPitch + Math.cos(waveTime * 1.5) * 0.015;
      boat.rotation.z = waveRoll;

      // Camera shake computation
      let shakeX = 0;
      let shakeY = 0;
      if (screenShakeTime > 0) {
        screenShakeTime -= dt;
        const s = screenShakeIntensity * Math.min(1, screenShakeTime / 0.35);
        shakeX = (Math.random() - 0.5) * s;
        shakeY = (Math.random() - 0.5) * s;
      }

      // Camera positioned inside the boat
      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      camera.rotation.z = waveRoll * 0.6;
      camera.position.set(feet.x + shakeX, feet.y + EYE_HEIGHT + shakeY, feet.z);

      const moving = velocity.lengthSq() > 0.5;
      input.report(true, boosting && moving);
    },
    dispose() {
      if (boat.parent) boat.parent.remove(boat);
      domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      window.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerlockchange", onLockChange);
    },
  };
}
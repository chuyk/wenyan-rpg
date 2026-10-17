import * as THREE from "three";
import { TERRAIN_W, TERRAIN_START_Z, TERRAIN_END_Z } from "./world.js";

const EYE_HEIGHT = 1.72;
const WALK_SPEED = 9.5;
const SPRINT_SPEED = 15.5;
const WATER_SPEED = 5.4;
const WADE_DEPTH = 0.55;
const JUMP_VELOCITY = 8.4;
const GRAVITY = 22;
const MOUSE_SENSITIVITY = 0.0022;
const BOUNDS_X = TERRAIN_W / 2 - 10;

export function createPlayer(camera, domElement, world, input) {
  const feet = new THREE.Vector3();
  const velocity = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();

  let yaw = Math.PI;
  let pitch = 0;
  let bobTime = 0;
  let locked = false;
  let enabled = false;

  function groundLevelAt(x, z) {
    return Math.max(world.model.heightAt(x, z), 0);
  }

  feet.set(world.spawn.x, groundLevelAt(world.spawn.x, world.spawn.z), world.spawn.z);
  velocity.set(0, 0, 0);

  function onMouseMove(event) {
    if (!locked || !enabled) return;
    yaw -= event.movementX * MOUSE_SENSITIVITY;
    pitch -= event.movementY * MOUSE_SENSITIVITY;
    pitch = Math.max(-Math.PI / 2 + 0.02, Math.min(Math.PI / 2 - 0.02, pitch));
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
    if (!locked) input.pressed.clear();
    input.onLockChange(locked);
  }

  document.addEventListener("mousemove", onMouseMove);
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
    teleport(x, z) {
      const cx = THREE.MathUtils.clamp(x, -BOUNDS_X, BOUNDS_X);
      const cz = THREE.MathUtils.clamp(z, TERRAIN_START_Z + 4, TERRAIN_END_Z);
      feet.set(cx, groundLevelAt(cx, cz), cz);
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

      const groundY = groundLevelAt(feet.x, feet.z);
      const inWater = feet.y < -WADE_DEPTH;

      forward.set(-Math.sin(yaw), 0, -Math.cos(yaw));
      right.set(-forward.z, 0, forward.x);

      wish.set(0, 0, 0);
      if (input.pressed.has("KeyW") || input.pressed.has("ArrowUp")) wish.add(forward);
      if (input.pressed.has("KeyS") || input.pressed.has("ArrowDown")) wish.sub(forward);
      if (input.pressed.has("KeyD") || input.pressed.has("ArrowRight")) wish.add(right);
      if (input.pressed.has("KeyA") || input.pressed.has("ArrowLeft")) wish.sub(right);

      const sprinting =
        !inWater && (input.pressed.has("ShiftLeft") || input.pressed.has("ShiftRight"));
      const speed = inWater ? WATER_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;

      const blend = wish.lengthSq() > 0 ? 1 - Math.pow(0.0009, dt) : 1 - Math.pow(0.0002, dt);
      velocity.x = THREE.MathUtils.lerp(velocity.x, wish.x * speed, blend);
      velocity.z = THREE.MathUtils.lerp(velocity.z, wish.z * speed, blend);

      const grounded = feet.y <= groundY + 0.02 && velocity.y <= 0;

      if (input.pressed.has("Space") && grounded) {
        velocity.y = JUMP_VELOCITY;
      }

      velocity.y -= GRAVITY * dt;
      feet.x = THREE.MathUtils.clamp(feet.x + velocity.x * dt, -BOUNDS_X, BOUNDS_X);
      feet.z = THREE.MathUtils.clamp(feet.z + velocity.z * dt, TERRAIN_START_Z + 4, TERRAIN_END_Z);
      feet.y += velocity.y * dt;

      const floor = groundLevelAt(feet.x, feet.z);
      if (feet.y <= floor) {
        feet.y = floor;
        velocity.y = 0;
      }

      const moving = wish.lengthSq() > 0 && feet.y <= floor + 0.02;
      bobTime += dt * (sprinting ? 14 : 9.5);

      const bob = moving ? Math.sin(bobTime) * 0.055 : 0;
      const sway = moving ? Math.cos(bobTime * 0.5) * 0.028 : 0;

      camera.rotation.order = "YXZ";
      camera.rotation.y = yaw;
      camera.rotation.x = pitch;
      camera.rotation.z = sway;
      camera.position.set(feet.x, feet.y + EYE_HEIGHT + bob, feet.z);

      input.report(inWater, sprinting && moving);
    },
  };
}
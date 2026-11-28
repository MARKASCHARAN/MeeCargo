import {
  Component,
  Suspense,
  createContext,
  lazy,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Euler,
  FrontSide,
  Group,
  LoopRepeat,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NumberKeyframeTrack,
  Object3D,
  OrthographicCamera,
  Quaternion,
  QuaternionKeyframeTrack,
  SkinnedMesh,
  Texture,
  Vector3,
  VectorKeyframeTrack,
  type AnimationAction,
  type Material,
} from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { SURFACE_DATA, type SurfaceData } from './orbit-surface';

// --- Motion & Simulation Types ---

interface MotionState {
  planetAngle: number;
  planetVelocity: number;
  dragTarget: number;
  characterTarget: number;
  characterAngle: number;
  characterVelocity: number;
  phase: number;
  activity: number;
  direction: number;
  time: number;
  dragging: boolean;
  lastInteraction: number;
  pitchAngle: number;
  pitchVelocity: number;
  pitchTarget: number;
  cameraHeading?: number;
  heading?: number;
}

interface GlobeMotionState {
  delta: Quaternion;
  orientation: Quaternion;
  angular: Vector3;
  route: number;
}

interface SurfaceMotionState {
  current: Vector3;
  target: Vector3;
  velocity: Vector3;
  error: Vector3;
  worldNormal: Vector3;
  worldVelocity: Vector3;
  inverse: Quaternion;
  initialized: boolean;
}

interface PlanetAssetData {
  scene: Group;
  surface: SurfaceData;
}

interface CourierAssetData {
  scene: Group;
  mixer: AnimationMixer;
  idle: AnimationAction;
  run: AnimationAction;
  duration: number;
  bag: BagSuspension;
  greeting: CourierGreeting;
}

interface ExtendedNavigator extends Navigator {
  deviceMemory?: number;
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
}

// --- Public Component Types ---

export interface OrbitStoryItem {
  id: string;
  label: string;
  eyebrow?: string;
  title: string;
  paragraphs: string[];
  ctaLabel?: string;
  onCtaClick?: () => void;
}

export interface OrbitHeroProps {
  theme?: 'auto' | 'light' | 'dark';
  assetBaseUrl?: string;
  brandName?: string;
  brandSub?: string;
  onBrandClick?: () => void;
  eyebrow?: string;
  headlineLines?: [string, string, string];
  descriptionLines?: [string, string];
  primaryCtaLabel?: string;
  onPrimaryCtaClick?: () => void;
  secondaryCta?: ReactNode;
  headerCtaLabel?: string;
  onHeaderCtaClick?: () => void;
  headerStatus?: ReactNode;
  navActionLabel?: string;
  stories?: OrbitStoryItem[];
  extraNavItems?: Array<{ id: string; label: string; onClick: () => void }>;
  captionIdle?: [string, string];
  captionDragging?: [string, string];
  captionPaused?: [string, string];
  footerLeftLines?: [string, string];
  footerRightLines?: [string, string, string];
  children?: ReactNode;
}

// --- Math & Motion Helpers ---

const GAIT_DISTANCE = 0.44;
const MODEL_SCALE = 0.76 / 1.7;
const UP_VECTOR = new Vector3(0, 1, 0);

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

const damp = (value: number, target: number, lambda: number, dt: number): number =>
  value + (target - value) * (1 - Math.exp(-lambda * dt));

const smoothstep = (value: number, min: number, max: number): number => {
  const t = clamp((value - min) / (max - min), 0, 1);
  return t * t * (3 - 2 * t);
};

const createMotion = (): MotionState => ({
  planetAngle: 0,
  planetVelocity: 0,
  dragTarget: 0,
  characterTarget: 0,
  characterAngle: 0,
  characterVelocity: 0,
  phase: 0,
  activity: 0,
  direction: 1,
  time: 0,
  dragging: false,
  lastInteraction: 0,
  pitchAngle: 0,
  pitchVelocity: 0,
  pitchTarget: 0,
});

function stepPlanet(
  m: MotionState,
  dt: number,
  auto: boolean,
  reduced: boolean,
  autoRoll = -0.032
) {
  m.time += dt;
  if (!auto) {
    m.dragging = false;
    m.planetVelocity = m.pitchVelocity = 0;
    m.dragTarget = m.planetAngle;
    m.pitchTarget = m.pitchAngle;
    return;
  }
  if (m.dragging) {
    const acceleration =
      90 * (m.dragTarget - m.planetAngle) - 18 * m.planetVelocity;
    m.planetVelocity += acceleration * dt;
  } else {
    const desired =
      auto && !reduced && m.time - m.lastInteraction > 3.5 ? autoRoll : 0;
    m.planetVelocity = damp(m.planetVelocity, desired, reduced ? 12 : 5, dt);
  }
  m.planetVelocity = clamp(m.planetVelocity, -1.15, 1.15);
  m.planetAngle += m.planetVelocity * dt;
}

function stepRunner(
  m: MotionState,
  dt: number,
  screenTopLocal: number,
  reduced: boolean
) {
  m.characterTarget += Math.atan2(
    Math.sin(screenTopLocal - m.characterTarget),
    Math.cos(screenTopLocal - m.characterTarget)
  );
  const error = m.characterTarget - m.characterAngle;
  const stiffness = reduced ? 110 : 48;
  const damping = reduced ? 21 : 11;
  m.characterVelocity += (stiffness * error - damping * m.characterVelocity) * dt;
  m.characterAngle += m.characterVelocity * dt;
  const speed = Math.abs(m.characterVelocity);
  m.activity = damp(m.activity, smoothstep(speed, 4e-3, 0.022), 9, dt);
  if (speed > 0.025) m.direction = Math.sign(m.characterVelocity);
  m.phase += ((speed * 2.25) / GAIT_DISTANCE) * Math.PI * 2 * dt;
}

function createGlobeMotion(): GlobeMotionState {
  return {
    delta: new Quaternion(),
    orientation: new Quaternion().setFromEuler(new Euler(0.1, 0.5, 0)),
    angular: new Vector3(),
    route: 0,
  };
}

function setMotionHeadings(
  m: MotionState,
  cameraHeading: number,
  heading?: number
) {
  m.cameraHeading = cameraHeading;
  if (heading !== undefined) m.heading = heading;
}

function stepGlobeMotion(
  globe: GlobeMotionState,
  m: MotionState,
  dt: number,
  auto: boolean,
  reduced: boolean
) {
  const roaming =
    auto && !reduced && !m.dragging && m.time - m.lastInteraction > 3.5;
  if (roaming) globe.route += 0.24 * dt;
  stepPlanet(m, dt, auto, reduced, -0.24 * Math.cos(globe.route));
  if (!auto) {
    globe.angular.set(0, 0, 0);
    return;
  }
  if (m.dragging) {
    m.pitchVelocity +=
      (70 * (m.pitchTarget - m.pitchAngle) - 17 * m.pitchVelocity) * dt;
  } else {
    m.pitchVelocity = MathUtils.damp(
      m.pitchVelocity,
      roaming ? 0.24 * Math.sin(globe.route) : 0,
      6,
      dt
    );
  }
  m.pitchVelocity = MathUtils.clamp(m.pitchVelocity, -0.55, 0.55);
  m.pitchAngle += m.pitchVelocity * dt;
  globe.angular.set(m.pitchVelocity, m.planetVelocity * 0.45, -m.planetVelocity);
  const speed = globe.angular.length();
  if (speed > 1e-8) {
    globe.delta.setFromAxisAngle(
      globe.angular.multiplyScalar(1 / speed),
      speed * dt
    );
    globe.orientation.premultiply(globe.delta).normalize();
  }
}

function createSurfaceMotion(): SurfaceMotionState {
  return {
    current: new Vector3(0, 1, 0),
    target: new Vector3(0, 1, 0),
    velocity: new Vector3(),
    error: new Vector3(),
    worldNormal: new Vector3(),
    worldVelocity: new Vector3(),
    inverse: new Quaternion(),
    initialized: false,
  };
}

function stepSurface(
  s: SurfaceMotionState,
  m: MotionState,
  rotation: Quaternion,
  screenUp: Vector3,
  dt: number,
  reduced: boolean,
  paused = false
) {
  s.inverse.copy(rotation).invert();
  s.target.copy(screenUp).applyQuaternion(s.inverse).normalize();
  if (!s.initialized) {
    s.current.copy(s.target);
    s.initialized = true;
  }
  if (paused) {
    s.velocity.set(0, 0, 0);
    s.worldVelocity.set(0, 0, 0);
    s.worldNormal.copy(s.current).applyQuaternion(rotation);
    m.characterVelocity = 0;
    m.activity = MathUtils.damp(m.activity, 0, 10, dt);
    return;
  }
  const cosine = MathUtils.clamp(s.current.dot(s.target), -1, 1);
  const angle = Math.acos(cosine);
  s.error.copy(s.target).addScaledVector(s.current, -cosine);
  if (s.error.lengthSq() > 1e-12) s.error.normalize().multiplyScalar(angle);
  const stiffness = reduced ? 110 : 48;
  const damping = reduced ? 21 : 11;
  s.velocity
    .addScaledVector(s.error, stiffness * dt)
    .multiplyScalar(Math.exp(-damping * dt));
  s.velocity.addScaledVector(s.current, -s.velocity.dot(s.current));
  s.current.addScaledVector(s.velocity, dt).normalize();
  s.velocity.addScaledVector(s.current, -s.velocity.dot(s.current));
  s.worldNormal.copy(s.current).applyQuaternion(rotation);
  s.worldVelocity.copy(s.velocity).applyQuaternion(rotation);
  const speed = s.velocity.length();
  m.characterTarget = Math.atan2(s.target.x, s.target.y);
  m.characterAngle = Math.atan2(s.current.x, s.current.y);
  if (Math.abs(s.worldVelocity.x) > 0.012) {
    m.direction = Math.sign(s.worldVelocity.x);
  }
  m.characterVelocity = speed * m.direction;
  m.activity = MathUtils.damp(
    m.activity,
    MathUtils.smoothstep(speed, 4e-3, 0.022),
    9,
    dt
  );
  m.phase += ((speed * 2.25) / GAIT_DISTANCE) * Math.PI * 2 * dt;
}

// --- Scene & Asset Disposal ---

const AssetBaseContext = createContext('');

function disposeScene(scene: Object3D) {
  const textures = new Set<Texture>();
  const materials = new Set<Material>();
  const geometries = new Set<Mesh['geometry']>();
  const skeletons = new Set<SkinnedMesh['skeleton']>();
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    geometries.add(node.geometry);
    if (node instanceof SkinnedMesh) skeletons.add(node.skeleton);
    const mats = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of mats) {
      materials.add(material);
      for (const value of Object.values(material as unknown as Record<string, unknown>)) {
        if (value instanceof Texture) textures.add(value);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  skeletons.forEach((skeleton) => skeleton.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => {
    texture.dispose();
    if (
      typeof ImageBitmap !== 'undefined' &&
      texture.image instanceof ImageBitmap
    ) {
      texture.image.close();
    }
  });
}

function usePlanetAsset(onReady?: (ready: boolean) => void): PlanetAssetData | null {
  const base = useContext(AssetBaseContext);
  const [asset, setAsset] = useState<PlanetAssetData | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const draco = new DRACOLoader()
      .setDecoderPath('/draco/')
      .setWorkerLimit(2);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    let disposed = false;
    let scene: Group | undefined;

    const fetchChecked = async (path: string) => {
      const response = await fetch(path, { signal: abort.signal });
      if (!response.ok) {
        throw new Error(`Planet asset could not load (${response.status})`);
      }
      return response;
    };

    onReady?.(false);
    fetchChecked(`${base}models/whimsical-world.glb`)
      .then((r) => r.arrayBuffer())
      .then(async (buffer) => {
        if (disposed) return;
        const gltf = await loader.parseAsync(buffer, `${base}models/`);
        scene = gltf.scene;
        if (disposed) {
          disposeScene(scene);
          return;
        }
        scene.traverse((node) => {
          node.updateMatrix();
          node.matrixAutoUpdate = false;
          if (!(node instanceof Mesh)) return;
          const materials = Array.isArray(node.material)
            ? node.material
            : [node.material];
          for (const mat of materials) {
            if (mat instanceof MeshStandardMaterial) {
              mat.side = FrontSide;
              mat.metalness = 0;
              mat.roughness = 0.86;
              mat.normalScale.setScalar(0.65);
              if (mat.map) mat.map.anisotropy = 4;
            }
          }
        });
        setAsset({ scene, surface: SURFACE_DATA });
        onReady?.(true);
      })
      .catch((reason: unknown) => {
        if (!disposed && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
      })
      .finally(() => {
        if (!disposed) draco.dispose();
      });

    return () => {
      disposed = true;
      abort.abort();
      draco.dispose();
      if (scene) disposeScene(scene);
    };
  }, [onReady, base]);

  if (error) throw error;
  return asset;
}

function surfaceRadius(
  surface: SurfaceData,
  x: number,
  y: number,
  z: number
): number {
  const u =
    (((Math.atan2(x, z) / (2 * Math.PI)) % 1 + 1) % 1) * surface.width;
  const v =
    (Math.acos(Math.max(-1, Math.min(1, y))) / Math.PI) * (surface.height - 1);
  const x0 = Math.floor(u);
  const x1 = (x0 + 1) % surface.width;
  const y0 = Math.floor(v);
  const y1 = Math.min(y0 + 1, surface.height - 1);
  const tx = u - x0;
  const ty = v - y0;
  const a =
    surface.radii[y0 * surface.width + x0] * (1 - tx) +
    surface.radii[y0 * surface.width + x1] * tx;
  const b =
    surface.radii[y1 * surface.width + x0] * (1 - tx) +
    surface.radii[y1 * surface.width + x1] * tx;
  return a * (1 - ty) + b * ty;
}

// --- Animation & Rigging ---

function makeSeamlessRun(source: AnimationClip): AnimationClip {
  const reference = source.tracks.reduce((best, track) =>
    track.times.length > best.times.length ? track : best
  );
  const start = reference.times[0];
  const last = reference.times[reference.times.length - 1];
  const intervals = Array.from(reference.times)
    .slice(1)
    .map((time, i) => time - reference.times[i])
    .sort((a, b) => a - b);
  const step = intervals.length
    ? intervals[Math.floor(intervals.length / 2)]
    : 1 / 24;
  const period = Math.max(step, last - start + step);
  const frames = Math.max(40, Math.ceil(period * 120));
  const quaternion = new Quaternion();

  const tracks = source.tracks.map((track) => {
    const count = track.times.length;
    const size = track.getValueSize();
    const knots = Array.from(track.times, (time) => time - start);
    const samples = Array.from(track.values);
    const isRotation = track.name.endsWith('.quaternion');
    const isMorph = track.name.endsWith('.morphTargetInfluences');
    if (isRotation) {
      for (let i = 1; i < count; i++) {
        let dot = 0;
        for (let c = 0; c < 4; c++) {
          dot += samples[(i - 1) * 4 + c] * samples[i * 4 + c];
        }
        if (dot < 0) {
          for (let c = 0; c < 4; c++) samples[i * 4 + c] *= -1;
        }
      }
    }
    const times: number[] = [];
    const values: number[] = [];
    for (let frame = 0; frame <= frames; frame++) {
      const time = frame === frames ? 0 : (frame / frames) * period;
      times.push((frame / frames) * period);
      let index = 0;
      while (index < count - 1 && knots[index + 1] <= time) index++;
      const previous = (index - 1 + count) % count;
      const next = (index + 1) % count;
      const after = (index + 2) % count;
      const t1 = knots[index];
      const t2 = next === 0 ? period + knots[0] : knots[next];
      const t0 = previous > index ? knots[previous] - period : knots[previous];
      const t3 = after <= next ? knots[after] + period : knots[after];
      const afterTime = t3 <= t2 ? t3 + period : t3;
      const length = Math.max(t2 - t1, 1e-6);
      const u = Math.max(0, Math.min(1, (time - t1) / length));
      for (let c = 0; c < size; c++) {
        const p0 = samples[previous * size + c];
        const p1 = samples[index * size + c];
        const p2 = samples[next * size + c];
        const p3 = samples[after * size + c];
        const a =
          count < 3 ? 0 : ((p2 - p0) / Math.max(t2 - t0, 1e-6)) * length;
        const b =
          count < 3 ? 0 : ((p3 - p1) / Math.max(afterTime - t1, 1e-6)) * length;
        values.push(
          count === 1
            ? p1
            : isMorph
              ? p1 + (p2 - p1) * u
              : (2 * u ** 3 - 3 * u ** 2 + 1) * p1 +
                (u ** 3 - 2 * u ** 2 + u) * a +
                (-2 * u ** 3 + 3 * u ** 2) * p2 +
                (u ** 3 - u ** 2) * b
        );
      }
      if (isRotation) {
        quaternion.fromArray(values, values.length - 4).normalize();
        quaternion.toArray(values, values.length - 4);
      }
    }
    const result = track.clone();
    result.times = new Float32Array(times);
    result.values = new Float32Array(values);
    return result;
  });

  return new AnimationClip('Courier_Run_Seamless', period, tracks);
}

class BagSuspension {
  scene: Object3D;
  bone: Bone;
  restOrientation = new Quaternion();
  animatedOrientation = new Quaternion();
  animatedPosition = new Vector3();
  localAnchor = new Vector3();
  gravityTilt = new Quaternion();
  pelvisYaw = new Quaternion();
  inverseRest = new Quaternion();
  xAxis = new Vector3(1, 0, 0);
  hangingOrientation = new Quaternion();
  sceneOrientation = new Quaternion();
  parentOrientation = new Quaternion();
  swing = new Quaternion();
  angles = new Euler();
  inverseScene = new Matrix4();
  anchor = new Vector3();
  previousAnchor = new Vector3();
  velocity = new Vector3();
  previousVelocity = new Vector3();
  acceleration = new Vector3();
  initialized = false;
  applied = false;
  pitch = 0;
  roll = 8e-3;
  pitchVelocity = 0;
  rollVelocity = 0;

  constructor(scene: Object3D) {
    this.scene = scene;
    const bone = scene.getObjectByName('CourierBag');
    if (!(bone instanceof Bone)) {
      throw new Error('Courier bag attachment is missing.');
    }
    this.bone = bone;
    scene.updateWorldMatrix(true, true);
    scene.getWorldQuaternion(this.sceneOrientation);
    bone.getWorldQuaternion(this.restOrientation);
    this.restOrientation.premultiply(this.sceneOrientation.invert());
    this.inverseRest.copy(this.restOrientation).invert();
  }

  restore() {
    if (!this.applied) return;
    this.bone.position.copy(this.animatedPosition);
    this.bone.quaternion.copy(this.animatedOrientation);
    this.applied = false;
  }

  update(
    dt: number,
    activity: number,
    _phase: number,
    turnRate: number,
    reduced: boolean,
    bodyLean = 0
  ) {
    if (dt <= 0 || !this.bone.parent) return;
    this.animatedPosition.copy(this.bone.position);
    this.animatedOrientation.copy(this.bone.quaternion);
    this.inverseScene.copy(this.scene.matrixWorld).invert();
    this.bone.getWorldPosition(this.anchor).applyMatrix4(this.inverseScene);
    if (!this.initialized) {
      this.previousAnchor.copy(this.anchor);
      this.initialized = true;
    }
    this.velocity.copy(this.anchor).sub(this.previousAnchor).divideScalar(dt);
    this.acceleration
      .copy(this.velocity)
      .sub(this.previousVelocity)
      .divideScalar(dt);
    this.previousVelocity.lerp(this.velocity, 1 - Math.exp(-14 * dt));
    this.previousAnchor.copy(this.anchor);
    const gravity = Math.max(4, 9.81 + this.acceleration.y);
    const targetPitch = reduced
      ? 0
      : MathUtils.clamp(Math.atan2(this.acceleration.z, gravity), -0.1, 0.1);
    const targetRoll = reduced
      ? 0
      : MathUtils.clamp(
          Math.atan2(-this.acceleration.x, gravity) + Math.abs(turnRate) * 1e-3,
          -0.012,
          0.045
        );
    const steps = Math.ceil(dt / (1 / 120));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.pitchVelocity +=
        ((targetPitch - this.pitch) * 72 - this.pitchVelocity * 11) * h;
      this.rollVelocity +=
        ((targetRoll - this.roll) * 64 - this.rollVelocity * 10) * h;
      this.pitch = MathUtils.clamp(
        this.pitch + this.pitchVelocity * h,
        -0.12,
        0.12
      );
      this.roll = MathUtils.clamp(
        this.roll + this.rollVelocity * h,
        -0.012,
        0.05
      );
    }
    this.scene.getWorldQuaternion(this.sceneOrientation);
    this.bone
      .getWorldQuaternion(this.pelvisYaw)
      .premultiply(this.parentOrientation.copy(this.sceneOrientation).invert())
      .multiply(this.inverseRest);
    this.pelvisYaw.set(0, this.pelvisYaw.y, 0, this.pelvisYaw.w).normalize();
    this.bone.parent.getWorldQuaternion(this.parentOrientation).invert();
    this.swing.setFromEuler(this.angles.set(this.pitch, 0, this.roll));
    this.gravityTilt.setFromAxisAngle(this.xAxis, -bodyLean);
    this.hangingOrientation
      .copy(this.parentOrientation)
      .multiply(this.sceneOrientation)
      .multiply(this.gravityTilt)
      .multiply(this.pelvisYaw)
      .multiply(this.swing)
      .multiply(this.restOrientation);
    this.bone.quaternion
      .copy(this.animatedOrientation)
      .slerp(this.hangingOrientation, 1 - activity * 0.3);
    this.localAnchor
      .copy(this.anchor)
      .addScaledVector(this.xAxis, -9e-3 * (1 - activity * 0.5));
    this.localAnchor.y -= 0.027;
    this.localAnchor.applyMatrix4(this.scene.matrixWorld);
    this.bone.parent.worldToLocal(this.localAnchor);
    this.bone.position.copy(this.localAnchor);
    this.bone.updateWorldMatrix(false, true);
    this.applied = true;
  }
}

interface GreetingJoint {
  bone: Bone;
  rest: Quaternion;
  direction: Vector3;
  palm: Vector3;
  animated: Quaternion;
}

class CourierGreeting {
  scene: Object3D;
  joints: GreetingJoint[];
  sceneRotation = new Quaternion();
  inverseParent = new Quaternion();
  aim = new Quaternion();
  twist = new Quaternion();
  target = new Quaternion();
  direction = new Vector3();
  palm = new Vector3();
  wantedPalm = new Vector3();
  cross = new Vector3();
  restBendNormal = new Vector3();
  bendNormal = new Vector3();
  upperDirection = new Vector3(-0.55, -0.65, 0.52).normalize();
  forearmDirection = new Vector3();
  phase = 0;
  applied = false;
  weight = 0;

  constructor(scene: Object3D) {
    this.scene = scene;
    scene.updateWorldMatrix(true, true);
    const inverseScene = scene.getWorldQuaternion(new Quaternion()).invert();
    this.joints = ['RightArm', 'RightForeArm', 'RightHand'].map((name) => {
      const bone = scene.getObjectByName(name);
      if (!(bone instanceof Bone)) {
        throw new Error(`Greeting joint ${name} is missing.`);
      }
      const rest = bone
        .getWorldQuaternion(new Quaternion())
        .premultiply(inverseScene);
      const direction = UP_VECTOR.clone().applyQuaternion(rest).normalize();
      const palm = new Vector3(1, 0, 0)
        .addScaledVector(direction, -direction.x)
        .normalize();
      return {
        bone,
        rest,
        direction,
        palm,
        animated: bone.quaternion.clone(),
      };
    });
    this.restBendNormal
      .crossVectors(this.joints[0].direction, this.joints[1].direction)
      .normalize();
  }

  restore() {
    if (!this.applied) return;
    for (const joint of this.joints) {
      joint.bone.quaternion.copy(joint.animated);
    }
    this.applied = false;
  }

  step(dt: number, ready: boolean, reduced: boolean) {
    this.weight = MathUtils.damp(this.weight, ready ? 1 : 0, ready ? 4 : 9, dt);
    if (this.weight < 1e-4) {
      this.weight = 0;
      this.phase = 0;
    }
    if (ready && this.weight > 0.85 && !reduced) {
      this.phase += dt * Math.PI * 2 * 0.9;
    }
  }

  apply(reduced: boolean) {
    if (this.weight === 0) return;
    this.scene.getWorldQuaternion(this.sceneRotation);
    const wave =
      Math.sin(this.phase) *
      (reduced ? 0 : 0.12) *
      MathUtils.smoothstep(this.weight, 0.85, 0.99);
    this.forearmDirection
      .set(-0.08 + wave * 0.35, 0.94, 0.33)
      .normalize();
    this.bendNormal
      .crossVectors(this.upperDirection, this.forearmDirection)
      .normalize();
    this.joints.forEach((joint, index) => {
      joint.animated.copy(joint.bone.quaternion);
      if (index === 0) this.direction.copy(this.upperDirection);
      else if (index === 1) this.direction.copy(this.forearmDirection);
      else this.direction.set(-0.06 + wave, 0.97, 0.22);
      this.direction.normalize();
      this.aim.setFromUnitVectors(joint.direction, this.direction);
      this.target.copy(this.aim).multiply(joint.rest);
      this.palm
        .copy(this.restBendNormal)
        .addScaledVector(
          joint.direction,
          -this.restBendNormal.dot(joint.direction)
        )
        .normalize()
        .applyQuaternion(this.aim);
      this.wantedPalm
        .copy(this.bendNormal)
        .addScaledVector(
          joint.direction,
          -this.bendNormal.dot(joint.direction)
        )
        .normalize();
      const angle = Math.atan2(
        this.direction.dot(this.cross.crossVectors(this.palm, this.wantedPalm)),
        this.palm.dot(this.wantedPalm)
      );
      this.twist.setFromAxisAngle(this.direction, angle);
      this.target.premultiply(this.twist);
      if (joint.bone.parent) {
        joint.bone.parent.getWorldQuaternion(this.inverseParent).invert();
        this.target.premultiply(this.sceneRotation).premultiply(this.inverseParent);
      }
      joint.bone.quaternion.slerp(this.target, this.weight);
      joint.bone.updateWorldMatrix(false, true);
    });
    this.applied = true;
  }
}

function optimizeRigidBag(scene: Object3D) {
  scene.updateWorldMatrix(true, true);
  const candidates: SkinnedMesh[] = [];
  scene.traverse((node) => {
    if (node instanceof SkinnedMesh && node.name.startsWith('Delivery_Bag')) {
      candidates.push(node);
    }
  });
  for (const mesh of candidates) {
    if (Object.keys(mesh.geometry.morphAttributes).length) continue;
    const weights = mesh.geometry.getAttribute('skinWeight');
    const indices = mesh.geometry.getAttribute('skinIndex');
    if (!weights || !indices) continue;
    let joint = -1;
    let rigid = true;
    for (let vertex = 0; vertex < weights.count && rigid; vertex++) {
      let total = 0;
      for (let channel = 0; channel < 4; channel++) {
        const weight = weights.getComponent(vertex, channel);
        if (weight < 1e-6) continue;
        const index = indices.getComponent(vertex, channel);
        if (joint < 0) joint = index;
        if (index !== joint) {
          rigid = false;
          break;
        }
        total += weight;
      }
      if (Math.abs(total - 1) > 1e-4) rigid = false;
    }
    if (!rigid || joint < 0) continue;
    const bone = mesh.skeleton.bones[joint];
    const bind = new Matrix4().multiplyMatrices(
      mesh.skeleton.boneInverses[joint],
      mesh.bindMatrix
    );
    const geometry = mesh.geometry.clone().applyMatrix4(bind);
    geometry.deleteAttribute('skinIndex');
    geometry.deleteAttribute('skinWeight');
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const bag = new Mesh(geometry, mesh.material);
    bag.name = mesh.name;
    bag.castShadow = mesh.castShadow;
    bag.receiveShadow = mesh.receiveShadow;
    bag.renderOrder = mesh.renderOrder;
    bag.matrixAutoUpdate = false;
    mesh.removeFromParent();
    bone.add(bag);
    let shared = false;
    scene.traverse((node) => {
      if (node instanceof Mesh && node.geometry === mesh.geometry) shared = true;
    });
    if (!shared) mesh.geometry.dispose();
  }
}

function makeIdle(scene: Object3D): AnimationClip {
  const tracks: Array<
    NumberKeyframeTrack | QuaternionKeyframeTrack | VectorKeyframeTrack
  > = [];
  const breath = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), 9e-3);
  scene.traverse((node) => {
    if (node instanceof Mesh && node.morphTargetInfluences?.length) {
      const zeros = new Array<number>(node.morphTargetInfluences.length).fill(0);
      tracks.push(
        new NumberKeyframeTrack(
          `${node.name}.morphTargetInfluences`,
          [0, 3],
          [...zeros, ...zeros]
        )
      );
    }
    if (!(node instanceof Bone)) return;
    const q = node.quaternion.clone();
    const middle = q.clone();
    if (node.name === 'Spine02' || node.name === 'neck') middle.multiply(breath);
    tracks.push(
      new QuaternionKeyframeTrack(
        `${node.name}.quaternion`,
        [0, 1.5, 3],
        [...q.toArray(), ...middle.toArray(), ...q.toArray()]
      )
    );
    const p = node.position.clone();
    const inhale = p.clone();
    if (node.name === 'Hips') inhale.y += 4e-3;
    tracks.push(
      new VectorKeyframeTrack(
        `${node.name}.position`,
        [0, 1.5, 3],
        [...p.toArray(), ...inhale.toArray(), ...p.toArray()]
      )
    );
    tracks.push(
      new VectorKeyframeTrack(
        `${node.name}.scale`,
        [0, 3],
        [...node.scale.toArray(), ...node.scale.toArray()]
      )
    );
  });
  return new AnimationClip('Courier_Idle', 3, tracks);
}

// --- 3D Scene Components ---

function Courier({
  motion,
  paused,
  reduced,
  onReady,
}: {
  motion: React.RefObject<MotionState>;
  paused: boolean;
  reduced: boolean;
  onReady?: (ready: boolean) => void;
}) {
  const base = useContext(AssetBaseContext);
  const facing = useRef<Group>(null);
  const lean = useRef<Group>(null);
  const greetingTurn = useRef(false);
  const turnVelocity = useRef(0);
  const assetRef = useRef<CourierAssetData | null>(null);
  const [sceneObject, setSceneObject] = useState<Group | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const draco = new DRACOLoader()
      .setDecoderPath('/draco/')
      .setWorkerLimit(1);
    const loader = new GLTFLoader().setDRACOLoader(draco);
    let cancelled = false;
    let owned: CourierAssetData | undefined;

    onReady?.(false);
    fetch(`${base}models/courier.glb`, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Courier could not load (${response.status})`);
        }
        const data = await response.arrayBuffer();
        if (cancelled) return;
        const gltf = await loader.parseAsync(data, `${base}models/`);
        if (cancelled) {
          disposeScene(gltf.scene);
          return;
        }
        optimizeRigidBag(gltf.scene);
        gltf.scene.traverse((node) => {
          if (!(node instanceof Mesh)) return;
          node.morphTargetInfluences?.fill(0);
          if (node instanceof SkinnedMesh) node.frustumCulled = false;
          const mats = Array.isArray(node.material)
            ? node.material
            : [node.material];
          for (const material of mats) {
            if (material instanceof MeshStandardMaterial) {
              material.metalness = 0;
              material.roughness = 0.9;
              material.roughnessMap = null;
              material.normalScale.setScalar(0.25);
              if (material.map) material.map.anisotropy = 8;
            }
          }
        });
        const clips = gltf.animations.filter((a) => a.duration > 0.3);
        if (!clips.length) {
          disposeScene(gltf.scene);
          throw new Error('The courier run animation is missing.');
        }
        const clip = new AnimationClip(
          'Courier_Run_Source',
          -1,
          clips.flatMap((a) => a.tracks)
        );
        const mixer = new AnimationMixer(gltf.scene);
        const bag = new BagSuspension(gltf.scene);
        const greeting = new CourierGreeting(gltf.scene);
        const idle = mixer.clipAction(makeIdle(gltf.scene)).play();
        const seamless = makeSeamlessRun(clip);
        const run = mixer
          .clipAction(seamless)
          .setLoop(LoopRepeat, Infinity)
          .play();
        run.zeroSlopeAtStart = false;
        run.zeroSlopeAtEnd = false;
        run.setEffectiveTimeScale(0);
        run.setEffectiveWeight(0);
        mixer.update(0);
        owned = {
          scene: gltf.scene,
          mixer,
          idle,
          run,
          duration: seamless.duration,
          bag,
          greeting,
        };
        assetRef.current = owned;
        setSceneObject(gltf.scene);
        onReady?.(true);
      })
      .catch((reason: unknown) => {
        if (!cancelled && !(reason instanceof DOMException && reason.name === 'AbortError')) {
          setError(reason instanceof Error ? reason : new Error(String(reason)));
        }
      })
      .finally(() => {
        if (!cancelled) draco.dispose();
      });

    return () => {
      cancelled = true;
      abort.abort();
      draco.dispose();
      assetRef.current = null;
      setSceneObject(null);
      if (owned) {
        owned.mixer.stopAllAction();
        owned.mixer.uncacheRoot(owned.scene);
        disposeScene(owned.scene);
      }
    };
  }, [onReady, base]);

  useFrame((_, delta) => {
    const asset = assetRef.current;
    if (!asset || !facing.current || !lean.current) return;
    const dt = Math.min(delta, 0.05);
    const m = motion.current;
    if (!paused) greetingTurn.current = false;
    else if (m.activity < 0.06) greetingTurn.current = true;
    const desired = paused
      ? greetingTurn.current
        ? (m.cameraHeading ?? 0)
        : facing.current.rotation.y
      : (m.heading ?? 0) + Math.PI / 2;
    const turn = Math.atan2(
      Math.sin(desired - facing.current.rotation.y),
      Math.cos(desired - facing.current.rotation.y)
    );
    if (paused) {
      const acceleration = MathUtils.clamp(
        18 * turn - 8.5 * turnVelocity.current,
        -5.5,
        5.5
      );
      turnVelocity.current = MathUtils.clamp(
        turnVelocity.current + acceleration * dt,
        -2.2,
        2.2
      );
      if (Math.abs(turn) < 3e-3 && Math.abs(turnVelocity.current) < 0.025) {
        turnVelocity.current = 0;
      }
      facing.current.rotation.y += turnVelocity.current * dt;
    } else {
      const rotation = turn * (1 - Math.exp(-12 * dt));
      facing.current.rotation.y += rotation;
      turnVelocity.current = dt > 0 ? rotation / dt : 0;
    }
    const turning =
      paused && greetingTurn.current && !reduced
        ? MathUtils.smoothstep(Math.abs(turnVelocity.current), 0.08, 1.2)
        : 0;
    asset.greeting.step(
      dt,
      paused &&
        greetingTurn.current &&
        Math.abs(turn) < 0.055 &&
        Math.abs(turnVelocity.current) < 0.13,
      reduced
    );
    lean.current.rotation.x = MathUtils.damp(
      lean.current.rotation.x,
      Math.min(Math.abs(m.characterVelocity) * 0.065, 0.09) *
        (reduced ? 0.35 : 1),
      9,
      dt
    );
    const activity =
      Math.max(m.activity, turning * 0.3) * (1 - asset.greeting.weight);
    asset.run.setEffectiveWeight(activity);
    asset.idle.setEffectiveWeight(1 - activity);
    asset.idle.paused = reduced;
    const playback = Math.max(
      ((Math.abs(m.characterVelocity) * 2.25) / GAIT_DISTANCE) * asset.duration,
      turning * 0.72
    );
    asset.run.setEffectiveTimeScale(
      MathUtils.damp(asset.run.timeScale, playback, 10, dt)
    );
    asset.greeting.restore();
    asset.bag.restore();
    asset.mixer.update(dt);
    asset.scene.updateWorldMatrix(true, true);
    asset.greeting.apply(reduced);
    asset.bag.update(
      dt,
      activity,
      m.phase,
      turnVelocity.current,
      reduced,
      lean.current.rotation.x
    );
  });

  if (error) throw error;
  return (
    <group ref={facing} rotation={[0, Math.PI / 2, 0]}>
      <group ref={lean}>
        <group scale={MODEL_SCALE}>
          {sceneObject && <primitive object={sceneObject} dispose={null} />}
        </group>
      </group>
    </group>
  );
}

function chooseRenderQuality(): 'low' | 'high' {
  if (typeof navigator === 'undefined') return 'low';
  const device = navigator as ExtendedNavigator;
  const preference = new URLSearchParams(location.search).get('quality');
  if (preference === 'high') return 'high';
  if (preference === 'low') return 'low';
  const mobile =
    matchMedia('(pointer: coarse)').matches &&
    Math.min(screen.width, screen.height) < 900;
  const limited =
    (device.hardwareConcurrency || 4) <= 4 ||
    (device.deviceMemory !== undefined && device.deviceMemory <= 4);
  const slowConnection =
    Boolean(device.connection?.saveData) ||
    /(^|-)2g$/.test(device.connection?.effectiveType || '');
  return mobile || limited || slowConnection ? 'low' : 'high';
}

const renderQuality = chooseRenderQuality();

function AdaptiveResolution({ active }: { active: boolean }) {
  const setDpr = useThree((state) => state.setDpr);
  const maximum = Math.min(
    (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1,
    renderQuality === 'low' ? 1.25 : 2
  );
  const minimum = Math.min(maximum, renderQuality === 'low' ? 1 : 1.25);
  const sample = useRef({
    warmup: 3,
    time: 0,
    frames: 0,
    goodWindows: 0,
    dpr: maximum,
  });

  useEffect(() => {
    sample.current.warmup = 3;
    sample.current.time = 0;
    sample.current.frames = 0;
    sample.current.goodWindows = 0;
  }, [active]);

  useFrame((state, delta) => {
    const s = sample.current;
    if (!active || delta <= 0) return;
    if (s.warmup > 0) {
      s.warmup -= Math.min(delta, 0.1);
      return;
    }
    if (delta > 0.12) {
      s.time = 0;
      s.frames = 0;
      return;
    }
    s.time += delta;
    s.frames++;
    if (s.time < 2) return;
    const frameTime = s.time / s.frames;
    s.dpr = state.viewport.dpr;
    let next = s.dpr;
    if (frameTime > 1 / 48) {
      next = Math.max(minimum, s.dpr - 0.25);
      s.goodWindows = 0;
    } else if (frameTime < 1 / 57) {
      if (++s.goodWindows >= 4) {
        next = Math.min(maximum, s.dpr + 0.25);
        s.goodWindows = 0;
      }
    } else {
      s.goodWindows = 0;
    }
    s.time = 0;
    s.frames = 0;
    if (next !== s.dpr) {
      s.dpr = next;
      setDpr(next);
      s.warmup = 1;
    }
  });

  return null;
}

interface SceneProps {
  motion: React.RefObject<MotionState>;
  active: boolean;
  auto: boolean;
  reduced: boolean;
  prototype: boolean;
  onReady?: (ready: boolean) => void;
}

function PrototypeWorld({
  motion,
  auto,
  reduced,
}: Omit<SceneProps, 'active' | 'prototype' | 'onReady'>) {
  const lastZoom = useRef(0);
  const planet = useRef<Group>(null);
  const runner = useRef<Group>(null);
  const left = useRef<Group>(null);
  const right = useRef<Group>(null);
  const inverse = useRef(new Quaternion());
  const localTop = useRef(new Vector3());

  useFrame(({ camera: cam, size }, delta) => {
    if (cam instanceof OrthographicCamera) {
      const nextZoom = Math.min(size.width / 5.6, size.height / 6.05);
      if (Math.abs(nextZoom - lastZoom.current) > 1e-3) {
        lastZoom.current = nextZoom;
        cam.zoom = nextZoom;
        cam.updateProjectionMatrix();
      }
    }
    if (
      !planet.current ||
      !runner.current ||
      !left.current ||
      !right.current
    ) {
      return;
    }
    const m = motion.current;
    const elapsed = Math.min(delta, 0.05);
    const count = Math.ceil(elapsed / (1 / 120));
    for (let i = 0; i < count; i++) {
      const dt = elapsed / count;
      stepPlanet(m, dt, auto, reduced);
      planet.current.rotation.z = -m.planetAngle;
      inverse.current.copy(planet.current.quaternion).invert();
      localTop.current
        .copy(UP_VECTOR)
        .applyQuaternion(cam.quaternion)
        .applyQuaternion(inverse.current);
      stepRunner(
        m,
        dt,
        Math.atan2(localTop.current.x, localTop.current.y),
        reduced
      );
    }
    const angle = m.planetAngle + m.characterAngle;
    runner.current.position.set(
      Math.sin(angle) * 2.25,
      Math.cos(angle) * 2.25,
      0
    );
    runner.current.rotation.z = -angle;
    left.current.rotation.z = Math.sin(m.phase) * 0.7 * m.activity;
    right.current.rotation.z = -Math.sin(m.phase) * 0.7 * m.activity;
  });

  return (
    <>
      <group ref={planet}>
        <mesh>
          <sphereGeometry args={[2.25, 48, 32]} />
          <meshStandardMaterial color="#779eac" roughness={0.7} />
        </mesh>
        {[0, 1, 2, 3].map((i) => (
          <mesh
            key={i}
            position={[Math.sin(i * 1.5) * 1.8, Math.cos(i * 1.5) * 1.8, 1.38]}
          >
            <sphereGeometry args={[0.1, 8, 8]} />
            <meshStandardMaterial color="#e4edcf" />
          </mesh>
        ))}
      </group>
      <group ref={runner}>
        <mesh position={[0, 0.31, 0]}>
          <boxGeometry args={[0.19, 0.26, 0.16]} />
          <meshStandardMaterial color="#e7763d" />
        </mesh>
        <mesh position={[0, 0.52, 0]}>
          <sphereGeometry args={[0.13, 16, 12]} />
          <meshStandardMaterial color="#fff5df" />
        </mesh>
        <group ref={left} position={[-0.06, 0.21, 0]}>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[0.055, 0.2, 0.06]} />
            <meshStandardMaterial color="#343f42" />
          </mesh>
        </group>
        <group ref={right} position={[0.06, 0.21, 0]}>
          <mesh position={[0, -0.1, 0]}>
            <boxGeometry args={[0.055, 0.2, 0.06]} />
            <meshStandardMaterial color="#343f42" />
          </mesh>
        </group>
      </group>
    </>
  );
}

function ResponsiveCamera() {
  const lastZoom = useRef(0);
  useFrame(({ camera, size }) => {
    if (camera instanceof OrthographicCamera) {
      const nextZoom = size.width / (size.width < 700 ? 5.65 : 5.25);
      if (Math.abs(nextZoom - lastZoom.current) > 1e-3) {
        lastZoom.current = nextZoom;
        camera.zoom = nextZoom;
        camera.updateProjectionMatrix();
      }
    }
  });
  return null;
}

function PlanetWorld({ motion, auto, reduced, onReady }: Omit<SceneProps, 'active' | 'prototype'>) {
  const planet = useRef<Group>(null);
  const runner = useRef<Group>(null);
  const asset = usePlanetAsset();
  const [courierReady, setCourierReady] = useState(false);

  useEffect(() => {
    onReady?.(Boolean(asset) && courierReady);
  }, [asset, courierReady, onReady]);

  const radius = useRef(2.2);
  const surface = useRef(createSurfaceMotion());
  const globe = useMemo(() => createGlobeMotion(), []);
  const frame = useMemo(
    () => ({
      screenUp: new Vector3(),
      localVelocity: new Vector3(),
      cameraFront: new Vector3(),
      inverseRunner: new Quaternion(),
    }),
    []
  );
  const size = useThree((state) => state.size);
  const small = size.width < 700;
  const zoom = size.width / (small ? 5.65 : 5.25);
  const centerY = (size.height / zoom) * (small ? 0.08 : 0.19) - 2.17;

  useFrame(({ camera }, delta) => {
    if (!asset || !courierReady || !planet.current || !runner.current) return;
    const m = motion.current;
    const elapsed = Math.min(delta, 0.05);
    const count = Math.ceil(elapsed / (1 / 120));
    frame.screenUp.copy(UP_VECTOR).applyQuaternion(camera.quaternion);
    for (let i = 0; i < count; i++) {
      const dt = elapsed / count;
      stepGlobeMotion(globe, m, dt, auto, reduced);
      stepSurface(
        surface.current,
        m,
        globe.orientation,
        frame.screenUp,
        dt,
        reduced,
        !auto
      );
    }
    planet.current.quaternion.copy(globe.orientation);
    const s = surface.current;
    const r =
      surfaceRadius(asset.surface, s.current.x, s.current.y, s.current.z) *
      2.25;
    radius.current = MathUtils.damp(radius.current, r + 8e-3, 25, elapsed);
    runner.current.position.copy(s.worldNormal).multiplyScalar(radius.current);
    runner.current.quaternion.setFromUnitVectors(UP_VECTOR, s.worldNormal);
    frame.inverseRunner.copy(runner.current.quaternion).invert();
    frame.cameraFront
      .set(0, 0, 1)
      .applyQuaternion(camera.quaternion)
      .applyQuaternion(frame.inverseRunner);
    const cameraHeading = Math.atan2(frame.cameraFront.x, frame.cameraFront.z);
    let heading: number | undefined;
    if (s.velocity.lengthSq() > 1e-4) {
      frame.localVelocity.copy(s.worldVelocity).applyQuaternion(frame.inverseRunner);
      heading = Math.atan2(-frame.localVelocity.z, frame.localVelocity.x);
    }
    setMotionHeadings(m, cameraHeading, heading);
  }, -1);

  return (
    <group position={[0, centerY, 0]}>
      <group ref={planet} scale={2.25}>
        {asset && <primitive object={asset.scene} dispose={null} />}
      </group>
      <group ref={runner} visible={Boolean(asset) && courierReady}>
        <Courier
          motion={motion}
          paused={!auto}
          reduced={reduced}
          onReady={setCourierReady}
        />
      </group>
    </group>
  );
}

function PlanetScene(props: SceneProps) {
  const lowPower = renderQuality === 'low';
  const { prototype, onReady } = props;

  useEffect(() => {
    if (prototype) onReady?.(true);
  }, [prototype, onReady]);

  if (prototype) {
    return (
      <Canvas
        orthographic
        camera={{ position: [0, 0, 9], zoom: 100, near: 0.1, far: 30 }}
        dpr={[1, 1.5]}
        frameloop={props.active ? 'always' : 'never'}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={1.4} />
        <directionalLight position={[-3, 5, 6]} intensity={3} />
        <PrototypeWorld
          motion={props.motion}
          auto={props.auto}
          reduced={props.reduced}
        />
      </Canvas>
    );
  }

  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 9], zoom: 150, near: 0.1, far: 30 }}
      dpr={lowPower ? [1, 1.25] : [1, 2]}
      frameloop={props.active ? 'always' : 'never'}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: lowPower ? 'low-power' : 'high-performance',
      }}
    >
      <ResponsiveCamera />
      <AdaptiveResolution active={props.active} />
      <ambientLight intensity={0.9} />
      <hemisphereLight args={['#f1f5ff', '#8aabc5', 1.4]} />
      <directionalLight position={[-3, 5, 5]} intensity={2.6} color="#fff8f1" />
      <directionalLight position={[3, 2, -2]} intensity={1.8} color="#c5deff" />
      <PlanetWorld
        motion={props.motion}
        auto={props.auto}
        reduced={props.reduced}
        onReady={props.onReady}
      />
    </Canvas>
  );
}

const LazyPlanetScene = lazy(() =>
  Promise.resolve({ default: PlanetScene })
);

function Arrow() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12h15m-6-6 6 6-6 6"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface SceneBoundaryState {
  failed: boolean;
}

class SceneBoundary extends Component<
  { children: ReactNode; onError?: () => void },
  SceneBoundaryState
> {
  state: SceneBoundaryState = { failed: false };

  static getDerivedStateFromError(): SceneBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error('3D scene failed:', error);
    this.props.onError?.();
  }

  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <p>We couldn’t load this little world.</p>
        <button type="button" onClick={() => location.reload()}>
          Try again
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}

function StoryDialog({
  story,
  onClose,
}: {
  story: OrbitStoryItem;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (!node.open) node.showModal();
    return () => {
      if (node.open) node.close();
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      className="about-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="close-dialog"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
      <span className="eyebrow">{story.eyebrow ?? story.label}</span>
      <h2>{story.title}</h2>
      {story.paragraphs.map((p) => (
        <p key={p}>{p}</p>
      ))}
      <button
        type="button"
        className="explore-button"
        onClick={() => {
          onClose();
          story.onCtaClick?.();
        }}
      >
        {story.ctaLabel ?? 'Continue'} <Arrow />
      </button>
    </dialog>
  );
}

const DEFAULT_STORIES: OrbitStoryItem[] = [
  {
    id: 'how-it-works',
    label: 'How it works',
    title: 'From your doorstep to theirs.',
    paragraphs: [
      'Every delivery begins with something worth sending. Pack it with care, choose its destination, and let the journey begin.',
      'Our little courier brings that journey to life. Turn the globe and watch him find his way.',
    ],
  },
  {
    id: 'for-business',
    label: 'For business',
    title: 'Your business. On the move.',
    paragraphs: [
      'Orders heading out. Supplies coming in. A thoughtful delivery experience connects both sides of your business.',
      'MeeCargo puts reliable corridor logistics and real-time visibility at the heart of every dispatch.',
    ],
  },
  {
    id: 'our-story',
    label: 'Our story',
    title: 'Every parcel brings us closer.',
    paragraphs: [
      'A shipment for a local retailer. Raw materials for a regional factory. An everyday essential arriving on schedule.',
      'MeeCargo is built around a simple idea: pooled capacity lowers costs for every business along the corridor.',
    ],
  },
];

function OrbitHeroShell({
  brandName = 'orbit',
  brandSub = 'delivery',
  onBrandClick,
  eyebrow = 'Good things, on their way',
  headlineLines = ['Good things.', 'Delivered', 'with care.'],
  descriptionLines = [
    'Parcels, packages, and a little peace of mind.',
    'From your doorstep to theirs.',
  ],
  primaryCtaLabel = 'Meet your courier',
  onPrimaryCtaClick,
  secondaryCta,
  headerCtaLabel = 'Sign in',
  onHeaderCtaClick,
  headerStatus,
  navActionLabel = 'Corridors',
  stories = DEFAULT_STORIES,
  extraNavItems = [],
  captionIdle = ['Drag to turn', 'the world'],
  captionDragging = ['Good things.', 'On their way.'],
  captionPaused = ['Press Start', 'to keep moving'],
  footerLeftLines = ['Small parcels', 'Big possibilities'],
  footerRightLines = ['A little', 'closer', 'to you'],
  children,
}: Omit<OrbitHeroProps, 'theme' | 'assetBaseUrl'>) {
  const motion = useRef<MotionState>(createMotion());
  const interaction = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [visible, setVisible] = useState(true);
  const [tabVisible, setTabVisible] = useState(() =>
    typeof document === 'undefined' ? true : !document.hidden
  );
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [sceneMounted, setSceneMounted] = useState(false);
  const [auto, setAuto] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [ready, setReady] = useState(false);
  const [sceneFailed, setSceneFailed] = useState(false);
  const [activeStory, setActiveStory] = useState<OrbitStoryItem | null>(null);
  const [prototype] = useState(
    () =>
      typeof location !== 'undefined' &&
      new URLSearchParams(location.search).has('prototype')
  );

  useEffect(() => {
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const change = () => setReduced(query.matches);
    query.addEventListener('change', change);
    const onVisibility = () => {
      setTabVisible(!document.hidden);
      if (document.hidden) {
        motion.current.dragging = false;
        drag.current = null;
        setDragging(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.01 }
    );
    if (interaction.current) observer.observe(interaction.current);
    return () => {
      query.removeEventListener('change', change);
      document.removeEventListener('visibilitychange', onVisibility);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let frame = 0;
    let timeout = 0;
    frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        timeout = window.setTimeout(() => setSceneMounted(true), 100);
      });
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, []);

  const release = (id: number) => {
    if (drag.current?.id !== id) return;
    drag.current = null;
    motion.current.dragging = false;
    motion.current.lastInteraction = motion.current.time;
    setDragging(false);
  };

  const toggleMotion = () => {
    const next = !auto;
    setAuto(next);
    const m = motion.current;
    m.dragging = false;
    if (
      drag.current &&
      interaction.current?.hasPointerCapture(drag.current.id)
    ) {
      interaction.current.releasePointerCapture(drag.current.id);
    }
    drag.current = null;
    setDragging(false);
    m.planetVelocity = m.pitchVelocity = 0;
    m.dragTarget = m.planetAngle;
    m.pitchTarget = m.pitchAngle;
    if (next) m.lastInteraction = m.time - 4;
  };

  const nudge = (direction: number) => {
    if (!auto) return;
    motion.current.planetVelocity += direction * 0.65;
    motion.current.lastInteraction = motion.current.time;
  };

  const explore = () => {
    interaction.current?.focus({ preventScroll: true });
    if (window.innerWidth < 760) {
      interaction.current?.scrollIntoView({
        behavior: reduced ? 'instant' : 'smooth',
        block: 'center',
      });
    }
    if (!reduced) nudge(1);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!auto || !event.isPrimary || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    const m = motion.current;
    m.dragTarget = m.planetAngle;
    m.pitchTarget = m.pitchAngle;
    m.dragging = true;
    m.lastInteraction = m.time;
    setDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!auto || drag.current?.id !== event.pointerId) return;
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    const sensitivity = 5 / Math.max(360, event.currentTarget.clientWidth);
    const m = motion.current;
    m.dragTarget = Math.max(
      m.planetAngle - 0.5,
      Math.min(m.planetAngle + 0.5, m.dragTarget + dx * sensitivity)
    );
    m.pitchTarget = Math.max(
      m.pitchAngle - 0.4,
      Math.min(m.pitchAngle + 0.4, m.pitchTarget + dy * sensitivity * 0.7)
    );
    drag.current.x = event.clientX;
    drag.current.y = event.clientY;
    m.lastInteraction = m.time;
  };

  return (
    <div className={`page ${prototype ? 'prototype' : ''}`}>
      <header className="site-header">
        <a
          href="/"
          className="wordmark"
          aria-label={`${brandName} home`}
          onClick={(e) => {
            if (onBrandClick) {
              e.preventDefault();
              onBrandClick();
            }
          }}
        >
          <svg viewBox="0 0 38 38" aria-hidden="true">
            <defs>
              <radialGradient id="logo-light" cx="30%" cy="20%">
                <stop stopColor="#7d9efa" />
                <stop offset="1" stopColor="#4674e9" />
              </radialGradient>
            </defs>
            <circle cx="23" cy="15" r="14" fill="url(#logo-light)" />
            <circle cx="10" cy="27" r="8" fill="#6389f0" />
            <circle cx="15" cy="8" r="3.5" fill="#b2c7ff" opacity=".45" />
          </svg>
          <span className="brand-type">
            {brandName}
            <small>{brandSub}</small>
          </span>
        </a>

        <nav aria-label="Main navigation">
          <button type="button" onClick={explore}>
            {navActionLabel}
          </button>
          {stories.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveStory(item)}
            >
              {item.label}
            </button>
          ))}
          {extraNavItems.map((item) => (
            <button key={item.id} type="button" onClick={item.onClick}>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          {headerStatus}
          <button
            type="button"
            className="header-cta"
            onClick={onHeaderCtaClick ?? explore}
          >
            {headerCtaLabel}
          </button>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="eyebrow">{eyebrow}</p>
            <h1 id="hero-title">
              {headlineLines[0]}
              <br />
              {headlineLines[1]}
              <br />
              <em>{headlineLines[2]}</em>
            </h1>
            <p className="hero-description">
              {descriptionLines[0]}
              <br className="desktop-break" /> {descriptionLines[1]}
            </p>
            <div className="hero-cta-row">
              <button
                type="button"
                className="explore-button"
                onClick={onPrimaryCtaClick ?? explore}
              >
                {primaryCtaLabel} <Arrow />
              </button>
              {secondaryCta}
            </div>
          </div>

          <div className="visual-column">
            <div
              ref={interaction}
              id="planet"
              className={`planet-stage ${dragging ? 'dragging' : ''}`}
              tabIndex={0}
              role="group"
              aria-roledescription="interactive 3D planet"
              aria-label="Rotate the planet"
              aria-describedby="planet-instructions"
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => release(event.pointerId)}
              onPointerCancel={(event) => release(event.pointerId)}
              onLostPointerCapture={(event) => release(event.pointerId)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  nudge(event.key === 'ArrowRight' ? 1 : -1);
                }
                if (
                  auto &&
                  (event.key === 'ArrowUp' || event.key === 'ArrowDown')
                ) {
                  event.preventDefault();
                  motion.current.pitchVelocity +=
                    event.key === 'ArrowDown' ? 0.4 : -0.4;
                  motion.current.lastInteraction = motion.current.time;
                }
                if (event.key === ' ') {
                  event.preventDefault();
                  if (!event.repeat) toggleMotion();
                }
              }}
            >
              {sceneMounted && (
                <SceneBoundary onError={() => setSceneFailed(true)}>
                  <Suspense fallback={null}>
                    <LazyPlanetScene
                      motion={motion}
                      active={visible && tabVisible && !activeStory}
                      auto={auto}
                      reduced={reduced}
                      prototype={prototype}
                      onReady={setReady}
                    />
                  </Suspense>
                </SceneBoundary>
              )}
              {!ready && !sceneFailed && (
                <div className="loading" role="status">
                  <span />
                  Your corridor world is taking shape…
                </div>
              )}
            </div>
          </div>

          <div
            className={`planet-caption ${dragging ? 'is-dragging' : ''}`}
            aria-hidden="true"
          >
            <p>
              {!auto
                ? captionPaused[0]
                : dragging
                  ? captionDragging[0]
                  : captionIdle[0]}
              <br />
              {!auto
                ? captionPaused[1]
                : dragging
                  ? captionDragging[1]
                  : captionIdle[1]}
            </p>
            <svg viewBox="0 0 180 165" fill="none">
              <path
                d="M161 148C137 82 103 39 28 14m0 0 6 16m-6-16 19-2"
                stroke="currentColor"
                strokeWidth="2.3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <p id="planet-instructions" className="sr-only">
            Drag in any direction, or use the arrow keys, to rotate the 3D
            planet. Space pauses the planet and lets the courier wave; press
            again to start. Rotation is locked while paused. On touch screens,
            swipe outside the planet to scroll the page.
          </p>

          <div className="cloud-bank" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <p className="footer-left">
          {footerLeftLines[0]}
          <br />
          {footerLeftLines[1]}
        </p>
        <button
          type="button"
          className="motion-button"
          onClick={toggleMotion}
          aria-pressed={!auto}
          aria-label={
            auto ? 'Pause and greet the courier' : 'Start moving'
          }
        >
          {auto ? (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M7 5v10m6-10v10"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m7 4 8 6-8 6Z" fill="currentColor" />
            </svg>
          )}
          <span>{auto ? 'Pause' : 'Start'}</span>
        </button>
        <p className="footer-right">
          {footerRightLines[0]}
          <br />
          {footerRightLines[1]}
          <br />
          {footerRightLines[2]}
        </p>
      </footer>

      {prototype && (
        <aside className="prototype-label">
          Movement prototype <a href="./">View finished scene ↗</a>
        </aside>
      )}
      {activeStory && (
        <StoryDialog
          story={activeStory}
          onClose={() => setActiveStory(null)}
        />
      )}
      {children}
    </div>
  );
}

const ORBIT_HERO_CSS = `@font-face{font-family:'Orbit DM Sans';font-style:normal;font-weight:400 700;font-display:swap;src:url('https://cdn.21st.dev/assets/mirror/46/468d56b6b25b05b70190b6c233d773f6f1770e8579827ce022a57f03fa8002fb.woff2') format('woff2')}
@font-face{font-family:'Orbit Libre Caslon';font-style:normal;font-weight:400;font-display:swap;src:url('https://cdn.21st.dev/assets/mirror/d7/d7157ad1851673258b7bf8b9d16654e90ca5f2d687aa0c71506d83266e0a20a2.woff2') format('woff2')}
.orbit-delivery{font-family:'Orbit DM Sans',sans-serif;color:#080e2b;background:#f6f9ff;font-synthesis:none;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased;font-weight:400;color-scheme:light}
.orbit-delivery *{box-sizing:border-box}.orbit-delivery{margin:0}.orbit-delivery button,.orbit-delivery a{-webkit-tap-highlight-color:transparent}.orbit-delivery button{font:inherit;color:inherit;cursor:pointer;border:0;background:none}.orbit-delivery button:disabled{cursor:default;opacity:.55}.orbit-delivery button:focus-visible,.orbit-delivery a:focus-visible{outline:2px solid #4776ee;outline-offset:6px}.orbit-delivery a{color:inherit;text-decoration:none}.orbit-delivery svg{display:block}.orbit-delivery button svg{width:22px;height:22px}.orbit-delivery .page{min-height:100svh;position:relative;overflow-x:hidden;background:radial-gradient(ellipse at 6% 15%,#fffefa 0%,#fbfcff 38%,#f0f6ff 100%);display:flex;flex-direction:column}.orbit-delivery .site-header{height:104px;flex:none;display:flex;align-items:center;justify-content:space-between;padding:0 6.5%;position:relative;z-index:5}.orbit-delivery .wordmark{display:flex;align-items:center;gap:13px;font-size:32px;font-weight:600;letter-spacing:-1.5px}.orbit-delivery .wordmark>svg{width:35px;height:35px}.orbit-delivery .site-header nav{position:absolute;left:50%;transform:translateX(-50%);display:flex;gap:38px;align-items:center}.orbit-delivery .site-header nav button{font-size:15px;color:#4d5a83;padding:12px 0;transition:color .2s;white-space:nowrap}.orbit-delivery .site-header nav button:hover{color:#4574ec}.orbit-delivery .header-actions{display:flex;align-items:center;gap:12px}.orbit-delivery .header-cta{background:#4673eb;color:white;border-radius:23px;padding:15px 27px;font-size:15px;box-shadow:inset 0 1px 0 #ffffff26;transition:background .2s;white-space:nowrap}.orbit-delivery .header-cta:not(:disabled):hover,.orbit-delivery .explore-button:not(:disabled):hover{background:#345fda}.orbit-delivery main{flex:none;height:calc(100svh - 104px);min-height:656px;display:flex;position:relative}.orbit-delivery .hero{width:100%;position:relative;overflow:hidden}.orbit-delivery .hero-copy{position:relative;z-index:3;margin-left:6.5%;padding-top:clamp(56px,10.5vh,132px);width:45%;pointer-events:none}.orbit-delivery .hero-copy button,.orbit-delivery .hero-copy a,.orbit-delivery .hero-cta-row{pointer-events:auto}.orbit-delivery .eyebrow{text-transform:uppercase;letter-spacing:.32em;font-size:12px;font-weight:500;color:#7a94df;margin:0 0 21px}.orbit-delivery h1{font-size:clamp(60px,5.3vw,96px);font-weight:550;letter-spacing:-.064em;line-height:1.03;margin:0 0 26px}.orbit-delivery h1 em{font-family:'Orbit Libre Caslon',Georgia,serif;font-size:1.12em;font-weight:400;letter-spacing:-.035em;color:#4a72e7;line-height:.7}.orbit-delivery .hero-description{color:#7a87aa;font-size:clamp(16px,1.25vw,21px);line-height:1.45;letter-spacing:-.3px;margin:0 0 30px}.orbit-delivery .hero-cta-row{display:flex;flex-wrap:wrap;align-items:center;gap:12px}.orbit-delivery .explore-button{display:inline-flex;align-items:center;justify-content:center;gap:9px;min-width:183px;padding:17px 29px;border-radius:32px;background:#4773ec;color:white;font-size:16px;min-height:55px;box-shadow:inset 0 1px 0 #ffffff30;transition:background .2s,transform .2s}.orbit-delivery .explore-button:not(:disabled):hover{transform:translateY(-2px)}.orbit-delivery .explore-button:not(:disabled):active{transform:translateY(0)}.orbit-delivery .visual-column{position:absolute;right:-5%;top:0;width:76%;height:calc(100% + 12px);z-index:1}.orbit-delivery .planet-stage{height:100%;width:100%;position:relative;cursor:grab;touch-action:none;user-select:none;outline:none}.orbit-delivery .planet-stage:focus-visible{outline:1px dashed #adc1ef;outline-offset:-15px;border-radius:36px}.orbit-delivery .planet-stage.dragging{cursor:grabbing}.orbit-delivery .planet-caption{position:absolute;right:6.2%;top:17%;z-index:3;width:160px;pointer-events:none;color:#a4b5d8;transition:opacity .2s}.orbit-delivery .planet-caption p{font-size:15px;line-height:1.35;font-style:italic;text-align:right;margin:0}.orbit-delivery .planet-caption svg{width:160px;height:149px;margin-top:-17px;margin-left:-32px}.orbit-delivery .planet-caption.is-dragging{opacity:.6}.orbit-delivery .cloud-bank{position:absolute;z-index:2;inset:auto -12% -90px 24%;height:250px;pointer-events:none;filter:blur(17px);opacity:.95}.orbit-delivery .cloud-bank i{position:absolute;bottom:0;background:radial-gradient(ellipse at 42% 34%,#fffdfb 27%,#f3f7ff 59%,#e5edfc88 75%,transparent 80%);border-radius:50%}.orbit-delivery .cloud-bank i:nth-child(1){width:390px;height:200px;left:0;bottom:-28px;transform:rotate(-25deg)}.orbit-delivery .cloud-bank i:nth-child(2){width:265px;height:195px;left:14%;bottom:32px}.orbit-delivery .cloud-bank i:nth-child(3){width:270px;height:170px;left:29%;bottom:-2px}.orbit-delivery .cloud-bank i:nth-child(4){width:350px;height:200px;right:7%;bottom:-20px}.orbit-delivery .cloud-bank i:nth-child(5){width:280px;height:215px;right:-2%;bottom:70px}.orbit-delivery .site-footer{position:absolute;top:calc(max(100svh,760px) - 72px);left:6.5%;right:5.1%;z-index:4;display:flex;align-items:flex-end;justify-content:space-between;pointer-events:none}.orbit-delivery .site-footer p{margin:0;text-transform:uppercase;font-size:10px;letter-spacing:.25em;line-height:1.8;color:#94a7d1}.orbit-delivery .footer-left::before{content:'';display:block;width:25px;height:1px;background:#aebfdf;margin-bottom:14px}.orbit-delivery .footer-right{text-align:right}.orbit-delivery .motion-button{display:flex;gap:7px;align-items:center;color:#7b92be;pointer-events:auto;font-size:10px;letter-spacing:.02em;opacity:.8;padding:8px}.orbit-delivery .motion-button:hover{opacity:1}.orbit-delivery .motion-button svg{width:15px;height:15px}.orbit-delivery .loading{position:absolute;top:42%;left:25%;right:20%;display:flex;align-items:center;justify-content:center;gap:12px;color:#8197c4;font-size:12px;pointer-events:none}.orbit-delivery .loading>span{width:17px;height:17px;border:1px solid #d8e3ff;border-top-color:#648cf0;border-radius:50%;animation:loading 1.2s linear infinite}@keyframes loading{to{transform:rotate(360deg)}}.orbit-delivery .scene-fallback{position:absolute;inset:35% 20%;font-size:15px;text-align:center;color:#7588b4;z-index:5}.orbit-delivery .scene-fallback button{background:#4773ec;border-radius:20px;color:white;padding:10px 20px;margin-top:12px}.orbit-delivery .about-dialog{border:1px solid #dce5fa;border-radius:22px;padding:48px;max-width:510px;width:calc(100% - 32px);background:#f9fbff;color:#080e2b;box-shadow:0 25px 120px #183c7326;margin:auto}.orbit-delivery .about-dialog::backdrop{background:#1a315c33;backdrop-filter:blur(8px)}.orbit-delivery .about-dialog h2{font-size:36px;font-weight:500;letter-spacing:-1.6px;line-height:1.15;margin:26px 0 22px}.orbit-delivery .about-dialog p{font-size:15px;line-height:1.75;color:#7a87aa;margin:0 0 14px}.orbit-delivery .about-dialog .explore-button{margin-top:16px;font-size:14px}.orbit-delivery .close-dialog{position:absolute;right:20px;top:10px;font-size:30px;color:#8194bf}.orbit-delivery .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.orbit-delivery .prototype-label{position:fixed;bottom:12px;left:12px;z-index:8;background:#fff;border:1px solid #d5e0f6;border-radius:6px;padding:12px;font:11px monospace}.orbit-delivery .prototype-label a{margin-left:18px;text-decoration:underline}
@media(min-width:1800px){.orbit-delivery .hero-copy{padding-top:15vh}.orbit-delivery main{min-height:846px}.orbit-delivery .site-footer{top:calc(max(100svh,950px) - 72px)}}
@media(max-width:1150px){.orbit-delivery .site-header{height:90px;padding:0 5%}.orbit-delivery .site-header nav{gap:24px}.orbit-delivery .site-header nav button{font-size:13px}.orbit-delivery .wordmark{font-size:29px}.orbit-delivery .header-cta{font-size:13px;padding:13px 21px}.orbit-delivery main{height:calc(100svh - 90px);min-height:670px}.orbit-delivery .hero-copy{margin-left:5%;padding-top:88px;width:48%}.orbit-delivery h1{font-size:62px}.orbit-delivery .hero-description{font-size:15px;max-width:370px}.orbit-delivery .planet-caption{right:4%;top:18%;width:115px}.orbit-delivery .planet-caption p{font-size:12px}.orbit-delivery .planet-caption svg{width:130px;margin-left:-24px}.orbit-delivery .site-footer{left:5%}.orbit-delivery .explore-button{font-size:15px;min-width:168px}}
@media(max-width:759px){.orbit-delivery .page{height:auto;min-height:100svh}.orbit-delivery .site-header{height:90px;padding:0 25px}.orbit-delivery .site-header nav{display:none}.orbit-delivery .wordmark{font-size:28px;gap:9px}.orbit-delivery .wordmark>svg{width:31px;height:31px}.orbit-delivery .header-cta{padding:12px 19px;border-radius:20px;font-size:12px}.orbit-delivery main{display:block;height:auto;min-height:0}.orbit-delivery .hero{display:flex;flex-direction:column}.orbit-delivery .hero-copy{width:calc(100% - 50px);margin:0 25px;padding-top:32px;pointer-events:auto}.orbit-delivery .eyebrow{font-size:9px;letter-spacing:.28em;margin-bottom:18px}.orbit-delivery h1{font-size:clamp(50px,12vw,76px);margin-bottom:23px;line-height:1.025}.orbit-delivery .hero-description{font-size:15px;line-height:1.6;max-width:340px;margin-bottom:24px}.orbit-delivery .desktop-break{display:none}.orbit-delivery .explore-button{padding:15px 24px;min-height:51px;min-width:163px;font-size:14px}.orbit-delivery .visual-column{position:relative;width:134%;right:auto;left:-17%;height:clamp(445px,112vw,670px);margin-top:-8px}.orbit-delivery .planet-caption{top:auto;bottom:290px;right:18px;width:96px}.orbit-delivery .planet-caption p{font-size:11px}.orbit-delivery .planet-caption svg{width:92px;height:94px;margin-left:-13px;margin-top:-3px}.orbit-delivery .cloud-bank{left:-20%;right:-20%;height:185px;bottom:-50px;filter:blur(14px)}.orbit-delivery .cloud-bank i:nth-child(1){width:210px;height:140px;left:-10%;bottom:12px}.orbit-delivery .cloud-bank i:nth-child(2){width:170px;height:150px;left:10%;bottom:-32px}.orbit-delivery .cloud-bank i:nth-child(3){width:180px;height:130px;left:35%;bottom:-35px}.orbit-delivery .cloud-bank i:nth-child(4){width:210px;height:160px;right:-5%;bottom:-5px}.orbit-delivery .cloud-bank i:nth-child(5){width:120px;height:120px;right:8%;bottom:0}.orbit-delivery .site-footer{position:relative;top:auto;bottom:auto;left:auto;right:auto;padding:12px 25px 26px}.orbit-delivery .site-footer p{font-size:8px;letter-spacing:.18em}.orbit-delivery .footer-left::before{margin-bottom:9px;width:20px}.orbit-delivery .motion-button{font-size:0;gap:0;padding:8px}.orbit-delivery .motion-button svg{width:18px;height:18px}.orbit-delivery .about-dialog{padding:35px}.orbit-delivery .about-dialog h2{font-size:31px}.orbit-delivery .prototype-label{font-size:9px;padding:8px}}
@media(prefers-reduced-motion:reduce){.orbit-delivery *,.orbit-delivery *::before,.orbit-delivery *::after{scroll-behavior:auto!important;transition:none!important;animation:none!important}.orbit-delivery .explore-button:not(:disabled):hover{transform:none}}

.orbit-delivery .brand-type{display:flex;flex-direction:column;line-height:1;gap:5px}.orbit-delivery .brand-type small{font-size:8px;font-weight:500;letter-spacing:.24em;text-transform:uppercase;color:#7c96cc;margin-left:2px}.orbit-delivery .site-header .header-cta{font-size:13px;padding:15px 22px}.orbit-delivery .hero-copy h1 em{line-height:.92}.orbit-delivery .hero-copy .explore-button{gap:13px}
@media(max-width:759px){.orbit-delivery .brand-type{gap:4px}.orbit-delivery .brand-type small{font-size:7px}.orbit-delivery .site-header .header-cta{font-size:11px;padding:12px 15px}}

.orbit-delivery{width:100%;isolation:isolate;--orbit-bg:radial-gradient(ellipse at 6% 15%,#fffefa 0%,#fbfcff 38%,#f0f6ff 100%);--orbit-ink:#080e2b;--orbit-muted:#7a87aa;--orbit-nav:#4d5a83;--orbit-accent:#4a72e7;--orbit-cloud:1;color:var(--orbit-ink)}
:is(.dark,[data-theme="dark"]) .orbit-delivery:not([data-theme="light"]),.orbit-delivery[data-theme="dark"]{--orbit-bg:radial-gradient(ellipse at 6% 15%,#151e32 0%,#0d1526 50%,#101e38 100%);--orbit-ink:#f3f6ff;--orbit-muted:#b0bed9;--orbit-nav:#becbe6;--orbit-accent:#8daaff;--orbit-cloud:.14;color-scheme:dark}
.orbit-delivery .page{background:var(--orbit-bg);color:var(--orbit-ink)}
.orbit-delivery .hero-description,.orbit-delivery .about-dialog p{color:var(--orbit-muted)}
.orbit-delivery .site-header nav button{color:var(--orbit-nav)}
.orbit-delivery h1 em{color:var(--orbit-accent)}
.orbit-delivery .cloud-bank{opacity:var(--orbit-cloud)}
.orbit-delivery .about-dialog{background:var(--orbit-bg);color:var(--orbit-ink)}
.orbit-delivery .wordmark{color:var(--orbit-ink)}
.orbit-delivery h1{font-family:inherit}
`;

export function OrbitDeliveryHero({
  theme = 'auto',
  assetBaseUrl = '/',
  ...props
}: OrbitHeroProps) {
  const normalizedBase = assetBaseUrl
    ? `${assetBaseUrl.replace(/\/$/, '')}/`
    : '/';
  return (
    <AssetBaseContext.Provider value={normalizedBase}>
      <div className="orbit-delivery" data-theme={theme}>
        <style>{ORBIT_HERO_CSS}</style>
        <OrbitHeroShell {...props} />
      </div>
    </AssetBaseContext.Provider>
  );
}

export default OrbitDeliveryHero;

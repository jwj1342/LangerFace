import * as THREE from "three";

const DEFAULT_SKIN_COLOR = 0xd6aa8f;

export function meshBounds(verts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const vertex of verts) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  const center = min.map((value, axis) => (value + max[axis]) * 0.5);
  const extent = min.map((value, axis) => Math.max((max[axis] - value) * 0.5, 1e-5));
  return { min, max, center, extent };
}

export function configureSkinRenderer(renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
}

export function addSkinLighting(scene) {
  const lights = new THREE.Group();
  lights.name = "skin-lighting";

  const hemisphere = new THREE.HemisphereLight(0xfff4ec, 0x182331, 0.82);
  const key = new THREE.DirectionalLight(0xffeadb, 2.15);
  key.position.set(1.8, 2.4, 3.5);
  const fill = new THREE.DirectionalLight(0xc9ddff, 0.72);
  fill.position.set(-2.6, 0.4, 1.8);
  const rim = new THREE.DirectionalLight(0xffd7c2, 0.58);
  rim.position.set(1.2, 1.0, -3.0);

  lights.add(hemisphere, key, fill, rim);
  scene.add(lights);
  return lights;
}

export function createSkinMaterial(verts, {
  showSurface = true,
  vertexColors = false,
  fallbackColor = DEFAULT_SKIN_COLOR,
} = {}) {
  const bounds = meshBounds(verts);
  const material = new THREE.MeshStandardMaterial({
    color: showSurface ? fallbackColor : 0x000000,
    roughness: 0.72,
    metalness: 0,
    side: THREE.DoubleSide,
    colorWrite: showSurface,
    vertexColors,
  });

  material.onBeforeCompile = (shader) => {
    shader.uniforms.skinCenter = { value: new THREE.Vector3(...bounds.center) };
    shader.uniforms.skinExtent = { value: new THREE.Vector3(...bounds.extent) };

    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vSkinPosition;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
vSkinPosition = position;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vSkinPosition;
uniform vec3 skinCenter;
uniform vec3 skinExtent;

float skinHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}

float skinNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(skinHash(i), skinHash(i + vec3(1, 0, 0)), f.x),
        mix(skinHash(i + vec3(0, 1, 0)), skinHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(skinHash(i + vec3(0, 0, 1)), skinHash(i + vec3(1, 0, 1)), f.x),
        mix(skinHash(i + vec3(0, 1, 1)), skinHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z
  );
}

float skinFbm(vec3 p) {
  float value = 0.0;
  value += skinNoise(p) * 0.55;
  value += skinNoise(p * 2.03 + 11.7) * 0.28;
  value += skinNoise(p * 4.01 + 37.1) * 0.17;
  return value;
}

float skinRegion(vec2 p, vec2 center, vec2 radius) {
  vec2 q = (p - center) / radius;
  return exp(-dot(q, q) * 2.2);
}`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
vec3 skinP = (vSkinPosition - skinCenter) / skinExtent;
vec2 skinFace = skinP.xy;
float skinMacro = skinFbm(skinP * vec3(2.4, 2.8, 2.0));
float skinMottle = skinFbm(skinP * vec3(7.0, 8.0, 6.0) + 19.0);
float skinPores = skinNoise(skinP * vec3(46.0, 52.0, 38.0) + 7.0);
float skinSpots = smoothstep(0.79, 0.96, skinMottle);

float skinCheeks = skinRegion(skinFace, vec2(-0.38, -0.05), vec2(0.30, 0.30))
                 + skinRegion(skinFace, vec2(0.38, -0.05), vec2(0.30, 0.30));
float skinEyes = skinRegion(skinFace, vec2(-0.31, 0.36), vec2(0.25, 0.15))
               + skinRegion(skinFace, vec2(0.31, 0.36), vec2(0.25, 0.15));
float skinNose = skinRegion(skinFace, vec2(0.0, -0.04), vec2(0.20, 0.36));
float skinNoseWings = skinRegion(skinFace, vec2(-0.14, -0.14), vec2(0.11, 0.11))
                    + skinRegion(skinFace, vec2(0.14, -0.14), vec2(0.11, 0.11));
float skinLips = skinRegion(skinFace, vec2(0.0, -0.42), vec2(0.31, 0.105));
float skinChin = skinRegion(skinFace, vec2(0.0, -0.69), vec2(0.34, 0.20));

vec3 skinTint = vec3(1.0);
skinTint *= 0.97 + (skinMacro - 0.5) * 0.14;
skinTint += vec3(0.020, 0.004, -0.008) * (skinMottle - 0.5);
skinTint += vec3(0.055, -0.008, -0.018) * min(1.0, skinCheeks * 0.68);
skinTint += vec3(0.050, -0.016, -0.026) * min(1.0, skinNoseWings * 0.76);
skinTint += vec3(0.140, -0.052, -0.062) * min(1.0, skinLips * 0.90);
skinTint -= vec3(0.050, 0.035, 0.022) * min(1.0, skinEyes * 0.60);
skinTint += vec3(0.020, 0.005, -0.003) * min(1.0, skinChin * 0.32);
skinTint += vec3(0.012, 0.002, -0.004) * skinNose;
skinTint -= vec3(0.040, 0.028, 0.018) * skinSpots;
skinTint += (skinPores - 0.5) * 0.045;
diffuseColor.rgb *= clamp(skinTint, vec3(0.78), vec3(1.16));`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
float skinRoughMacro = skinMottle;
float skinRoughPores = skinPores;
roughnessFactor += (skinRoughMacro - 0.5) * 0.13 + (skinRoughPores - 0.5) * 0.09;
roughnessFactor -= min(1.0, skinNose * 0.45 + skinLips * 0.40) * 0.07;
roughnessFactor += min(1.0, skinCheeks * 0.30 + skinChin * 0.22) * 0.035;
roughnessFactor = clamp(roughnessFactor, 0.54, 0.88);`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
float skinHeight = (skinPores - 0.5) * 0.055 + (skinMottle - 0.5) * 0.025;
vec3 skinSigmaX = normalize(dFdx(-vViewPosition));
vec3 skinSigmaY = normalize(dFdy(-vViewPosition));
vec3 skinR1 = cross(skinSigmaY, normal);
vec3 skinR2 = cross(normal, skinSigmaX);
float skinDet = dot(skinSigmaX, skinR1);
vec3 skinGrad = sign(skinDet) * (dFdx(skinHeight) * skinR1 + dFdy(skinHeight) * skinR2);
normal = normalize(abs(skinDet) * normal - skinGrad * 0.32);`,
      );
  };

  material.customProgramCacheKey = () => "langerface-skin-v1";
  return material;
}

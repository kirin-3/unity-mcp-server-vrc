// VRChat Bridge Functions
// Bridge functions for VRChat tooling (project context, avatar analysis, shaders, world tooling)
import { sendCommand } from "./unity-editor-bridge.js";

/**
 * Get VRChat project context including project type, SDK version, and ecosystem package availability.
 * @param {object} [params] - Optional parameters including `port`
 * @returns {Promise<object>} Bridge response with project context
 */
export async function vrcGetProjectContext(params = {}) {
  return sendCommand("vrc/project-context", params);
}

export const vrcProjectContext = vrcGetProjectContext;

// ─── Deferred avatar analysis ───
// vrc/avatar/{performance,parameters,audit} bake the avatar through NDMF, which blocks
// Unity's main thread for 20-100s. They therefore return a jobId immediately and the
// result is collected from vrc/avatar/job. Polling here (rather than in each tool) keeps
// the deferral invisible to callers: they still get the finished analysis.
const ANALYSIS_POLL_INTERVAL_MS = 1500;
const ANALYSIS_TIMEOUT_MS = Number(process.env.UNITY_VRC_ANALYSIS_TIMEOUT || 600000);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runDeferredAnalysis(route, params) {
  const submitted = await sendCommand(route, params);
  const job = submitted?.data ?? submitted;

  // No jobId means a plugin that still answers inline — use its answer as-is.
  if (!job || !job.jobId) return submitted;

  const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    await sleep(ANALYSIS_POLL_INTERVAL_MS);
    const polled = await sendCommand("vrc/avatar/job", { jobId: job.jobId, port: params?.port });
    last = polled?.data ?? polled;
    if (!last) continue;
    if (last.status === "completed") return { success: true, data: last.result };
    if (last.status === "failed") return { success: false, error: last.error };
    if (last.error) return { success: false, error: last.error };
  }

  const waited = Math.round(ANALYSIS_TIMEOUT_MS / 1000);
  return {
    success: false,
    error:
      `VRChat avatar analysis (${route}) did not finish within ${waited}s. ` +
      `It is still running in Unity as job ${job.jobId}; raise UNITY_VRC_ANALYSIS_TIMEOUT ` +
      `if this avatar legitimately takes longer.`,
  };
}

/**
 * Poll a previously submitted analysis job directly.
 * @param {object} [params] - Parameters: jobId, port
 */
export async function vrcAvatarJob(params = {}) {
  return sendCommand("vrc/avatar/job", params);
}


/**
 * Analyze VRChat avatar performance rank, limiting statistic, and contributing categories.
 * @param {object} [params] - Parameters: avatarPath, isMobile, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarPerformance(params = {}) {
  return runDeferredAnalysis("vrc/avatar/performance", params);
}

/**
 * Inspect VRChat avatar expression parameter memory budget and per-parameter costs.
 * @param {object} [params] - Parameters: avatarPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarParameters(params = {}) {
  return runDeferredAnalysis("vrc/avatar/parameters", params);
}

/**
 * Audit VRChat avatar for Write Defaults consistency, missing scripts, and texture memory.
 * @param {object} [params] - Parameters: avatarPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarAudit(params = {}) {
  return runDeferredAnalysis("vrc/avatar/audit", params);
}

/**
 * List Poiyomi materials with asset path and lock state.
 * @param {object} [params] - Parameters: avatarPath, materialPath, materials, port
 * @returns {Promise<object>}
 */
export async function vrcPoiyomiStatus(params = {}) {
  return sendCommand("vrc/poiyomi/status", params, params?.port);
}

/**
 * Lock Poiyomi materials across an avatar or list.
 * @param {object} [params] - Parameters: avatarPath, materialPath, materials, port
 * @returns {Promise<object>}
 */
export async function vrcPoiyomiLock(params = {}) {
  return sendCommand("vrc/poiyomi/lock", params, params?.port);
}

/**
 * Unlock Poiyomi materials across an avatar or list.
 * @param {object} [params] - Parameters: avatarPath, materialPath, materials, port
 * @returns {Promise<object>}
 */
export async function vrcPoiyomiUnlock(params = {}) {
  return sendCommand("vrc/poiyomi/unlock", params, params?.port);
}

/**
 * Read properties or keywords from a Poiyomi material.
 * @param {object} [params] - Parameters: materialPath, propertyName, port
 * @returns {Promise<object>}
 */
export async function vrcPoiyomiGetProperty(params = {}) {
  return sendCommand("vrc/poiyomi/get-property", params, params?.port);
}

/**
 * Set a property on a Poiyomi material with lock protection.
 * @param {object} [params] - Parameters: materialPath, propertyName, value, unlockIfLocked, port
 * @returns {Promise<object>}
 */
export async function vrcPoiyomiSetProperty(params = {}) {
  return sendCommand("vrc/poiyomi/set-property", params, params?.port);
}

/**
 * Get avatar descriptor configuration (view position, lip sync, eye look, playable layers, expressions).
 * @param {object} [params] - Parameters: avatarPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarDescriptorGet(params = {}) {
  return sendCommand("vrc/avatar/descriptor/get", params, params?.port);
}

/**
 * Assign viseme blendshapes to descriptor from conventional names, reporting unmatched visemes unmapped.
 * @param {object} [params] - Parameters: avatarPath, meshPath, mapping, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarDescriptorSetVisemes(params = {}) {
  return sendCommand("vrc/avatar/descriptor/set-visemes", params, params?.port);
}

/**
 * Assign an AnimatorController to an avatar playable layer (FX, Gesture, Action, Base, etc.).
 * @param {object} [params] - Parameters: avatarPath, layerType, controllerPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarDescriptorSetPlayableLayer(params = {}) {
  return sendCommand("vrc/avatar/descriptor/set-playable-layer", params, params?.port);
}

/**
 * Add or modify an expression parameter with 256-bit synced memory limit validation.
 * @param {object} [params] - Parameters: avatarPath, parametersAssetPath, name, type, defaultValue, saved, synced, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarParameterCreate(params = {}) {
  return sendCommand("vrc/avatar/parameters/create", params, params?.port);
}

/**
 * Read controls and submenus in an avatar expression menu.
 * @param {object} [params] - Parameters: avatarPath, menuAssetPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarMenuGet(params = {}) {
  return sendCommand("vrc/avatar/menu/get", params, params?.port);
}

/**
 * Add a control to an expression menu with 8-control limit validation.
 * @param {object} [params] - Parameters: avatarPath, menuAssetPath, name, type, parameter, value, subMenuAssetPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarMenuAddControl(params = {}) {
  return sendCommand("vrc/avatar/menu/add-control", params, params?.port);
}

/**
 * Add and configure a VRCPhysBone on a bone chain.
 * @param {object} [params] - Parameters: avatarPath, targetPath, rootTransformPath, pull, spring, damping, gravity, stiffness, immobility, radius, allowGrabbing, allowPosing, port
 * @returns {Promise<object>}
 */
export async function vrcPhysboneAdd(params = {}) {
  return sendCommand("vrc/physbone/add", params, params?.port);
}

/**
 * Modify parameters on an existing VRCPhysBone component.
 * @param {object} [params] - Parameters: avatarPath, targetPath, pull, spring, damping, gravity, stiffness, immobility, radius, allowGrabbing, allowPosing, port
 * @returns {Promise<object>}
 */
export async function vrcPhysboneConfigure(params = {}) {
  return sendCommand("vrc/physbone/configure", params, params?.port);
}

/**
 * List all PhysBones on an avatar with root, parameters, and affected transform count.
 * @param {object} [params] - Parameters: avatarPath, port
 * @returns {Promise<object>}
 */
export async function vrcPhysboneList(params = {}) {
  return sendCommand("vrc/physbone/list", params, params?.port);
}

/**
 * Add a VRCContactSender or VRCContactReceiver with shape, tags, and parameters.
 * @param {object} [params] - Parameters: avatarPath, targetPath, type, shape, radius, height, collisionTags, parameter, port
 * @returns {Promise<object>}
 */
export async function vrcContactAdd(params = {}) {
  return sendCommand("vrc/contact/add", params, params?.port);
}

/**
 * List all contact senders and receivers on an avatar.
 * @param {object} [params] - Parameters: avatarPath, port
 * @returns {Promise<object>}
 */
export async function vrcContactList(params = {}) {
  return sendCommand("vrc/contact/list", params, params?.port);
}

/**
 * List all Modular Avatar and VRCFury components on an avatar with object path and role.
 * @param {object} [params] - Parameters: avatarPath, port
 * @returns {Promise<object>}
 */
export async function vrcAvatarNonDestructiveList(params = {}) {
  return sendCommand("vrc/avatar/non-destructive/list", params, params?.port);
}

/**
 * Add a Modular Avatar component to an avatar GameObject (requires Modular Avatar package).
 * @param {object} [params] - Parameters: avatarPath, targetPath, componentType, port
 * @returns {Promise<object>}
 */
export async function vrcModularAvatarAdd(params = {}) {
  return sendCommand("vrc/avatar/modular-avatar/add", params, params?.port);
}

/**
 * Add a VRCFury component or feature to an avatar GameObject (requires VRCFury package).
 * @param {object} [params] - Parameters: avatarPath, targetPath, feature, port
 * @returns {Promise<object>}
 */
export async function vrcVrcfuryAdd(params = {}) {
  return sendCommand("vrc/avatar/vrcfury/add", params, params?.port);
}

/**
 * Inspect VRChat world scene descriptor, spawn points, and world configuration.
 * @param {object} [params] - Parameters: port
 * @returns {Promise<object>}
 */
export async function vrcWorldDescriptorGet(params = {}) {
  return sendCommand("vrc/world/descriptor/get", params, params?.port);
}

/**
 * Add a spawn point and assign to scene descriptor.
 * @param {object} [params] - Parameters: name, position, rotation, parentPath, port
 * @returns {Promise<object>}
 */
export async function vrcWorldDescriptorAddSpawn(params = {}) {
  return sendCommand("vrc/world/descriptor/add-spawn", params, params?.port);
}

/**
 * Modify scene descriptor spawn points, order, or respawn height.
 * @param {object} [params] - Parameters: spawns, spawnOrder, respawnHeightY, referenceCamera, forbidUserPortals, port
 * @returns {Promise<object>}
 */
export async function vrcWorldDescriptorSetSpawns(params = {}) {
  return sendCommand("vrc/world/descriptor/set-spawns", params, params?.port);
}

/**
 * List all Udon behaviours in the open scene.
 * @param {object} [params] - Parameters: port
 * @returns {Promise<object>}
 */
export async function vrcWorldUdonList(params = {}) {
  return sendCommand("vrc/world/udon/list", params, params?.port);
}

/**
 * Read public variables on an Udon behaviour.
 * @param {object} [params] - Parameters: targetPath, objectPath, port
 * @returns {Promise<object>}
 */
export async function vrcWorldUdonGetVariables(params = {}) {
  return sendCommand("vrc/world/udon/get-variables", params, params?.port);
}

/**
 * Set a public variable on an Udon behaviour with strict type checking.
 * @param {object} [params] - Parameters: targetPath, name, value, port
 * @returns {Promise<object>}
 */
export async function vrcWorldUdonSetVariable(params = {}) {
  return sendCommand("vrc/world/udon/set-variable", params, params?.port);
}

/**
 * Run world validation tooling (VRWorldToolkit) and report findings.
 * @param {object} [params] - Parameters: port
 * @returns {Promise<object>}
 */
export async function vrcWorldValidate(params = {}) {
  return sendCommand("vrc/world/validate", params, params?.port);
}

/**
 * Inspect world content summary (mirrors, audio spatialization, lights, video players).
 * @param {object} [params] - Parameters: port
 * @returns {Promise<object>}
 */
export async function vrcWorldContentSummary(params = {}) {
  return sendCommand("vrc/world/content/summary", params, params?.port);
}


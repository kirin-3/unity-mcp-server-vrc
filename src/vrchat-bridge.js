// VRChat Bridge Functions
// Bridge functions for VRChat tooling (project context, avatar analysis, shaders, world tooling)
import { sendCommand } from "./unity-editor-bridge.js";
import { looksLikeErrorObject } from "./response-format.js";

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


// ─── VRChat authoring v2 (plugin protocol 4) ───

/**
 * Create or update a VRCFury Toggle identified by its menu path.
 * @param {object} [params] - Parameters: avatarPath, menuPath, targetPath, objects, blendShapes, materials, saved, defaultOn, slider, exclusiveTags, exclusiveOffState, globalParam, port
 * @returns {Promise<object>}
 */
export async function vrcVrcfuryToggle(params = {}) {
  return sendCommand("vrc/avatar/vrcfury/toggle", params, params?.port);
}

/**
 * Create or update a VRCFury Armature Link and report which bones link.
 * @param {object} [params] - Parameters: avatarPath, targetPath, propBonePath, linkTo, recursive, align, removeBoneSuffix, port
 * @returns {Promise<object>}
 */
export async function vrcVrcfuryArmatureLink(params = {}) {
  return sendCommand("vrc/avatar/vrcfury/armature-link", params, params?.port);
}

/**
 * Put an outfit under the avatar and merge its armature (Modular Avatar or VRCFury), reporting unmatched bones.
 * @param {object} [params] - Parameters: avatarPath, outfitPath, method, resetTransform, port
 * @returns {Promise<object>}
 */
export async function vrcOutfitAttach(params = {}) {
  return sendCommand("vrc/avatar/outfit/attach", params, params?.port);
}

/**
 * List a mesh's blendshapes, optionally with face-tracking coverage.
 * @param {object} [params] - Parameters: avatarPath, meshPath, filter, faceTracking, port
 * @returns {Promise<object>}
 */
export async function vrcBlendshapesList(params = {}) {
  return sendCommand("vrc/avatar/blendshapes/list", params, params?.port);
}

/**
 * Set blendshape weights on a mesh by name.
 * @param {object} [params] - Parameters: avatarPath, meshPath, weights, port
 * @returns {Promise<object>}
 */
export async function vrcBlendshapesSet(params = {}) {
  return sendCommand("vrc/avatar/blendshapes/set", params, params?.port);
}

/** The plugin's answer inside a bridge result, or null when the call itself did not get through. */
function pluginData(result) {
  if (!result || result.success === false) return null;
  return result.data ?? result;
}

function pick(source, keys) {
  const out = {};
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
}

// ─── Play-mode testing ───
// Entering play mode reloads the domain (the bridge drops for a few seconds), and the emulator
// attaches to the avatar a few frames after play starts. The steps are sequenced here so one
// call goes from edit mode to a captured result: status → enter play mode → wait for the
// emulator → set → settle → read back → capture.
const PLAYMODE_POLL_INTERVAL_MS = 1000;
const PLAYMODE_TIMEOUT_MS = Number(process.env.UNITY_VRC_PLAYMODE_TIMEOUT || 120000);
// Unity refused the switch (e.g. compile errors) if it keeps answering from edit mode this long.
const PLAYMODE_ENTER_GRACE_MS = 15000;
// Once play mode runs, an emulator that is in the scene attaches within a few frames.
const PLAYMODE_ATTACH_GRACE_MS = 20000;
const PLAYMODE_SET_KEYS = ["avatarPath", "parameters", "gestureLeft", "gestureRight", "gestureLeftWeight", "gestureRightWeight"];

function notReady(error, extra = {}) {
  return { success: false, error, notReady: true, ...extra };
}

/**
 * Poll play-mode status until an emulator drives the avatar. Returns { status } when ready,
 * or { error } explaining why it will not become ready.
 */
async function waitForEmulator(statusArgs, deadline, playRequestedAt) {
  let last = null;
  let playingSince = null;
  while (Date.now() < deadline) {
    const status = pluginData(await sendCommand("vrc/avatar/playmode/status", statusArgs));
    if (status) {
      last = status;
      if (looksLikeErrorObject(status)) return { error: status.error || "Play-mode status failed." };
      if (status.ready === true) return { status };
      if (status.isPlaying !== true) {
        if (status.compileErrors === true) return { error: status.hint };
        const refused = status.enteringPlayMode === false && Date.now() - playRequestedAt > PLAYMODE_ENTER_GRACE_MS;
        if (refused) return { error: `Unity did not enter play mode. ${status.hint || ""}`.trim() };
      } else {
        playingSince ??= Date.now();
        const noEmulator = Array.isArray(status.emulatorsInScene) && status.emulatorsInScene.length === 0;
        if (noEmulator || Date.now() - playingSince > PLAYMODE_ATTACH_GRACE_MS) {
          return { error: status.hint || "No emulator is driving the avatar." };
        }
      }
    }
    // A null status is the bridge dropping during the play-mode domain reload: keep polling.
    await sleep(PLAYMODE_POLL_INTERVAL_MS);
  }
  const waited = Math.round(PLAYMODE_TIMEOUT_MS / 1000);
  return {
    error:
      `The avatar emulator was not ready after ${waited}s` +
      (last?.hint ? `: ${last.hint}` : ". Unity may still be entering play mode; raise UNITY_VRC_PLAYMODE_TIMEOUT for slow projects."),
  };
}

/**
 * Test an avatar in play mode: optionally enter play mode, set parameters and gestures through
 * Gesture Manager or Av3Emulator, let the animator settle, read the values back, and capture it.
 * @param {object} [params] - Parameters: avatarPath, parameters, gestureLeft, gestureRight,
 *   enterPlayMode (default true), settleMs (default 1000), capture (default true), view, width, height
 * @returns {Promise<object>} { success, data: { ..., base64? } } or a failure with notReady when play mode or the emulator is missing.
 */
export async function vrcPlaymodeTest(params = {}) {
  const statusArgs = pick(params, ["avatarPath"]);
  const setArgs = pick(params, PLAYMODE_SET_KEYS);
  const wantsSet = Object.keys(setArgs).some((key) => key !== "avatarPath");
  const deadline = Date.now() + PLAYMODE_TIMEOUT_MS;

  const first = await sendCommand("vrc/avatar/playmode/status", statusArgs);
  let status = pluginData(first);
  if (!status || looksLikeErrorObject(status)) return first;

  let enteredPlayMode = false;
  if (status.ready !== true) {
    if (status.isPlaying !== true) {
      if (params.enterPlayMode === false) {
        return notReady(status.hint || "Not in play mode.", { emulatorsInScene: status.emulatorsInScene });
      }
      if (status.compileErrors === true) return notReady(status.hint);
      if (Array.isArray(status.emulatorsInScene) && status.emulatorsInScene.length === 0) {
        return notReady(status.hint, { emulatorsInScene: [] });
      }
      // The play-mode domain reload can evict this ticket after the switch happened;
      // the status polling below is what confirms it either way.
      await sendCommand("editor/play-mode", { action: "play" });
      enteredPlayMode = true;
    }
    const waited = await waitForEmulator(statusArgs, deadline, Date.now());
    if (waited.error) return notReady(waited.error, { enteredPlayMode });
    status = waited.status;
  }

  const data = { emulator: status.emulator, avatar: status.avatar, enteredPlayMode };

  if (wantsSet) {
    let set = pluginData(await sendCommand("vrc/avatar/playmode/set", setArgs));
    while ((!set || set.notReady === true) && Date.now() < deadline) {
      await sleep(PLAYMODE_POLL_INTERVAL_MS);
      set = pluginData(await sendCommand("vrc/avatar/playmode/set", setArgs));
    }
    if (!set || looksLikeErrorObject(set)) {
      return { success: false, error: set?.error || "Setting the parameters failed.", errors: set?.errors, enteredPlayMode };
    }
    data.applied = set.applied;

    const settleMs = Number.isFinite(params.settleMs) ? Math.min(Math.max(params.settleMs, 0), 10000) : 1000;
    await sleep(settleMs);

    // Read the values back: a layer or another script can drive a parameter straight back.
    const names = (set.applied || []).map((entry) => entry.name);
    const readback = pluginData(await sendCommand("vrc/avatar/playmode/status", { ...statusArgs, names }));
    if (readback?.parameters) data.parameters = readback.parameters;
  }

  if (params.capture !== false) {
    const capture = pluginData(
      await sendCommand("vrc/avatar/playmode/capture", pick(params, ["avatarPath", "view", "width", "height"]))
    );
    if (!capture || looksLikeErrorObject(capture)) {
      data.captureError = capture?.error || "Capture failed.";
    } else {
      data.capture = { view: capture.view, width: capture.width, height: capture.height };
      // At the top of data, where the tool turns it into an image block.
      data.base64 = capture.base64;
    }
  }
  return { success: true, data };
}

// ─── UdonSharp ───
// Writing a script starts a compile and a domain reload; the behaviour class only exists
// afterwards. Attaching is therefore retried while the plugin answers "pending" or the
// bridge is down for the reload.
const UDONSHARP_POLL_INTERVAL_MS = 2000;
const UDONSHARP_TIMEOUT_MS = Number(process.env.UNITY_VRC_UDONSHARP_TIMEOUT || 180000);

async function attachWhenCompiled(args) {
  const deadline = Date.now() + UDONSHARP_TIMEOUT_MS;
  while (true) {
    const attached = await sendCommand("vrc/world/udonsharp/attach", args);
    const data = pluginData(attached);
    // Anything but "pending" or a dropped bridge is the final answer.
    if (data && data.pending !== true) return looksLikeErrorObject(data) ? { success: false, ...data } : data;
    if (Date.now() >= deadline) {
      return { ...(data ?? { success: false, error: attached?.error }), pending: true, timedOut: true };
    }
    await sleep(UDONSHARP_POLL_INTERVAL_MS);
  }
}

/**
 * Attach an UdonSharp behaviour to a GameObject, waiting while Unity compiles it.
 * @param {object} [params] - Parameters: programAssetPath, scriptPath, className, targetPath, port
 * @returns {Promise<object>}
 */
export async function vrcUdonSharpAttach(params = {}) {
  const attached = await attachWhenCompiled(params);
  if (attached.success !== false) return { success: true, data: attached };
  if (!attached.timedOut) return { success: false, error: attached.error, data: attached };
  const waited = Math.round(UDONSHARP_TIMEOUT_MS / 1000);
  return { success: false, error: `Unity was still compiling after ${waited}s; try again once compilation finishes.`, data: attached };
}

/**
 * Create an UdonSharp behaviour (script + program asset) and optionally attach it once compiled.
 * @param {object} [params] - Parameters: path, className, content, overwrite, attachTo, port
 * @returns {Promise<object>}
 */
export async function vrcUdonSharpCreate(params = {}) {
  const { attachTo, ...createArgs } = params;
  const created = await sendCommand("vrc/world/udonsharp/create", createArgs, params?.port);
  const data = pluginData(created);
  if (!attachTo || !data || looksLikeErrorObject(data)) return created;

  // Give Unity a moment to start compiling the new script before the first try.
  if (data.compilePending !== false) await sleep(UDONSHARP_POLL_INTERVAL_MS);
  const attach = await attachWhenCompiled({ programAssetPath: data.programAssetPath, targetPath: attachTo });
  // The plugin's "attach it once compiled" hint is handled here.
  const { hint, ...createdData } = data;
  const result = { ...createdData, compilePending: attach.pending === true, attach };
  if (attach.success !== false) return { success: true, data: result };

  const waited = Math.round(UDONSHARP_TIMEOUT_MS / 1000);
  const reason = attach.timedOut
    ? `Unity was still compiling after ${waited}s. Attach it with unity_vrc_udonsharp_attach once compilation finishes.`
    : attach.error;
  return { success: false, error: `Created ${data.scriptPath} and ${data.programAssetPath}, but attaching failed: ${reason}`, data: result };
}

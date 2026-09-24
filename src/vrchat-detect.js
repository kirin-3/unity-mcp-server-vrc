// VRChat Project & Ecosystem Detection (Filesystem + Cache)
import fs from "fs";
import path from "path";
import { pluginSupports } from "./capabilities.js";

const AVATARS_PACKAGE = "com.vrchat.avatars";
const WORLDS_PACKAGE = "com.vrchat.worlds";

const ECOSYSTEM_PACKAGES = [
  { key: "modularAvatar", packageId: "nadena.dev.modular-avatar" },
  { key: "ndmf", packageId: "nadena.dev.ndmf" },
  { key: "vrcfury", packageId: "com.vrcfury.vrcfury" },
  { key: "d4rkOptimizer", packageId: "d4rkpl4y3r.d4rkavataroptimizer" },
  { key: "vrWorldToolkit", packageId: "dev.onevr.vrworldtoolkit" },
];

/** Cache of detected context by instance port: port -> context */
const _detectionCache = new Map();

/**
 * Get cached detection for a port, if any.
 * @param {number} port
 * @returns {object|null}
 */
export function getCachedVRChatContext(port) {
  return _detectionCache.get(port) || null;
}

/**
 * Set cached detection for a port.
 * @param {number} port
 * @param {object} context
 */
export function setCachedVRChatContext(port, context) {
  _detectionCache.set(port, context);
}

/**
 * Invalidate detection cache for a port (or all if omitted).
 * @param {number} [port]
 */
export function invalidateVRChatContext(port) {
  if (port !== undefined) {
    _detectionCache.delete(port);
  } else {
    _detectionCache.clear();
  }
}

/**
 * Clear the entire detection cache.
 */
export function clearVRChatContextCache() {
  _detectionCache.clear();
}

/**
 * Detect VRChat project type, SDK version, and ecosystem packages from filesystem.
 * @param {string} projectPath Path to the Unity project root.
 * @returns {object} { projectType, sdkVersion, packages }
 */
export function detectVRChatContext(projectPath) {
  const emptyContext = {
    projectType: "none",
    sdkVersion: null,
    packages: {
      modularAvatar: { available: false, version: null },
      ndmf: { available: false, version: null },
      vrcfury: { available: false, version: null },
      d4rkOptimizer: { available: false, version: null },
      vrWorldToolkit: { available: false, version: null },
      poiyomi: { available: false, version: null },
    },
  };

  if (!projectPath || typeof projectPath !== "string") {
    return emptyContext;
  }

  try {
    if (!fs.existsSync(projectPath)) {
      return emptyContext;
    }
  } catch {
    return emptyContext;
  }

  const packagesDir = path.join(projectPath, "Packages");
  let hasPackagesDir = false;
  try {
    hasPackagesDir = fs.existsSync(packagesDir) && fs.statSync(packagesDir).isDirectory();
  } catch {
    hasPackagesDir = false;
  }

  if (!hasPackagesDir) {
    return emptyContext;
  }

  // Load package manifest files if present
  const vpmManifest = readJsonSafe(path.join(packagesDir, "vpm-manifest.json"));
  const manifest = readJsonSafe(path.join(packagesDir, "manifest.json"));
  const packagesLock = readJsonSafe(path.join(packagesDir, "packages-lock.json"));

  // 1. Detect Project Type
  let projectType = "none";
  let sdkVersion = null;

  const hasAvatarPkg = hasPackage(packagesDir, AVATARS_PACKAGE, vpmManifest, manifest, packagesLock);
  const hasWorldPkg = hasPackage(packagesDir, WORLDS_PACKAGE, vpmManifest, manifest, packagesLock);

  if (hasAvatarPkg) {
    projectType = "avatar";
    sdkVersion = getPackageVersion(packagesDir, AVATARS_PACKAGE, vpmManifest, packagesLock);
  } else if (hasWorldPkg) {
    projectType = "world";
    sdkVersion = getPackageVersion(packagesDir, WORLDS_PACKAGE, vpmManifest, packagesLock);
  }

  // 2. Detect Ecosystem Packages
  const packages = {};
  for (const { key, packageId } of ECOSYSTEM_PACKAGES) {
    const available = hasPackage(packagesDir, packageId, vpmManifest, manifest, packagesLock);
    const version = available
      ? getPackageVersion(packagesDir, packageId, vpmManifest, packagesLock)
      : null;
    packages[key] = { available, version };
  }

  // 3. Detect Poiyomi via Asset Folder
  const poiyomi = detectPoiyomiFs(projectPath);
  packages.poiyomi = poiyomi;

  return {
    projectType,
    sdkVersion,
    packages,
  };
}

/**
 * Resolve project context for a given instance. Uses cache if available,
 * otherwise runs filesystem detection and caches the result.
 * @param {object} instance Instance info with port and projectPath.
 * @param {object} [options]
 * @param {boolean} [options.forceRefresh=false]
 * @returns {object}
 */
export function resolveVRChatContext(instance, { forceRefresh = false } = {}) {
  if (!instance) {
    return detectVRChatContext(null);
  }

  // If the instance's plugin reports a protocolVersion that does not support VRCHAT_ROUTES,
  // VRChat routes cannot be served on this instance.
  if (instance.protocolVersion !== undefined && !pluginSupports(instance, "VRCHAT_ROUTES")) {
    return detectVRChatContext(null);
  }

  if (!forceRefresh && instance.port && _detectionCache.has(instance.port)) {
    return _detectionCache.get(instance.port);
  }

  const context = detectVRChatContext(instance.projectPath);
  if (instance.port) {
    _detectionCache.set(instance.port, context);
  }
  return context;
}

// ─── Helpers ───

function readJsonSafe(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const text = fs.readFileSync(filePath, "utf8");
      return JSON.parse(text);
    }
  } catch {}
  return null;
}

function hasPackage(packagesDir, packageId, vpmManifest, manifest, packagesLock) {
  // Check directory
  try {
    if (fs.existsSync(path.join(packagesDir, packageId))) return true;
  } catch {}

  // Check vpm-manifest.json
  if (vpmManifest) {
    if (vpmManifest.dependencies && vpmManifest.dependencies[packageId]) return true;
    if (vpmManifest.locked && vpmManifest.locked[packageId]) return true;
  }

  // Check manifest.json
  if (manifest && manifest.dependencies && manifest.dependencies[packageId]) {
    return true;
  }

  // Check packages-lock.json
  if (packagesLock && packagesLock.dependencies && packagesLock.dependencies[packageId]) {
    return true;
  }

  return false;
}

function getPackageVersion(packagesDir, packageId, vpmManifest, packagesLock) {
  // Try Packages/<packageId>/package.json
  try {
    const pkgJsonPath = path.join(packagesDir, packageId, "package.json");
    if (fs.existsSync(pkgJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
      if (pkg.version) return pkg.version;
    }
  } catch {}

  // Try vpm-manifest.json
  if (vpmManifest) {
    if (vpmManifest.locked && vpmManifest.locked[packageId]?.version) {
      return vpmManifest.locked[packageId].version;
    }
    if (vpmManifest.dependencies && vpmManifest.dependencies[packageId]?.version) {
      return vpmManifest.dependencies[packageId].version;
    }
  }

  // Try packages-lock.json
  if (packagesLock && packagesLock.dependencies && packagesLock.dependencies[packageId]?.version) {
    return packagesLock.dependencies[packageId].version;
  }

  return null;
}

function detectPoiyomiFs(projectPath) {
  try {
    const assetsDir = path.join(projectPath, "Assets");
    let poiDir = path.join(assetsDir, "_PoiyomiShaders");
    if (!fs.existsSync(poiDir)) {
      poiDir = path.join(assetsDir, "Poiyomi");
    }

    if (!fs.existsSync(poiDir)) {
      return { available: false, version: null };
    }

    // Try reading VERSION.txt
    const versionTxt = path.join(poiDir, "TPS", "VERSION.txt");
    if (fs.existsSync(versionTxt)) {
      const ver = fs.readFileSync(versionTxt, "utf8").trim();
      if (ver) return { available: true, version: ver };
    }

    // Try reading shader files to find master label
    const shaderFiles = findShaderFiles(poiDir, 5);
    for (const file of shaderFiles) {
      try {
        const text = fs.readFileSync(file, "utf8");
        const match = text.match(/shader_master_label\s*\([^,]*,\s*"(?:[^"]*?)(?:Poiyomi\s*(?:Toon\s*)?V?|V)\s*([0-9]+(?:\.[0-9]+)+)/i);
        if (match) {
          return { available: true, version: match[1] };
        }
      } catch {}
    }

    return { available: true, version: null };
  } catch {
    return { available: false, version: null };
  }
}

function findShaderFiles(dir, maxFiles) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findShaderFiles(full, maxFiles - results.length));
        if (results.length >= maxFiles) break;
      } else if (entry.name.endsWith(".shader")) {
        results.push(full);
        if (results.length >= maxFiles) break;
      }
    }
  } catch {}
  return results;
}

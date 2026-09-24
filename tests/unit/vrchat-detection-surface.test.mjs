import { test, describe, after } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { PLUGIN_FEATURES, pluginSupports } from "../../src/capabilities.js";
import {
  detectVRChatContext,
  resolveVRChatContext,
  getCachedVRChatContext,
  setCachedVRChatContext,
  invalidateVRChatContext,
  clearVRChatContextCache,
} from "../../src/vrchat-detect.js";
import {
  filterToolsForProject,
  checkToolProjectGate,
} from "../../src/vrchat-surface.js";
import { vrchatTools } from "../../src/tools/vrchat-tools.js";
import { vrchatAvatarTools } from "../../src/tools/vrchat-avatar-tools.js";
import { vrchatWorldTools } from "../../src/tools/vrchat-world-tools.js";
import { vrchatShaderTools } from "../../src/tools/vrchat-shader-tools.js";

describe("VRChat capabilities and protocol version gate", () => {
  test("VRCHAT_ROUTES requires protocolVersion 2", () => {
    assert.equal(PLUGIN_FEATURES.VRCHAT_ROUTES, 2);
    assert.equal(pluginSupports({ protocolVersion: 2 }, "VRCHAT_ROUTES"), true);
    assert.equal(pluginSupports({ protocolVersion: 3 }, "VRCHAT_ROUTES"), true);
    assert.equal(pluginSupports({ protocolVersion: 1 }, "VRCHAT_ROUTES"), false);
    assert.equal(pluginSupports({ protocolVersion: 0 }, "VRCHAT_ROUTES"), false);
    assert.equal(pluginSupports({}, "VRCHAT_ROUTES"), false);
    assert.equal(pluginSupports(null, "VRCHAT_ROUTES"), false);
  });
});

describe("VRChat filesystem detection (synthetic fixtures)", () => {
  // Fixtures are built on disk instead of pointing at a developer's real projects,
  // so the suite is green on CI (and any machine) rather than only where those
  // projects happen to exist.
  const roots = [];
  function makeProject({ sdk, packages = {}, poiyomi = false }) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vrc-fixture-"));
    roots.push(root);
    const locked = {};
    if (sdk) locked[sdk] = { version: "3.7.0" };
    for (const [id, version] of Object.entries(packages)) locked[id] = { version };
    fs.mkdirSync(path.join(root, "Packages"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "Packages", "vpm-manifest.json"),
      JSON.stringify({ dependencies: {}, locked })
    );
    if (poiyomi) {
      fs.mkdirSync(path.join(root, "Assets", "_PoiyomiShaders", "TPS"), { recursive: true });
      fs.writeFileSync(path.join(root, "Assets", "_PoiyomiShaders", "TPS", "VERSION.txt"), "9.1.13");
    }
    return root;
  }

  after(() => {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  test("classifies avatar project correctly", () => {
    const ctx = detectVRChatContext(
      makeProject({
        sdk: "com.vrchat.avatars",
        packages: {
          "nadena.dev.modular-avatar": "1.10.0",
          "nadena.dev.ndmf": "1.5.0",
          "com.vrcfury.vrcfury": "1.900.0",
          "d4rkpl4y3r.d4rkavataroptimizer": "3.8.0",
        },
        poiyomi: true,
      })
    );
    assert.equal(ctx.projectType, "avatar");
    assert.equal(ctx.sdkVersion, "3.7.0");
    assert.equal(ctx.packages.modularAvatar.available, true);
    assert.equal(ctx.packages.modularAvatar.version, "1.10.0");
    assert.equal(ctx.packages.ndmf.available, true);
    assert.equal(ctx.packages.vrcfury.available, true);
    assert.equal(ctx.packages.d4rkOptimizer.available, true);
    assert.equal(ctx.packages.vrWorldToolkit.available, false);
    assert.equal(ctx.packages.vrWorldToolkit.version, null);
    assert.equal(ctx.packages.poiyomi.available, true);
    assert.equal(ctx.packages.poiyomi.version, "9.1.13");
  });

  test("classifies world project correctly", () => {
    const ctx = detectVRChatContext(
      makeProject({
        sdk: "com.vrchat.worlds",
        packages: { "dev.onevr.vrworldtoolkit": "1.2.0" },
        poiyomi: true,
      })
    );
    assert.equal(ctx.projectType, "world");
    assert.equal(ctx.sdkVersion, "3.7.0");
    assert.equal(ctx.packages.vrWorldToolkit.available, true);
    assert.equal(ctx.packages.vrWorldToolkit.version, "1.2.0");
    assert.equal(ctx.packages.modularAvatar.available, false);
    assert.equal(ctx.packages.modularAvatar.version, null);
    assert.equal(ctx.packages.ndmf.available, false);
    assert.equal(ctx.packages.vrcfury.available, false);
    assert.equal(ctx.packages.d4rkOptimizer.available, false);
    assert.equal(ctx.packages.poiyomi.available, true);
  });

  test("classifies non-VRChat project as none with all integrations unavailable", () => {
    const ctx = detectVRChatContext(makeProject({ sdk: null }));
    assert.equal(ctx.projectType, "none");
    assert.equal(ctx.sdkVersion, null);
    for (const key of ["modularAvatar", "ndmf", "vrcfury", "d4rkOptimizer", "vrWorldToolkit", "poiyomi"]) {
      assert.equal(ctx.packages[key].available, false);
      assert.equal(ctx.packages[key].version, null);
    }
  });

  test("caching per instance port and invalidation", () => {
    clearVRChatContextCache();
    assert.equal(getCachedVRChatContext(7890), null);

    const mockCtx1 = { projectType: "avatar", packages: {} };
    const mockCtx2 = { projectType: "world", packages: {} };

    setCachedVRChatContext(7890, mockCtx1);
    setCachedVRChatContext(7891, mockCtx2);

    assert.equal(getCachedVRChatContext(7890).projectType, "avatar");
    assert.equal(getCachedVRChatContext(7891).projectType, "world");

    invalidateVRChatContext(7890);
    assert.equal(getCachedVRChatContext(7890), null);
    assert.equal(getCachedVRChatContext(7891).projectType, "world");

    clearVRChatContextCache();
    assert.equal(getCachedVRChatContext(7891), null);
  });
});

describe("VRChat tool surface shaping", () => {
  const sampleTools = [
    { name: "unity_scene_info" }, // standard
    { name: "unity_gameobject_create" }, // standard
    { name: "unity_vrc_get_project_context", vrchatProjectType: "any" },
    { name: "unity_vrc_avatar_build_info", vrchatProjectType: "avatar" },
    { name: "unity_vrc_vrcfury_info", vrchatProjectType: "avatar", vrchatIntegration: "vrcfury" },
    { name: "unity_vrc_world_descriptor", vrchatProjectType: "world" },
  ];

  test("projectType: none advertises zero VRChat tools while preserving standard tools", () => {
    const filtered = filterToolsForProject(sampleTools, {
      projectType: "none",
      packages: {},
    });
    const names = filtered.map((t) => t.name);
    assert.deepEqual(names, ["unity_scene_info", "unity_gameobject_create"]);
  });

  test("avatar project advertises avatar tools, general VRChat tools, and no world tools", () => {
    const filtered = filterToolsForProject(sampleTools, {
      projectType: "avatar",
      packages: {
        vrcfury: { available: true },
      },
    });
    const names = filtered.map((t) => t.name);
    assert.ok(names.includes("unity_scene_info"));
    assert.ok(names.includes("unity_vrc_get_project_context"));
    assert.ok(names.includes("unity_vrc_avatar_build_info"));
    assert.ok(names.includes("unity_vrc_vrcfury_info"));
    assert.ok(!names.includes("unity_vrc_world_descriptor"), "no world tools in avatar surface");
  });

  test("avatar project without VRCFury omits VRCFury tools", () => {
    const filtered = filterToolsForProject(sampleTools, {
      projectType: "avatar",
      packages: {
        vrcfury: { available: false },
      },
    });
    const names = filtered.map((t) => t.name);
    assert.ok(names.includes("unity_vrc_avatar_build_info"));
    assert.ok(!names.includes("unity_vrc_vrcfury_info"), "VRCFury tool omitted when package absent");
  });

  test("world project advertises world tools, general VRChat tools, and no avatar tools", () => {
    const filtered = filterToolsForProject(sampleTools, {
      projectType: "world",
      packages: {},
    });
    const names = filtered.map((t) => t.name);
    assert.ok(names.includes("unity_scene_info"));
    assert.ok(names.includes("unity_vrc_get_project_context"));
    assert.ok(names.includes("unity_vrc_world_descriptor"));
    assert.ok(!names.includes("unity_vrc_avatar_build_info"), "no avatar tools in world surface");
    assert.ok(!names.includes("unity_vrc_vrcfury_info"), "no VRCFury tools in world surface");
  });

  test("call-time gate refuses wrong-project-type tool with error naming detected type", () => {
    const avatarTool = sampleTools.find((t) => t.name === "unity_vrc_avatar_build_info");
    const worldTool = sampleTools.find((t) => t.name === "unity_vrc_world_descriptor");
    const vrcfuryTool = sampleTools.find((t) => t.name === "unity_vrc_vrcfury_info");

    // World project calling avatar tool
    const res1 = checkToolProjectGate(avatarTool, { projectType: "world", packages: {} });
    assert.equal(res1.allowed, false);
    assert.ok(res1.reason.includes("world"), `Reason must name detected type: ${res1.reason}`);

    // Avatar project calling world tool
    const res2 = checkToolProjectGate(worldTool, { projectType: "avatar", packages: {} });
    assert.equal(res2.allowed, false);
    assert.ok(res2.reason.includes("avatar"), `Reason must name detected type: ${res2.reason}`);

    // Non-VRChat project calling VRChat tool
    const res3 = checkToolProjectGate(avatarTool, { projectType: "none", packages: {} });
    assert.equal(res3.allowed, false);
    assert.ok(res3.reason.includes("none"), `Reason must name detected type: ${res3.reason}`);

    // Missing integration
    const res4 = checkToolProjectGate(vrcfuryTool, {
      projectType: "avatar",
      packages: { vrcfury: { available: false } },
    });
    assert.equal(res4.allowed, false);
    assert.ok(res4.reason.includes("vrcfury"), `Reason must name missing integration: ${res4.reason}`);

    // Valid call succeeds
    const res5 = checkToolProjectGate(avatarTool, { projectType: "avatar", packages: {} });
    assert.equal(res5.allowed, true);
  });

  test("unknown project context defers to the plugin instead of refusing", () => {
    // A port-routed call can target an instance the server cannot inspect (not in the
    // registry, so no projectPath). Refusing there blocked every VRChat tool; the plugin
    // is authoritative at execution time, so the gate must stand down.
    const avatarTool = { name: "unity_vrc_avatar_performance", vrchatProjectType: "avatar" };
    assert.equal(checkToolProjectGate(avatarTool, null).allowed, true);
    assert.equal(checkToolProjectGate(avatarTool, undefined).allowed, true);
    // A context we *did* resolve still refuses.
    assert.equal(checkToolProjectGate(avatarTool, { projectType: "none", packages: {} }).allowed, false);
  });

  test("Task 9.1: No tool in the completed surface performs a VRChat upload or publish", () => {
    const allVrcTools = [
      ...vrchatTools,
      ...vrchatAvatarTools,
      ...vrchatWorldTools,
      ...vrchatShaderTools,
    ];
    for (const tool of allVrcTools) {
      assert.ok(!tool.name.includes("upload"), `Tool name '${tool.name}' must not include 'upload'`);
      assert.ok(!tool.name.includes("publish"), `Tool name '${tool.name}' must not include 'publish'`);
      assert.ok(
        !/uploads?\s+to\s+vrchat|publish(?:es)?\s+to\s+vrchat/i.test(tool.description),
        `Tool '${tool.name}' description must not advertise uploading/publishing to VRChat`
      );
    }
  });
});

describe("target instance follows the port override", () => {
  test("getTargetInstance prefers the per-request port over the agent selection", async () => {
    const { setPortOverride, clearPortOverride, getTargetInstance } = await import(
      "../../src/instance-discovery.js"
    );
    // No selection and no override: nothing to target.
    clearPortOverride();
    assert.equal(getTargetInstance(), null);

    // With an override, the target is that port even though nothing was selected —
    // previously this path answered null and refused every VRChat tool.
    setPortOverride(65123);
    assert.equal(getTargetInstance()?.port, 65123);
    clearPortOverride();
    assert.equal(getTargetInstance(), null);
  });
});

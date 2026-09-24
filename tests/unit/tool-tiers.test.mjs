// Unit tests for the two-tier tool system. The exact tier counts are pinned on purpose:
// the exposed surface is client-facing compatibility (issue #27 — oversized registries can
// break MCP clients). Adding/moving a tool must consciously update these numbers.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { splitToolTiers, HIDDEN_CATEGORIES, toolCategory } from "../../src/tool-tiers.js";
import { editorTools } from "../../src/tools/editor-tools.js";
import { umaTools } from "../../src/tools/uma-tools.js";
import { probuilderTools } from "../../src/tools/probuilder-tools.js";
import { MockBridge } from "../helpers/mock-bridge.mjs";
import { setPortOverride, clearPortOverride } from "../../src/instance-discovery.js";

describe("splitToolTiers on the real tool set", () => {
  const split = splitToolTiers([...editorTools, ...umaTools, ...probuilderTools]);

  test("tier counts are pinned (update deliberately when the surface changes)", () => {
    assert.equal(split.coreCount, 69, "core tier count");
    assert.equal(split.advancedCount, 269, "advanced tier count");
    assert.equal(
      split.coreCount + split.advancedCount,
      editorTools.length + umaTools.length + probuilderTools.length
    );
  });

  test("meta-tools are generated with strict-enough schemas", () => {
    const names = split.metaTools.map((t) => t.name);
    assert.deepEqual(names, ["unity_list_advanced_tools", "unity_advanced_tool"]);
    for (const tool of split.metaTools) {
      assert.equal(tool.inputSchema.type, "object");
      assert.equal(typeof tool.handler, "function");
    }
    const dispatcher = split.metaTools[1];
    assert.deepEqual(dispatcher.inputSchema.required, ["tool"]);
  });

  test("core tier keeps the daily-driver tools", () => {
    const coreNames = new Set(split.coreTools.map((t) => t.name));
    for (const name of [
      "unity_editor_state", "unity_scene_hierarchy", "unity_gameobject_create",
      "unity_component_set_property", "unity_execute_code", "unity_console_log",
      "unity_get_compilation_errors", "unity_play_mode", "unity_search_assets",
      "unity_undo_last",
    ]) {
      assert.ok(coreNames.has(name), `${name} stays core`);
    }
  });

  test("no tool is lost or duplicated across tiers", () => {
    const all = [...editorTools, ...umaTools, ...probuilderTools];
    const seen = new Set();
    for (const t of all) {
      assert.ok(!seen.has(t.name), `duplicate tool definition: ${t.name}`);
      seen.add(t.name);
    }
    const coreNames = new Set(split.coreTools.map((t) => t.name));
    let advanced = 0;
    for (const t of all) if (!coreNames.has(t.name)) advanced++;
    assert.equal(advanced, split.advancedCount);
  });

  test("every tool definition has the {name, description, inputSchema, handler} contract", () => {
    for (const t of [...editorTools, ...umaTools, ...probuilderTools]) {
      assert.ok(/^unity_[a-z0-9_]+$/.test(t.name), `name convention: ${t.name}`);
      assert.equal(typeof t.description, "string");
      assert.equal(t.inputSchema?.type, "object", `${t.name} schema root`);
      assert.equal(typeof t.handler, "function", `${t.name} handler`);
    }
  });

  // Strict-client schema shaping must hold for ADVANCED tools too, not only the exposed
  // core surface (the protocol test only sees the ~80 exposed tools). A batch of advanced
  // tools once shipped `value: { description }` with no `type`, which a strict validator
  // rejects — this guards the whole 346-tool surface, recursively.
  test("every property of every tool (all tiers) is explicitly type-shaped", () => {
    const isShaped = (s) =>
      s && typeof s === "object" &&
      ("type" in s || "enum" in s || "const" in s || "anyOf" in s || "oneOf" in s || "allOf" in s || "$ref" in s);
    const walk = (toolName, path, schema, out) => {
      if (!isShaped(schema)) { out.push(`${toolName}.${path}`); return; }
      for (const [k, sub] of Object.entries(schema.properties || {})) walk(toolName, `${path}.${k}`, sub, out);
      if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items))
        walk(toolName, `${path}[]`, schema.items, out);
    };
    const violations = [];
    for (const t of [...editorTools, ...umaTools, ...probuilderTools])
      for (const [prop, schema] of Object.entries(t.inputSchema?.properties || {}))
        walk(t.name, prop, schema, violations);
    assert.deepEqual(violations, [], `${violations.length} untyped properties: ${violations.slice(0, 10).join(", ")}`);
  });

  test("all 14 ProBuilder tools land in the advanced tier under the 'probuilder' category", () => {
    const coreNames = new Set(split.coreTools.map((t) => t.name));
    assert.equal(probuilderTools.length, 14, "ProBuilder tool count");
    for (const t of probuilderTools) {
      assert.ok(!coreNames.has(t.name), `${t.name} must be advanced, not core`);
      const category = t.name.replace(/^unity_/, "").split("_")[0];
      assert.equal(category, "probuilder", `${t.name} category`);
    }
  });

  test("ProBuilder tool names derive to the exact plugin routes (lazy-load parity)", () => {
    // Mirrors toolNameToRoute in tool-tiers.js: unity_probuilder_create_shape → probuilder/create-shape.
    const derive = (name) => {
      const parts = name.replace(/^unity_/, "").split("_");
      return `${parts[0]}/${parts.slice(1).join("-")}`;
    };
    const expected = new Set([
      "probuilder/create-shape", "probuilder/info", "probuilder/extrude-faces",
      "probuilder/bevel-edges", "probuilder/subdivide", "probuilder/delete-faces",
      "probuilder/translate-faces", "probuilder/flip-normals", "probuilder/set-face-material",
      "probuilder/boolean", "probuilder/combine", "probuilder/probuilderize",
      "probuilder/center-pivot", "probuilder/export-mesh",
    ]);
    const derived = new Set(probuilderTools.map((t) => derive(t.name)));
    assert.deepEqual(derived, expected, "derived routes must match the plugin's registered routes");
  });
});

describe("splitToolTiers on synthetic input", () => {
  test("unknown names fall into the advanced tier", () => {
    const fake = [
      { name: "unity_editor_state", description: "core-listed", inputSchema: { type: "object" }, handler: async () => "" },
      { name: "unity_experimental_new_thing", description: "not core-listed", inputSchema: { type: "object" }, handler: async () => "" },
    ];
    const split = splitToolTiers(fake);
    assert.equal(split.coreCount, 1);
    assert.equal(split.advancedCount, 1);
    assert.equal(split.coreTools[0].name, "unity_editor_state");
  });
});

// VRChat-focused surface: whole families stop being advertised but stay reachable
// through the advanced tier. Hidden ≠ removed — every assertion here pairs a
// "not advertised" check with a "still present" check on the same tool set.
describe("hidden tool families (VRChat-focused surface)", () => {
  const all = [...editorTools, ...umaTools, ...probuilderTools];
  const split = splitToolTiers(all);
  const hiddenTools = all.filter((t) => HIDDEN_CATEGORIES.has(toolCategory(t.name)));

  test("HIDDEN_CATEGORIES covers exactly the VRChat-unused families and is exported", () => {
    assert.deepEqual(
      [...HIDDEN_CATEGORIES].sort(),
      ["amplify", "input", "mppm", "navmesh", "scenario", "uma"]
    );
  });

  test("no hidden-category tool appears in the advertised (core) list", () => {
    assert.ok(hiddenTools.length > 0, "the real tool set contains hidden tools");
    for (const t of split.coreTools) {
      assert.ok(
        !HIDDEN_CATEGORIES.has(toolCategory(t.name)),
        `${t.name} is hidden-family but was advertised as core`
      );
    }
  });

  test("hiding drops nothing: advancedCount grows by exactly the hidden count", () => {
    assert.equal(hiddenTools.length, 62, "15 uma + 23 amplify + 10 mppm + 8 input + 6 navmesh");
    const rest = all.filter((t) => !HIDDEN_CATEGORIES.has(toolCategory(t.name)));
    const withoutHidden = splitToolTiers(rest);
    assert.equal(split.advancedCount - withoutHidden.advancedCount, hiddenTools.length);
    assert.equal(split.coreCount, withoutHidden.coreCount, "no non-hidden tool changed tiers");
    assert.equal(split.coreCount + split.advancedCount, all.length, "the registry is conserved");
  });
});

// Handler-level reachability: hidden tools must still execute and stay discoverable.
// The catalog views and dispatchers run against an in-process MockBridge so these
// stay unit-speed while exercising the real handler code paths.
describe("hidden tool families remain reachable (mock bridge)", () => {
  const split = splitToolTiers([...editorTools, ...umaTools, ...probuilderTools]);
  const hiddenTools = [...editorTools, ...umaTools, ...probuilderTools].filter((t) =>
    HIDDEN_CATEGORIES.has(toolCategory(t.name))
  );
  /** @type {MockBridge} */ let bridge;

  before(async () => {
    bridge = new MockBridge();
    // Mirror a real plugin's route advertisement: terrain is cached (skipped),
    // uma/list-uma-materials resolves to an already-cached tool name (skipped too).
    bridge.on("_meta/routes", () => ({ routes: ["terrain/list", "uma/list-uma-materials"] }));
    await bridge.start();
    setPortOverride(bridge.port);
  });

  after(async () => {
    clearPortOverride();
    await bridge.stop();
  });

  test("every hidden tool remains present in the advanced map", async () => {
    const catalog = split.metaTools.find((t) => t.name === "unity_list_advanced_tools");
    for (const t of hiddenTools) {
      const payload = JSON.parse(await catalog.handler({ tool: t.name }));
      assert.equal(payload.name, t.name, `${t.name} resolvable in the advanced map`);
      assert.equal(payload.inputSchema?.type, "object", `${t.name} keeps its schema`);
      assert.equal(payload.error, undefined);
    }
  });

  test("a hidden tool still executes through unity_advanced_tool with an unchanged result shape", async () => {
    const dispatcher = split.metaTools.find((t) => t.name === "unity_advanced_tool");
    const params = { fbxPath: "Assets/Models/Armor.fbx" };
    const payload = JSON.parse(await dispatcher.handler({ tool: "unity_uma_inspect_fbx", params }));
    assert.equal(payload.success, true, "bridge envelope success unchanged");
    assert.equal(payload.data.route, "uma/inspect-fbx", "same route the tool always called");
    assert.deepEqual(payload.data.echo, params, "params forwarded intact");
  });

  test("hidden tools are still returned by the catalog search view", async () => {
    const catalog = split.metaTools.find((t) => t.name === "unity_list_advanced_tools");
    const payload = JSON.parse(await catalog.handler({ search: "amplify create shader" }));
    assert.ok(payload.totalMatches >= 1, "search still matches hidden tools");
    assert.ok(
      payload.results.some((r) => r.name === "unity_amplify_create_shader"),
      "hidden tool listed by search with its brief"
    );
    assert.ok(payload.results[0].brief, "entries carry a description");
  });

  test("hidden tools are still returned by the catalog category views", async () => {
    const catalog = split.metaTools.find((t) => t.name === "unity_list_advanced_tools");
    // "scenario" has no cached tools — it exists for lazy-loaded plugin routes.
    for (const cat of ["uma", "amplify", "mppm", "input", "navmesh"]) {
      const payload = JSON.parse(await catalog.handler({ category: cat }));
      assert.ok(Array.isArray(payload.tools) && payload.tools.length > 0, `category ${cat} still lists tools`);
      for (const entry of payload.tools) {
        assert.equal(toolCategory(entry.name), cat);
        assert.ok(entry.brief, `${entry.name} keeps its brief`);
      }
    }
  });
});

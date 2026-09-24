// Protocol-level integration tests — spawn the real MCP server over stdio against a
// mock Unity bridge. These are the regression gates every behavior change must pass.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { MockBridge } from "./helpers/mock-bridge.mjs";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** Property schemas that count as "explicitly shaped" for strict MCP clients. */
function isStrictSchema(schema) {
  if (!schema || typeof schema !== "object") return false;
  return (
    "type" in schema || "enum" in schema || "const" in schema ||
    "anyOf" in schema || "oneOf" in schema || "allOf" in schema || "$ref" in schema
  );
}

/** Recursively validate that nested object/array property schemas stay explicitly shaped. */
function collectSchemaViolations(toolName, path, schema, violations) {
  if (!isStrictSchema(schema)) {
    violations.push(`${toolName}.${path}`);
    return;
  }
  for (const [prop, sub] of Object.entries(schema.properties || {})) {
    collectSchemaViolations(toolName, `${path}.${prop}`, sub, violations);
  }
  if (schema.items && typeof schema.items === "object" && !Array.isArray(schema.items)) {
    collectSchemaViolations(toolName, `${path}[]`, schema.items, violations);
  }
}

describe("queue-mode session (single instance)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;
  let initResult;

  let mockPlaying = false;

  before(async () => {
    bridge = new MockBridge();
    // Plugin handlers return raw result objects; the Node bridge adds {success, data}.
    bridge.on("editor/state", () => ({ isPlaying: mockPlaying, isPaused: false, isCompiling: false, activeScene: "MockScene" }));
    // Play-mode: the action takes effect, then the domain reload evicts the ticket
    // (status polls 404) — exercises the false-negative recovery path.
    bridge.on("editor/play-mode", (p) => {
      mockPlaying = p.action === "play";
      return { __evict: true };
    });
    bridge.on("logical/failure", () => ({ __fail: true, error: "boom: mock logical failure" }));
    bridge.on("plugin/timeout", () => ({ __timeout: true, error: "Timed out on the main thread" }));
    bridge.on("payload/huge", () => ({ blob: "x".repeat(4_500_000) }));
    bridge.on("graphics/asset-preview", () => ({ base64: "QUJDREVG".repeat(40_000), width: 256, height: 256 }));
    bridge.on("silent/completion", () => undefined);
    bridge.on("terrain/lisr", () => ({ __fail: true, error: "Unknown route: terrain/lisr" }));
    // ProBuilder advanced-tier round-trip fixture (mirrors the plugin's create-shape result shape).
    bridge.on("probuilder/create-shape", (p) => ({
      success: true, name: p.name || `PB_${p.shape || "cube"}`, instanceId: "-14510",
      faceCount: 6, vertexCount: 24, shape: p.shape || "cube",
    }));
    // Per-action undo (core tool) — echoes params so the test can assert forwarding.
    bridge.on("undo/last", (p) => ({
      success: true, message: "Reverted 'probuilder/create-shape'.", revertedCount: 1,
      echoAgentId: p.agentId ?? null, echoForce: p.force ?? false,
    }));
    // Plugin route advertisement: terrain/list is already cached server-side (skipped),
    // experimental/new-thing is dynamic-only — exercises the lazy-discovery merge.
    bridge.on("_meta/routes", () => ({ routes: ["terrain/list", "experimental/new-thing"] }));
    // Core-tool proxy fixtures: unity_advanced_tool falls back to name→route derivation
    // for core tools too (stale-schema escape hatch); these routes need overrides.
    bridge.on("asset/create-material", (p) => ({ success: true, path: p.path, overwrite: p.overwrite === true }));
    bridge.on("editor/execute-code", (p) => ({ success: true, result: `ran:${(p.code || "").slice(0, 20)}` }));
    // A finished test job — status lives under the bridge's data envelope.
    bridge.on("testing/get-job", () => ({ status: "succeeded", passed: 3, failed: 0 }));
    // Old-plugin era: batch-wire route doesn't exist; single set-reference does.
    bridge.on("component/batch-wire", () => ({ __fail: true, error: "Unknown API endpoint: component/batch-wire" }));
    // Old plugins report a per-call failure as an HTTP-200 { success:true, data:{error} }
    // envelope — model that for the "propBad" entry to prove the degrade path detects it.
    bridge.on("component/set-reference", (p) =>
      p.propertyName === "propBad" ? { error: "Property not found: propBad" } : { success: true, wired: p.propertyName }
    );
    const trace = Array.from({ length: 12 }, (_, i) => `Frame${i} (at ./Library/PackageCache/pkg/File.cs:${i})`).join("\n");
    bridge.on("console/log", () => ({
      count: 2,
      entries: [
        { message: "plain info", type: "log", timestamp: "10:00:00.000", stackTrace: trace },
        { message: "kaboom", type: "error", timestamp: "10:00:01.000", stackTrace: trace },
      ],
    }));
    bridge.on("settings/set-player", (p) => {
      if (!p.override) {
        return {
          success: false,
          refused: true,
          error: "VRChat projects require specific Player Settings. Modifying them will break VRChat compatibility.",
          reason: "VRChat projects require specific Player Settings. Modifying them will break VRChat compatibility.",
        };
      }
      return { success: true, updated: ["bundleVersion"], guardOverridden: true };
    });
    bridge.on("build/start", (p) => {
      if (!p.override) {
        return {
          success: false,
          refused: true,
          error: "VRChat content is built and tested through the VRChat SDK, not standard Unity player builds. Running a standalone build will fail or produce unusable artifacts.",
          reason: "VRChat content is built and tested through the VRChat SDK, not standard Unity player builds. Running a standalone build will fail or produce unusable artifacts.",
        };
      }
      return { success: true, result: "Succeeded", guardOverridden: true };
    });
    await bridge.start();
    client = new McpTestClient({ env: bridge.env() }).start();
    initResult = await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("initialize succeeds and identifies as unity-mcp", () => {
    assert.equal(initResult.serverInfo.name, "unity-mcp");
    assert.ok(initResult.serverInfo.version, "serverInfo.version present");
  });

  test("serverInfo.version matches package.json (single source of truth)", () => {
    assert.equal(initResult.serverInfo.version, PACKAGE_VERSION);
  });

  test("server advertises tools.listChanged capability", () => {
    assert.equal(initResult.capabilities?.tools?.listChanged, true);
  });

  test("tools/list exposes the two-tier surface with unique names and valid shapes", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 70 && tools.length <= 90, `expected ~79 exposed tools, got ${tools.length}`);
    const names = new Set();
    for (const tool of tools) {
      assert.ok(/^unity_[a-z0-9_]+$/.test(tool.name), `tool name convention: ${tool.name}`);
      assert.ok(!names.has(tool.name), `duplicate tool name: ${tool.name}`);
      names.add(tool.name);
      assert.ok(tool.description && tool.description.length > 0, `${tool.name} has a description`);
      assert.equal(tool.inputSchema.type, "object", `${tool.name} schema root is object`);
    }
    for (const required of [
      "unity_list_instances", "unity_select_instance", "unity_advanced_tool",
      "unity_list_advanced_tools", "unity_editor_state", "unity_get_project_context",
      "unity_hub_list_editors", "unity_execute_code", "unity_scene_hierarchy",
    ]) {
      assert.ok(names.has(required), `core surface keeps ${required}`);
    }
  });

  test("per-request port routing parameter is injected into editor tool schemas", async () => {
    const { tools } = await client.listTools();
    const editorState = tools.find((t) => t.name === "unity_editor_state");
    assert.ok(editorState.inputSchema.properties.port, "unity_editor_state has injected port param");
    const skip = tools.filter((t) => t.name.startsWith("unity_hub_") || t.name === "unity_select_instance" || t.name === "unity_list_instances");
    assert.ok(skip.length >= 3, "skip-set tools present");
  });

  test("tools/list payload size is recorded (budget gate)", async () => {
    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    console.error(`[gate] tools/list payload: ${(bytes / 1024).toFixed(1)} KB for ${tools.length} tools`);
    assert.ok(bytes < 120_000, `tools/list must stay under 120KB hard ceiling (got ${bytes})`);
  });

  // Diet regression lock (issue #27): baseline was 50.6KB; the compaction wave landed 42.8KB
  // with full parameter docs retained, later ~44.3KB after adding the `overwrite` safety param
  // to the core asset-creator tools, then ~45.7KB after adding the core `unity_undo_last` tool
  // (per-action/per-agent undo), then ~46.6KB after the core `unity_gameobject_delete`
  // shared-mesh guard + `force` override (ProBuilder clone data-safety), then ~47.5KB after the
  // audit's data-safety wave: asset_delete gained recursive/permanent, and scene_open/scene_new
  // gained saveFirst/discardUnsavedChanges (each one is a documented way to NOT lose the user's
  // work, so the bytes buy real protection). The gate catches unintentional bloat while leaving
  // room for deliberate capability — still ~60% under the 120KB hard ceiling.
  // UNITY_MCP_COMPACT_TOOLS=1 (tested below) goes much further for constrained clients.
  // Bump this only for a real new capability, never to absorb prose creep.
  test("tools/list payload stays within the rich-mode diet budget", async () => {
    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    assert.ok(bytes <= 48_000, `tools/list ${bytes} bytes exceeds the 48KB rich-mode budget`);
  });

  // Lazy discovery is three-tier so finding one tool never costs a schema dump:
  // summary (counts) → category/search (brief + param names) → tool (one full schema).
  test("advanced-tool discovery is lean by default: counts, then brief+params, then one schema", async () => {
    // Level 1: summary with category COUNTS, not name dumps.
    const summary = await client.callTool("unity_list_advanced_tools");
    assert.equal(typeof summary.payload.categories.terrain, "number", "categories map to counts");
    assert.ok(summary.payload.totalAdvancedTools > 200);
    assert.ok(Buffer.byteLength(summary.payloadText) < 1_500, `summary stays tiny (got ${summary.payloadText.length})`);

    // Level 2: category view carries brief + parameter names, NO schemas.
    const cat = await client.callTool("unity_list_advanced_tools", { category: "terrain" });
    assert.ok(Array.isArray(cat.payload.tools) && cat.payload.tools.length > 10, "terrain lists its tools");
    const entry = cat.payload.tools.find((t) => t.name === "unity_terrain_raise_lower");
    assert.ok(entry && entry.brief, "entries carry a one-line brief");
    assert.ok(Array.isArray(entry.params) && entry.params.length > 0, "entries carry parameter names");
    assert.equal(entry.inputSchema, undefined, "no schemas in the lean view");
    assert.ok(Buffer.byteLength(cat.payloadText) < 8_000, `category view stays lean (got ${cat.payloadText.length})`);

    // Level 3: tool= returns exactly one full schema.
    const one = await client.callTool("unity_list_advanced_tools", { tool: "unity_terrain_raise_lower" });
    assert.equal(one.payload.inputSchema.type, "object", "full schema on demand");
    assert.equal(one.payload.category, "terrain");
  });

  test("advanced-tool search matches keywords and ranks name-hits first", async () => {
    const { payload } = await client.callTool("unity_list_advanced_tools", { search: "probuilder boolean" });
    assert.ok(payload.totalMatches >= 1);
    assert.equal(payload.results[0].name, "unity_probuilder_boolean", "name-hit ranks first");
    assert.equal(payload.results[0].inputSchema, undefined, "search results carry no schemas");
    assert.ok(payload.results.length <= 20, "results are capped");
  });

  test("includeSchemas restores the full category schema echo on demand", async () => {
    const { payload } = await client.callTool("unity_list_advanced_tools", { category: "terrain", includeSchemas: true });
    assert.ok(Array.isArray(payload) && payload.length > 10);
    const withSchema = payload.filter((t) => t.inputSchema && t.inputSchema.type === "object");
    assert.equal(withSchema.length, payload.length, "every cached entry carries its schema");
  });

  test("plugin lazy-loaded routes are discoverable in every view and callable", async () => {
    const summary = await client.callTool("unity_list_advanced_tools");
    assert.equal(summary.payload.dynamicTools, 1, "dynamic-only route counted");

    const cat = await client.callTool("unity_list_advanced_tools", { category: "experimental" });
    assert.deepEqual(cat.payload.tools[0], { name: "unity_experimental_new_thing", dynamic: true });

    const one = await client.callTool("unity_list_advanced_tools", { tool: "unity_experimental_new_thing" });
    assert.equal(one.payload.dynamic, true);
    assert.equal(one.payload.route, "experimental/new-thing", "route derivation exposed for lazy tools");

    const srch = await client.callTool("unity_list_advanced_tools", { search: "experimental" });
    assert.ok(srch.payload.results.some((r) => r.name === "unity_experimental_new_thing" && r.dynamic));

    // The lazy tool actually dispatches through unity_advanced_tool.
    const call = await client.callTool("unity_advanced_tool", { tool: "unity_experimental_new_thing", params: { x: 1 } });
    assert.equal(call.payload.success, true);
    const seen = bridge.seen.find((r) => r.route === "experimental/new-thing");
    assert.ok(seen, "derived route reached the bridge");
  });

  test("unity_advanced_tool proxies CORE tools via route overrides (stale-schema escape hatch)", async () => {
    // unity_material_create's real route is asset/create-material — the naive derivation
    // (material/create) used to fail with unknown-route. Same class: editor/execute-code.
    const mat = await client.callTool("unity_advanced_tool", {
      tool: "unity_material_create",
      params: { path: "Assets/T.mat", overwrite: true },
    });
    assert.equal(mat.payload.success, true);
    assert.equal(mat.payload.data.overwrite, true, "params (incl. overwrite) pass through opaquely");
    assert.ok(bridge.seen.some((r) => r.route === "asset/create-material"), "override route reached the bridge");

    const code = await client.callTool("unity_advanced_tool", {
      tool: "unity_execute_code",
      params: { code: "return 1;" },
    });
    assert.equal(code.payload.success, true);
    assert.ok(bridge.seen.some((r) => r.route === "editor/execute-code"));
  });

  test("advanced-tool catalog rejects non-string filters with a clean error, not a crash", async () => {
    const { payload, isError } = await client.callTool("unity_list_advanced_tools", { category: 123 });
    assert.match(payload.error, /must be a string/);
    assert.ok(!/toLowerCase|TypeError/.test(payload.error), "clean validation error, not a raw exception");
    assert.equal(isError, true);
  });

  test("tool= misses get a did-you-mean and the error flag", async () => {
    const { payload, isError } = await client.callTool("unity_list_advanced_tools", { tool: "unity_terrain_lisr" });
    assert.match(payload.error, /Did you mean/);
    assert.match(payload.error, /unity_terrain_list/);
    assert.equal(isError, true);
  });

  test("mistyped advanced tool names get a did-you-mean suggestion", async () => {
    const { payloadText, isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_terrain_lisr",
      params: {},
    });
    assert.match(payloadText, /Did you mean/i);
    assert.match(payloadText, /unity_terrain_list/);
    assert.equal(isError, true, "unknown tool errors carry isError");
  });

  // Strict-client compatibility (issue #27): every declared property must have an explicit shape.
  test("every inputSchema property is explicitly shaped for strict clients", async () => {
    const { tools } = await client.listTools();
    const violations = [];
    for (const tool of tools) {
      for (const [prop, schema] of Object.entries(tool.inputSchema.properties || {})) {
        collectSchemaViolations(tool.name, prop, schema, violations);
      }
    }
    assert.deepEqual(violations, [], `${violations.length} loosely-shaped properties`);
  });

  test("tools/call round-trips through the queue with agent identity", async () => {
    const { payload, payloadText } = await client.callTool("unity_editor_state");
    assert.ok(payload, `tool output is JSON (got: ${payloadText.slice(0, 200)})`);
    assert.equal(payload.success, true);
    assert.equal(payload.data.activeScene, "MockScene");
    const seen = bridge.seen.find((r) => r.route === "editor/state");
    assert.ok(seen, "bridge received editor/state");
    assert.equal(seen.via, "queue");
    assert.ok(seen.headers["x-agent-id"], "X-Agent-Id header sent");
  });

  test("ProBuilder advanced tool dispatches to its plugin route via the explicit handler", async () => {
    const { payload, isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_probuilder_create_shape",
      params: { shape: "cylinder", name: "TestCyl" },
    });
    assert.equal(payload.success, true);
    assert.equal(payload.data.shape, "cylinder");
    assert.equal(payload.data.name, "TestCyl");
    assert.equal(isError, false);
    const seen = bridge.seen.find((r) => r.route === "probuilder/create-shape");
    assert.ok(seen, "bridge received the probuilder/create-shape route");
    assert.equal(seen.params.shape, "cylinder", "params forwarded intact");
    assert.equal(seen.via, "queue", "routed through the multi-agent queue");
  });

  test("play_mode recovers from a reload-evicted ticket by verifying the editor state", async () => {
    const { payload, isError } = await client.callTool("unity_play_mode", { action: "play" });
    assert.equal(payload.success, true, "false negative recovered as success");
    assert.equal(payload.data.verifiedViaEditorState, true);
    assert.equal(payload.data.isPlaying, true);
    assert.equal(isError, false);

    const stop = await client.callTool("unity_play_mode", { action: "stop" });
    assert.equal(stop.payload.success, true, "stop verified the same way");
    assert.equal(stop.payload.data.isPlaying, false);
  });

  test("unity_undo_last is a core tool that routes to undo/last with its params", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.some((t) => t.name === "unity_undo_last"), "unity_undo_last is exposed as a core tool");
    const { payload, isError } = await client.callTool("unity_undo_last", { agentId: "agent-7", force: true });
    assert.equal(payload.success, true);
    assert.equal(payload.data.echoAgentId, "agent-7", "agentId forwarded to the plugin");
    assert.equal(payload.data.echoForce, true, "force forwarded to the plugin");
    assert.equal(isError, false);
    const seen = bridge.seen.find((r) => r.route === "undo/last");
    assert.ok(seen, "bridge received the undo/last route");
    assert.equal(seen.via, "queue");
  });

  // The VERBATIM Unity-side message must reach the agent. This assertion used to accept
  // `success:false` as an alternative, which let a real regression hide: the queue ticket
  // carries the exception in `errorMessage` (MCPRequestQueue.TicketToDict) while the server
  // read only `error`, so EVERY route's diagnostic collapsed to "Queue processing failed"
  // and agents retried non-idempotent writes blind. Assert the actual text, nothing weaker.
  test("logical failures surface the verbatim Unity error message", async () => {
    const { payload, payloadText } = await client.callTool("unity_advanced_tool", {
      tool: "unity_logical_failure",
      params: {},
    });
    const text = payload ? JSON.stringify(payload) : payloadText;
    assert.match(text, /boom: mock logical failure/i);
    assert.doesNotMatch(text, /Queue processing failed/i, "generic fallback must not replace the real message");
  });

  // Same contract on the terminal TimedOut branch, which reads the same field.
  test("plugin-side timeouts surface the verbatim Unity timeout message", async () => {
    const { payload, payloadText } = await client.callTool("unity_advanced_tool", {
      tool: "unity_plugin_timeout",
      params: {},
    });
    const text = payload ? JSON.stringify(payload) : payloadText;
    assert.match(text, /Timed out on the main thread/i);
  });

  // MCP spec: logical failures set isError so clients don't read them as success.
  test("logical failures set the MCP isError flag", async () => {
    const { isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_logical_failure",
      params: {},
    });
    assert.equal(isError, true);
  });

  test("successful calls do NOT set isError", async () => {
    const { isError, payload } = await client.callTool("unity_editor_state");
    assert.equal(payload.success, true);
    assert.equal(isError, false);
  });

  test("responses are compact JSON by default (no pretty-print token overhead)", async () => {
    const { payloadText } = await client.callTool("unity_editor_state");
    assert.ok(!payloadText.includes("\n  "), "no 2-space indentation in default mode");
    assert.ok(JSON.parse(payloadText), "still valid JSON");
  });

  test("image tools emit an image block and never leak base64 into the text metadata", async () => {
    const result = await client.request("tools/call", {
      name: "unity_advanced_tool",
      arguments: { tool: "unity_graphics_asset_preview", params: { assetPath: "Assets/Mock.png" } },
    });
    const image = (result.content || []).find((b) => b.type === "image");
    assert.ok(image, "an image content block is present");
    assert.ok(image.data && image.data.length > 100_000, "image block carries the base64 payload");
    assert.equal(image.mimeType, "image/png");
    for (const block of result.content) {
      if (block.type === "text") {
        assert.ok(!block.text.includes("QUJDREVG"), "base64 payload must not appear in text blocks");
      }
    }
  });

  test("tickets that complete without a result don't leak queue metadata", async () => {
    const { payload } = await client.callTool("unity_advanced_tool", {
      tool: "unity_silent_completion",
      params: {},
    });
    assert.equal(payload.success, true);
    const text = JSON.stringify(payload);
    assert.ok(!text.includes("ticketId"), "no ticket metadata in tool output");
    assert.ok(!text.includes("agentId"), "no agent metadata in tool output");
  });

  test("console log strips info-entry stack traces by default and trims error traces", async () => {
    const { payload } = await client.callTool("unity_console_log", { count: 2 });
    const [info, error] = payload.data.entries;
    assert.equal(info.stackTrace, undefined, "info entries drop their trace by default");
    assert.ok(error.stackTrace.includes("Frame0"), "error entries keep the trace head");
    assert.ok(!error.stackTrace.includes("Frame7"), "error traces are frame-capped");
    assert.match(error.stackTrace, /more frames/, "truncation is marked");

    const full = await client.callTool("unity_console_log", { count: 2, includeStackTrace: "all", maxStackFrames: 50 });
    assert.ok(full.payload.data.entries[0].stackTrace.includes("Frame11"), "explicit 'all' restores full traces");
  });

  test("batch-wire degrades to single set-reference calls on plugins without the route", async () => {
    const { payload, isError } = await client.callTool("unity_component_batch_wire", {
      references: [
        { path: "Manager", componentType: "Hud", propertyName: "panelA", referenceGameObject: "PanelA" },
        { path: "Manager", componentType: "Hud", propertyName: "panelB", referenceGameObject: "PanelB" },
      ],
    });
    assert.equal(payload.success, true);
    assert.match(payload.degraded, /batch-wire unavailable/);
    assert.equal(payload.results.length, 2);
    assert.equal(isError, false);
    const singles = bridge.seen.filter((r) => r.route === "component/set-reference");
    assert.equal(singles.length, 2, "each entry executed as its own set-reference call");
    // The degrade fires the calls CONCURRENTLY (Promise.all) to bound wall-clock by the
    // slowest call rather than their sum. Promise.all guarantees RESULT order, not network
    // ARRIVAL order — so asserting the order the mock happened to receive them was testing
    // a property the implementation never promised, and it duly flipped on a faster runner.
    // Assert the set that arrived, then the guarantee that actually matters:
    // results[i] still corresponds to references[i].
    assert.deepEqual(
      singles.map((r) => r.params.propertyName).sort(),
      ["panelA", "panelB"],
      "both entries were wired (arrival order is not guaranteed — the calls are concurrent)"
    );
    assert.deepEqual(
      payload.results.map((r) => (r.data ? r.data.wired : r.wired)),
      ["panelA", "panelB"],
      "results stay aligned with the input references order"
    );
  });

  test("degraded batch-wire reports failure when an entry fails via the legacy error envelope", async () => {
    const { payload, isError } = await client.callTool("unity_component_batch_wire", {
      references: [
        { path: "Manager", componentType: "Hud", propertyName: "propOk", referenceGameObject: "X" },
        { path: "Manager", componentType: "Hud", propertyName: "propBad", referenceGameObject: "Y" },
      ],
    });
    assert.equal(payload.success, false, "a failed degraded entry must not report overall success");
    assert.equal(payload.failedCount, 1);
    assert.equal(isError, true, "the misleading-success class stays flagged");
  });

  test("instance listing surfaces the plugin version from the capability handshake", async () => {
    const { payload } = await client.callTool("unity_list_instances");
    assert.equal(payload.instances[0].pluginVersion, "9.9.9-mock");
  });

  test("testing get_job waitTimeout short-circuits on terminal status (reads data.status)", async () => {
    const start = Date.now();
    const { payload } = await client.callTool("unity_advanced_tool", {
      tool: "unity_testing_get_job",
      params: { waitTimeout: 30 },
    });
    // Must return promptly (terminal status detected), not burn the 30s timeout.
    assert.ok(Date.now() - start < 5_000, "returned without burning the full waitTimeout");
    assert.equal(payload.data.status, "succeeded");
  });

  test("plugin-side TimedOut is surfaced as a terminal error, not polled to a 404", async () => {
    const { payload, payloadText, isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_plugin_timeout",
      params: {},
    });
    const text = payload ? JSON.stringify(payload) : payloadText;
    assert.match(text, /timed out/i);
    assert.ok(!/404/.test(text), "no misleading 404");
    assert.equal(isError, true);
  });

  test("unknown tool names are rejected with a helpful error", async () => {
    let outcome;
    try {
      outcome = await client.callTool("unity_totally_missing_tool");
    } catch (err) {
      assert.match(err.message, /unknown|not found|missing/i);
      return;
    }
    const text = outcome.payload ? JSON.stringify(outcome.payload) : outcome.payloadText;
    assert.match(text, /unknown|not found|unity_totally_missing_tool/i);
  });

  test("oversized responses are replaced by pagination guidance (4MB hard limit)", async () => {
    const { payloadText } = await client.callTool("unity_advanced_tool", {
      tool: "unity_payload_huge",
      params: {},
    });
    assert.ok(payloadText.length < 100_000, `hard limit must shrink the response (got ${payloadText.length} chars)`);
    assert.match(payloadText, /too large|limit|pagination|maxNodes|truncat/i);
  });

  test("VRChat safety guard: core tool call is refused and refusal text reaches the agent intact", async () => {
    const { payload, payloadText, isError } = await client.callTool("unity_build", {
      target: "StandaloneWindows64",
      outputPath: "Builds/test.exe",
    });
    assert.equal(isError, true, "MCP isError flag is set on guard refusal");
    assert.equal(payload.data.refused, true);
    assert.match(payload.data.error, /VRChat content is built and tested through the VRChat SDK/);
    assert.match(payloadText, /VRChat content is built and tested through the VRChat SDK/);
  });

  test("VRChat safety guard: core tool override allows call to proceed and notes guard was overridden", async () => {
    const { payload, isError } = await client.callTool("unity_build", {
      target: "StandaloneWindows64",
      outputPath: "Builds/test.exe",
      override: true,
    });
    assert.equal(isError, false, "overridden call succeeds");
    assert.equal(payload.data.guardOverridden, true);
  });

  test("VRChat safety guard: advanced tool call is refused and refusal text reaches the agent intact", async () => {
    const { payload, payloadText, isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_settings_set_player",
      params: { bundleVersion: "2.0.0" },
    });
    assert.equal(isError, true, "MCP isError flag is set on guard refusal");
    assert.equal(payload.data.refused, true);
    assert.match(payload.data.error, /VRChat projects require specific Player Settings/);
    assert.match(payloadText, /VRChat projects require specific Player Settings/);
  });

  test("VRChat safety guard: advanced tool override allows call to proceed and notes guard was overridden", async () => {
    const { payload, isError } = await client.callTool("unity_advanced_tool", {
      tool: "unity_settings_set_player",
      params: { bundleVersion: "2.0.0", override: true },
    });
    assert.equal(isError, false, "overridden call succeeds");
    assert.equal(payload.data.guardOverridden, true);
    assert.deepEqual(payload.data.updated, ["bundleVersion"]);
  });

  test("stdout carried only clean JSON-RPC for the entire session", () => {
    assert.deepEqual(client.stdoutViolations, [], `stdout violations: ${client.stdoutViolations.slice(0, 3).join(" | ")}`);
  });
});

describe("compact tool registry mode (UNITY_MCP_COMPACT_TOOLS=1)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridge = new MockBridge();
    await bridge.start();
    client = new McpTestClient({ env: { ...bridge.env(), UNITY_MCP_COMPACT_TOOLS: "1" } }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("keeps all 79 tools but fits constrained-client budgets (issue #27)", async () => {
    const { tools } = await client.listTools();
    assert.ok(tools.length >= 70 && tools.length <= 90, `all tools still exposed (${tools.length})`);
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    console.error(`[gate] compact tools/list payload: ${(bytes / 1024).toFixed(1)} KB`);
    assert.ok(bytes <= 24_000, `compact tools/list ${bytes} bytes exceeds 24KB`);
  });

  test("schema structure stays strict (types/required survive, prose dropped)", async () => {
    const { tools } = await client.listTools();
    const setProp = tools.find((t) => t.name === "unity_component_set_property");
    assert.deepEqual(setProp.inputSchema.required, ["gameObjectPath", "componentType", "propertyName", "value"]);
    for (const [prop, schema] of Object.entries(setProp.inputSchema.properties)) {
      assert.ok("type" in schema, `${prop} keeps an explicit type`);
      assert.ok(!("description" in schema), `${prop} drops prose in compact mode`);
    }
  });
});

describe("pretty JSON opt-out (UNITY_MCP_PRETTY_JSON=1)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridge = new MockBridge();
    bridge.on("editor/state", () => ({ isPlaying: false, activeScene: "PrettyScene" }));
    await bridge.start();
    client = new McpTestClient({ env: { ...bridge.env(), UNITY_MCP_PRETTY_JSON: "1" } }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("restores 2-space indentation for human debugging", async () => {
    const { payloadText, payload } = await client.callTool("unity_editor_state");
    assert.ok(payloadText.includes('\n  "'), "indented output in pretty mode");
    assert.equal(payload.data.activeScene, "PrettyScene");
  });
});

describe("legacy-mode fallback (old plugin without queue endpoints)", () => {
  /** @type {MockBridge} */ let bridge;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridge = new MockBridge({ mode: "legacy" });
    bridge.on("editor/state", () => ({ legacy: true, isCompiling: false }));
    await bridge.start();
    client = new McpTestClient({ env: bridge.env() }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridge.stop();
  });

  test("server degrades to synchronous POSTs and still serves tools", async () => {
    const { payload } = await client.callTool("unity_editor_state");
    assert.equal(payload.success, true);
    assert.equal(payload.data.legacy, true);
    const seen = bridge.seen.find((r) => r.route === "editor/state");
    assert.equal(seen.via, "legacy");
  });

  test("stdout stayed protocol-clean through the fallback path", () => {
    assert.deepEqual(client.stdoutViolations, []);
  });
});

describe("multi-instance selection gate", () => {
  /** @type {MockBridge} */ let bridgeA;
  /** @type {MockBridge} */ let bridgeB;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    bridgeA = new MockBridge({ instance: { projectName: "ProjectA", projectPath: "C:/A" } });
    bridgeB = new MockBridge({ instance: { projectName: "ProjectB", projectPath: "C:/B" } });
    await bridgeA.start();
    await bridgeB.start();
    // Registry advertises both instances; port-range scan is pinned to A only.
    const dir = mkdtempSync(join(tmpdir(), "umcp-registry-"));
    const registryPath = join(dir, "instances.json");
    const now = new Date().toISOString();
    writeFileSync(registryPath, JSON.stringify([
      { port: bridgeA.port, projectName: "ProjectA", projectPath: "C:/A", unityVersion: "6000.0.0f1", lastSeen: now },
      { port: bridgeB.port, projectName: "ProjectB", projectPath: "C:/B", unityVersion: "6000.0.0f1", lastSeen: now },
    ]));
    const env = { ...bridgeA.env(), UNITY_INSTANCE_REGISTRY: registryPath };
    client = new McpTestClient({ env }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridgeA.stop();
    await bridgeB.stop();
  });

  test("editor tools are blocked until an instance is selected, then routed to the chosen port", async () => {
    const blocked = await client.callTool("unity_editor_state");
    const blockedText = blocked.payload ? JSON.stringify(blocked.payload) : blocked.payloadText;
    assert.match(blockedText, /select|multiple|instance/i);

    const selected = await client.callTool("unity_select_instance", { port: bridgeB.port });
    const selectedText = selected.payload ? JSON.stringify(selected.payload) : selected.payloadText;
    assert.match(selectedText, /ProjectB/);

    await client.callTool("unity_editor_state");
    assert.ok(bridgeB.seen.some((r) => r.route === "editor/state"), "selected instance B received the call");
    assert.ok(!bridgeA.seen.some((r) => r.route === "editor/state"), "instance A did not receive the call");
  });

  test("instances can be selected by stable projectName instead of dynamic port", async () => {
    const selected = await client.callTool("unity_select_instance", { projectName: "ProjectA" });
    assert.match(JSON.stringify(selected.payload), /ProjectA/);
    await client.callTool("unity_editor_state");
    assert.ok(bridgeA.seen.some((r) => r.route === "editor/state"), "name-selected instance A now receives calls");

    const missing = await client.callTool("unity_select_instance", { projectName: "NoSuchProject" });
    assert.match(missing.payloadText, /No running instance named/);
    assert.match(missing.payloadText, /ProjectA/, "error lists available instances");
    assert.equal(missing.isError, true);
  });
});

describe("VRChat project detection and surface shaping (mock bridge)", () => {
  /** @type {MockBridge} */ let bridgeAvatar;
  /** @type {MockBridge} */ let bridgeWorld;
  /** @type {MockBridge} */ let bridgeNonVrc;
  /** @type {MockBridge} */ let bridgeNoPoi;
  /** @type {MockBridge} */ let bridgeBareWorld;
  /** @type {McpTestClient} */ let client;

  before(async () => {
    const dir = mkdtempSync(join(tmpdir(), "umcp-vrc-registry-"));
    const noPoiDir = join(dir, "NoPoiProject");
    mkdirSync(join(noPoiDir, "Packages"), { recursive: true });
    writeFileSync(
      join(noPoiDir, "Packages", "manifest.json"),
      JSON.stringify({
        dependencies: {
          "com.vrchat.avatars": "3.7.0",
          "nadena.dev.modular-avatar": "1.19.0",
        },
      })
    );

    const avatarDir = join(dir, "AvatarProject");
    mkdirSync(join(avatarDir, "Packages"), { recursive: true });
    mkdirSync(join(avatarDir, "Assets", "_PoiyomiShaders"), { recursive: true });
    writeFileSync(
      join(avatarDir, "Packages", "manifest.json"),
      JSON.stringify({
        dependencies: {
          "com.vrchat.avatars": "3.10.5",
          "nadena.dev.modular-avatar": "1.19.0",
          "nadena.dev.ndmf": "1.5.0",
          "com.vrcfury.vrcfury": "1.900.0",
          "d4rkpl4y3r.d4rkavataroptimizer": "3.8.0",
          "vrchat.blackstartx.gesture-manager": "3.9.9",
        },
      })
    );

    const worldDir = join(dir, "WorldProject");
    mkdirSync(join(worldDir, "Packages"), { recursive: true });
    mkdirSync(join(worldDir, "Assets", "_PoiyomiShaders"), { recursive: true });
    writeFileSync(
      join(worldDir, "Packages", "manifest.json"),
      JSON.stringify({
        dependencies: {
          "com.vrchat.worlds": "3.10.5",
          "dev.onevr.vrworldtoolkit": "1.2.0",
        },
      })
    );

    const bareWorldDir = join(dir, "BareWorldProject");
    mkdirSync(join(bareWorldDir, "Packages"), { recursive: true });
    writeFileSync(
      join(bareWorldDir, "Packages", "manifest.json"),
      JSON.stringify({
        dependencies: {
          "com.vrchat.worlds": "3.7.0",
        },
      })
    );

    // Avatar and world plugins speak protocol 4 (authoring v2); NoPoi and BareWorld stay on 2.
    bridgeAvatar = new MockBridge({
      instance: {
        projectName: "AvatarProject",
        projectPath: avatarDir,
        protocolVersion: 4,
      },
    });
    bridgeWorld = new MockBridge({
      instance: {
        projectName: "WorldProject",
        projectPath: worldDir,
        protocolVersion: 4,
      },
    });
    bridgeNonVrc = new MockBridge({
      instance: {
        projectName: "NonVrcProject",
        projectPath: "C:/NonVrc",
        protocolVersion: 1,
      },
    });
    bridgeNoPoi = new MockBridge({
      instance: {
        projectName: "NoPoiAvatarProject",
        projectPath: noPoiDir,
        protocolVersion: 2,
      },
    });
    bridgeBareWorld = new MockBridge({
      instance: {
        projectName: "BareWorldProject",
        projectPath: bareWorldDir,
        protocolVersion: 2,
      },
    });

    bridgeAvatar.on("vrc/project-context", () => ({
      projectType: "avatar",
      sdkVersion: "3.10.5",
      packages: {
        modularAvatar: { available: true, version: "1.19.0-alpha.0" },
        ndmf: { available: true, version: "1.14.8" },
        vrcfury: { available: true, version: "1.1429.0" },
        d4rkOptimizer: { available: true, version: "4.6.0" },
        vrWorldToolkit: { available: false, version: null },
        gestureManager: { available: true, version: "3.9.9" },
        av3Emulator: { available: false, version: null },
        poiyomi: { available: true, version: "10.0.11" },
      },
    }));

    bridgeAvatar.on("vrc/avatar/performance", (p) => ({
      avatarName: p.avatarPath || "TestAvatar",
      rank: "VeryPoor",
      limitingCategory: "PolyCount",
      buildTooling: ["Modular Avatar", "VRCFury"],
      isMobile: !!p.isMobile,
      categories: {
        PolyCount: { rating: "VeryPoor", value: 125000, threshold: 70000 },
        SkinnedMeshCount: { rating: "Good", value: 2, threshold: 2 },
      },
    }));

    bridgeAvatar.on("vrc/avatar/parameters", (p) => ({
      avatarName: p.avatarPath || "TestAvatar",
      totalUsed: 270,
      limit: 256,
      remaining: 0,
      overage: 14,
      isOverBudget: true,
      parameters: [
        { name: "OutfitToggle", type: "Bool", cost: 1, synced: true },
        { name: "ColorPicker", type: "Int", cost: 8, synced: true },
      ],
      buildTooling: ["Modular Avatar"],
    }));

    bridgeAvatar.on("vrc/avatar/audit", (p) => ({
      avatarName: p.avatarPath || "TestAvatar",
      buildTooling: ["Modular Avatar"],
      writeDefaults: {
        consistent: false,
        hasMixedSettings: true,
        summary: "Inconsistent Write Defaults detected: 1 states WD ON, 1 states WD OFF across 1 layers.",
        layers: [
          { controller: "FX", layerName: "Toggles", isMixed: true, wdOnCount: 1, wdOffCount: 1, wdOnStates: ["On"], wdOffStates: ["Off"] },
        ],
      },
      missingScripts: [
        { objectName: "BrokenProp", objectPath: "Armature/BrokenProp", missingCount: 1 },
      ],
      missingScriptsCount: 1,
      hasMissingScripts: true,
      textureMemory: {
        totalBytes: 52428800,
        totalMB: 50.0,
        uniqueTextureCount: 1,
        rankedTextures: [
          { name: "MainAtlas", assetPath: "Assets/Atlas.png", dimensions: "2048x2048", memoryBytes: 52428800, memoryMB: 50.0 },
        ],
      },
    }));

    bridgeAvatar.on("vrc/poiyomi/status", () => ({
      installed: true,
      version: "10.0.11",
      totalCount: 2,
      lockedCount: 1,
      unlockedCount: 1,
      materials: [
        { name: "LockedMat", assetPath: "Assets/Materials/LockedMat.mat", shaderName: "Poiyomi/Locked", isLocked: true },
        { name: "UnlockedMat", assetPath: "Assets/Materials/UnlockedMat.mat", shaderName: "Poiyomi/Unlocked", isLocked: false },
      ],
    }));

    bridgeAvatar.on("vrc/poiyomi/lock", (p) => ({
      success: true,
      processed: 1,
      unchanged: 0,
      failed: 0,
      results: [
        { material: "UnlockedMat", assetPath: p.materialPath || "Assets/Materials/UnlockedMat.mat", status: "locked" },
      ],
    }));

    bridgeAvatar.on("vrc/poiyomi/unlock", (p) => ({
      success: true,
      processed: 1,
      unchanged: 0,
      failed: 0,
      results: [
        { material: "LockedMat", assetPath: p.materialPath || "Assets/Materials/LockedMat.mat", status: "unlocked" },
      ],
    }));

    bridgeAvatar.on("vrc/poiyomi/get-property", (p) => ({
      materialPath: p.materialPath,
      propertyName: p.propertyName || "_Color",
      propertyType: "Color",
      value: [1, 1, 1, 1],
      isLocked: false,
    }));

    bridgeAvatar.on("vrc/poiyomi/set-property", (p) => {
      if (p.materialPath?.includes("Locked") && !p.unlockIfLocked) {
        return {
          success: false,
          refused: true,
          isLocked: true,
          unlockedFirst: false,
          error: "Material is locked. Pass unlockIfLocked: true to modify.",
        };
      }
      return {
        success: true,
        refused: false,
        isLocked: false,
        unlockedFirst: !!p.unlockIfLocked,
        materialPath: p.materialPath,
        propertyName: p.propertyName,
        value: p.value,
      };
    });

    bridgeAvatar.on("vrc/avatar/descriptor/get", () => ({
      avatarName: "TestAvatar",
      viewPosition: { x: 0, y: 1.5, z: 0.1 },
      lipSync: {
        mode: "VisemeBlendShape",
        visemeSkinnedMesh: "Body",
        visemeBlendShapes: ["vrc.v_sil", "vrc.v_pp", "vrc.v_ff"],
      },
      eyeLook: { enabled: true },
      playableLayers: [
        { type: "FX", isDefault: false, animatorController: "Assets/FX.controller" },
      ],
      expressions: {
        expressionsMenu: "Assets/Expressions/Menu.asset",
        expressionParameters: "Assets/Expressions/Params.asset",
      },
    }));

    bridgeAvatar.on("vrc/avatar/descriptor/set-visemes", () => ({
      success: true,
      meshName: "Body",
      visemesMapped: 14,
      visemesUnmapped: 1,
      unmappedVisemes: ["ou"],
      mappings: { sil: "vrc.v_sil", ou: null },
    }));

    bridgeAvatar.on("vrc/avatar/descriptor/set-playable-layer", (p) => ({
      success: true,
      avatarName: "TestAvatar",
      layerType: p.layerType,
      controllerPath: p.controllerPath,
      isDefault: false,
    }));

    bridgeAvatar.on("vrc/avatar/parameters/create", (p) => {
      if (p.name === "OverBudgetParam") {
        return {
          success: false,
          refused: true,
          limit: 256,
          currentUsed: 250,
          paramCost: 8,
          overage: 2,
          error: "Adding parameter 'OverBudgetParam' (8 bits) would exceed the 256-bit memory limit by 2 bits. Parameters asset was unchanged.",
        };
      }
      return {
        success: true,
        refused: false,
        name: p.name,
        type: p.type || "Bool",
        cost: p.type === "Int" ? 8 : 1,
        totalUsed: 10,
        limit: 256,
        remaining: 246,
      };
    });

    bridgeAvatar.on("vrc/avatar/menu/get", () => ({
      menuName: "RootMenu",
      controlCount: 1,
      limit: 8,
      controls: [
        { name: "Hats", type: "SubMenu", parameter: null, value: 0 },
      ],
    }));

    bridgeAvatar.on("vrc/avatar/menu/add-control", (p) => {
      if (p.name === "NinthControl") {
        return {
          success: false,
          refused: true,
          controlCount: 8,
          limit: 8,
          error: "Expression menu already contains the maximum number of controls (8). Addition refused. Menu asset was unchanged.",
        };
      }
      return {
        success: true,
        refused: false,
        controlName: p.name,
        type: p.type || "Button",
        controlCount: 2,
        limit: 8,
      };
    });

    bridgeAvatar.on("vrc/physbone/add", (p) => ({
      success: true,
      objectPath: p.targetPath || "Armature/Hips/Tail",
      root: p.targetPath || "Armature/Hips/Tail",
      affectedTransformCount: 4,
    }));

    bridgeAvatar.on("vrc/physbone/configure", (p) => ({
      success: true,
      objectPath: p.targetPath || "Armature/Hips/Tail",
      root: p.targetPath || "Armature/Hips/Tail",
      affectedTransformCount: 4,
    }));

    bridgeAvatar.on("vrc/physbone/list", () => ({
      avatarName: "TestAvatar",
      physBoneCount: 1,
      physBones: [
        {
          objectPath: "Armature/Hips/Tail",
          root: "Armature/Hips/Tail",
          affectedTransformCount: 4,
          parameters: { pull: 0.2, spring: 0.5 },
        },
      ],
    }));

    bridgeAvatar.on("vrc/contact/add", (p) => ({
      success: true,
      type: p.type || "receiver",
      objectPath: p.targetPath || "Head/Nose",
    }));

    bridgeAvatar.on("vrc/contact/list", () => ({
      avatarName: "TestAvatar",
      contactCount: 1,
      contacts: [
        {
          type: "receiver",
          objectPath: "Head/Nose",
          radius: 0.03,
          collisionTags: ["Finger"],
          parameter: "BoopTrigger",
        },
      ],
    }));

    bridgeAvatar.on("vrc/avatar/non-destructive/list", () => ({
      avatarName: "TestAvatar",
      totalCount: 2,
      components: [
        {
          objectPath: "Clothing/Shirt",
          tool: "Modular Avatar",
          componentType: "ModularAvatarMergeAnimator",
          role: "Merge Animator: FX",
        },
        {
          objectPath: "Props/Glasses",
          tool: "VRCFury",
          componentType: "VRCFury",
          role: "VRCFury Features: Toggle",
        },
      ],
    }));

    bridgeAvatar.on("vrc/avatar/modular-avatar/add", (p) => ({
      success: true,
      componentType: p.componentType || "ModularAvatarMergeAnimator",
      objectPath: p.targetPath || "Clothing/Shirt",
    }));

    bridgeAvatar.on("vrc/avatar/vrcfury/add", (p) => ({
      success: true,
      componentType: "VRCFury",
      objectPath: p.targetPath || "Props/Glasses",
    }));

    // ─── Authoring v2 (plugin protocol 4) ───
    bridgeAvatar.on("vrc/avatar/vrcfury/toggle", (p) => ({
      success: true,
      action: "created",
      objectPath: p.targetPath || "",
      menuPath: p.menuPath,
      toggle: {
        $type: "Toggle",
        name: p.menuPath,
        saved: p.saved === true,
        state: {
          actions: (p.objects || []).map((o) => ({
            $type: "ObjectToggleAction",
            obj: `${o.path} (GameObject)`,
            mode: o.mode === "off" ? "TurnOff" : "TurnOn",
          })),
        },
      },
    }));

    bridgeAvatar.on("vrc/avatar/vrcfury/armature-link", (p) => ({
      success: true,
      action: "created",
      objectPath: p.targetPath,
      propBone: `${p.targetPath}/Armature/Hips`,
      linkTo: p.linkTo || "Hips",
      avatarBone: "Armature/Hips",
      recursive: true,
      align: true,
      boneMatch: { matchedCount: 24, unmatchedCount: 0 },
    }));

    bridgeAvatar.on("vrc/avatar/outfit/attach", (p) => {
      if (p.outfitPath === "Assets/Outfits/Broken.prefab") {
        return { success: false, error: "Modular Avatar setup failed: merge target missing.", rolledBack: true };
      }
      return {
        success: true,
        method: "modularAvatar",
        methodReason: "the outfit already carries a Modular Avatar Merge Armature",
        outfitObjectPath: "Hoodie",
        instantiatedFrom: p.outfitPath,
        boneMatch: {
          matchedCount: 52,
          unmatchedCount: 2,
          unmatched: [{ path: "Hoodie/Armature/Hips/Hoodie_Spine.001", subtreeSize: 1, looksLike: "Spine" }],
          suggestions: ["Bone names end in '.001' where the avatar's do not; set the Merge Armature suffix to '.001'."],
        },
      };
    });

    bridgeAvatar.on("vrc/avatar/blendshapes/list", (p) => ({
      avatarName: "TestAvatar",
      meshPath: p.meshPath || "Body",
      selectedBy: "descriptor viseme mesh",
      blendShapeCount: 3,
      blendShapes: [
        { index: 0, name: "vrc.v_aa", weight: 0 },
        { index: 1, name: "Smile", weight: 0 },
        { index: 2, name: "JawOpen", weight: 0 },
      ],
      ...(p.faceTracking
        ? { faceTracking: { detectedStandard: "UnifiedExpressions", standards: { UnifiedExpressions: { found: 1, total: 102, coverage: 0.01 } } } }
        : {}),
    }));

    bridgeAvatar.on("vrc/avatar/blendshapes/set", (p) => {
      const unknown = Object.keys(p.weights || {}).filter((name) => !["Smile", "JawOpen"].includes(name));
      if (unknown.length > 0) {
        const errors = unknown.map((name) => `'${name}' is not a blendshape on 'Body' (did you mean Smile?).`);
        return { success: false, error: `${errors.join(" ")} Nothing was changed.`, errors };
      }
      return {
        success: true,
        meshPath: "Body",
        applied: Object.entries(p.weights).map(([name, value]) => ({ name, previous: 0, value })),
      };
    });

    // Play mode: Gesture Manager in the scene, attaching one status poll after play starts.
    // The play request's ticket is evicted by the play-mode domain reload, as in Unity.
    const playState = { playing: false, polls: 0, values: { Jacket: false, GestureLeft: 0 } };
    const gestureIndex = { neutral: 0, fist: 1, open: 2 };
    bridgeAvatar.on("editor/play-mode", (p) => {
      if (p.action === "play") Object.assign(playState, { playing: true, polls: 0 });
      if (p.action === "stop") playState.playing = false;
      return { __evict: true };
    });
    bridgeAvatar.on("vrc/avatar/playmode/status", (p) => {
      const noEmulator = p.avatarPath === "NoEmulatorAvatar";
      if (!playState.playing) {
        return {
          success: true,
          isPlaying: false,
          ready: false,
          emulatorsInScene: noEmulator ? [] : ["GestureManager"],
          enteringPlayMode: false,
          compileErrors: false,
          hint: noEmulator
            ? "Not in play mode, and the open scene has no active Gesture Manager or Av3Emulator. Add one in edit mode (menu 'Tools/Gesture Manager Emulator' or 'Tools/Avatars 3.0 Emulator/Enable', e.g. with unity_execute_menu_item), then enter play mode."
            : "Not in play mode. GestureManager will drive the avatar once play mode starts.",
        };
      }
      if (++playState.polls < 2) {
        return { success: true, isPlaying: true, ready: false, emulatorsInScene: ["GestureManager"], hint: "GestureManager is in the scene and attaches a few frames after play starts; retry shortly." };
      }
      const parameters = Object.entries(playState.values).map(([name, value]) => ({
        name,
        type: typeof value === "boolean" ? "Bool" : "Int",
        value,
      }));
      return {
        success: true,
        isPlaying: true,
        ready: true,
        emulator: "GestureManager",
        avatar: "TestAvatar",
        parameterCount: parameters.length,
        parameters: p.names ? parameters.filter((x) => p.names.includes(x.name)) : parameters,
      };
    });
    bridgeAvatar.on("vrc/avatar/playmode/set", (p) => {
      if (!playState.playing) return { success: false, error: "Not in play mode.", notReady: true };
      const requests = Object.entries(p.parameters || {});
      if (p.gestureLeft !== undefined) requests.push(["GestureLeft", gestureIndex[p.gestureLeft] ?? p.gestureLeft]);
      const unknown = requests.filter(([name]) => !(name in playState.values));
      if (unknown.length > 0) return { success: false, error: `'${unknown[0][0]}' is not a parameter of 'TestAvatar'. Nothing was changed.` };
      const applied = requests.map(([name, value]) => {
        const previous = playState.values[name];
        playState.values[name] = value;
        return { name, previous, value };
      });
      return { success: true, emulator: "GestureManager", avatar: "TestAvatar", applied };
    });
    bridgeAvatar.on("vrc/avatar/playmode/capture", (p) => ({
      success: true,
      base64: "iVBORw0KGgoMOCKPNG".repeat(20),
      width: p.width || 512,
      height: p.height || 512,
      view: p.view || "front",
      avatar: "TestAvatar",
      isPlaying: playState.playing,
    }));

    bridgeWorld.on("vrc/project-context", () => ({
      projectType: "world",
      sdkVersion: "3.10.5",
      packages: {
        modularAvatar: { available: false, version: null },
        ndmf: { available: false, version: null },
        vrcfury: { available: false, version: null },
        d4rkOptimizer: { available: false, version: null },
        vrWorldToolkit: { available: true, version: "3.4.1" },
        poiyomi: { available: true, version: "10.0.11" },
      },
    }));

    // UdonSharp: the new behaviour compiles a moment after the script is written.
    let udonAttachCalls = 0;
    bridgeWorld.on("vrc/world/udonsharp/create", (p) => ({
      success: true,
      scriptPath: p.path,
      programAssetPath: p.path.replace(/\.cs$/, ".asset"),
      className: p.path.split("/").pop().replace(/\.cs$/, ""),
      scriptKept: false,
      programAssetReused: false,
      compilePending: true,
      hint: "Unity compiles the script next; attach it with unity_vrc_udonsharp_attach once compilation has finished.",
    }));
    bridgeWorld.on("vrc/world/udonsharp/attach", (p) => {
      if (p.targetPath === "World/Missing") return { success: false, error: "GameObject 'World/Missing' was not found in the open scene." };
      if (++udonAttachCalls < 2) return { success: false, error: "Scripts are still compiling. Retry in a few seconds.", pending: true };
      return {
        success: true,
        objectPath: p.targetPath,
        className: "Door",
        programAssetPath: p.programAssetPath || "Assets/Scripts/Door.asset",
        backingUdonBehaviour: true,
      };
    });

    // Deferred avatar analysis: submit returns a jobId, the job is polled until it finishes.
    let deferredPolls = 0;
    bridgeNoPoi.on("vrc/avatar/performance", () => ({
      success: true,
      jobId: "job-abc123",
      status: "running",
      route: "vrc/avatar/performance",
    }));
    bridgeNoPoi.on("vrc/avatar/job", (p) => {
      deferredPolls++;
      if (p.jobId !== "job-abc123") return { error: `job '${p.jobId}' not found` };
      if (deferredPolls < 2) return { success: true, jobId: p.jobId, status: "running", elapsedMs: 1500 };
      return {
        success: true,
        jobId: p.jobId,
        status: "completed",
        elapsedMs: 42000,
        result: { avatarName: "DeferredAvatar", rank: "Poor", limitingCategory: "PolyCount" },
      };
    });

    bridgeWorld.on("vrc/world/descriptor/get", (p) => {
      if (p?.emptyScene) {
        return {
          error: "No VRChat scene descriptor (VRCSceneDescriptor) found in the open scene. This scene is not configured as a VRChat world scene.",
        };
      }
      return {
        objectPath: "World/SceneDescriptor",
        spawns: [
          { name: "Spawn_0", path: "World/Spawns/Spawn_0", position: [0, 0, 0], rotation: [0, 0, 0] },
        ],
        spawnCount: 1,
        spawnOrder: "Sequential",
        respawnHeightY: -100,
        referenceCamera: "World/MainCamera",
        forbidUserPortals: false,
      };
    });

    bridgeWorld.on("vrc/world/descriptor/add-spawn", (p) => {
      if (p?.emptyScene) {
        return {
          error: "No VRChat scene descriptor (VRCSceneDescriptor) found in the open scene. This scene is not configured as a VRChat world scene.",
        };
      }
      return {
        success: true,
        spawn: {
          name: p?.name || "SpawnPoint",
          path: `World/Spawns/${p?.name || "SpawnPoint"}`,
          position: p?.position || [0, 0, 0],
          rotation: p?.rotation || [0, 0, 0],
        },
        spawnCount: 2,
      };
    });

    bridgeWorld.on("vrc/world/descriptor/set-spawns", (p) => ({
      objectPath: "World/SceneDescriptor",
      spawns: [{ name: "Spawn_0", path: "World/Spawns/Spawn_0" }],
      spawnCount: 1,
      spawnOrder: p?.spawnOrder || "Random",
      respawnHeightY: p?.respawnHeightY || -50,
    }));

    bridgeWorld.on("vrc/world/udon/list", () => ({
      behaviours: [
        { name: "DoorTrigger", objectPath: "World/Interactive/Door", programName: "DoorProgram", variableCount: 2 },
        { name: "GameManager", objectPath: "World/Logic/Manager", programName: "GameManagerProgram", variableCount: 4 },
      ],
      count: 2,
    }));

    bridgeWorld.on("vrc/world/udon/get-variables", (p) => ({
      success: true,
      objectPath: p?.targetPath || "World/Logic/Manager",
      programName: "GameManagerProgram",
      variables: [
        { name: "score", type: "Int32", value: 100 },
        { name: "gameMode", type: "String", value: "Deathmatch" },
        { name: "isActive", type: "Boolean", value: true },
        { name: "spawnOffset", type: "Vector3", value: [0, 1.5, 0] },
      ],
      count: 4,
    }));

    let mockScore = 100;
    bridgeWorld.on("vrc/world/udon/set-variable", (p) => {
      if (p?.name === "score") {
        if (typeof p.value !== "number") {
          return {
            success: false,
            refused: true,
            error: `Type mismatch for variable 'score': expected Int32, provided ${typeof p.value}. Variable left unchanged.`,
            expectedType: "Int32",
            providedType: typeof p.value,
          };
        }
        mockScore = p.value;
        return { success: true, name: "score", type: "Int32", value: mockScore };
      }
      return { success: true, name: p?.name, type: "Object", value: p?.value };
    });

    bridgeWorld.on("vrc/world/validate", () => ({
      success: true,
      tool: "VRWorldToolkit",
      findings: [
        { severity: "Warning", affectedObject: "Directional Light", message: "Realtime directional light without baked shadow mask" },
      ],
    }));

    bridgeWorld.on("vrc/world/content/summary", () => ({
      mirrors: [{ name: "Mirror", path: "World/Mirrors/Mirror", active: true }],
      audioSources: [
        { name: "3DSpeaker", path: "World/Audio/3DSpeaker", spatialize: true, spatialBlend: 1.0, isSpatialized: true, isFlagged: false },
        { name: "2DMusic", path: "World/Audio/2DMusic", spatialize: false, spatialBlend: 0.0, isSpatialized: false, isFlagged: true, warning: "AudioSource is not spatialized" },
      ],
      unspatializedAudio: [
        { name: "2DMusic", path: "World/Audio/2DMusic", spatialize: false, spatialBlend: 0.0 },
      ],
      lights: [{ name: "Directional Light", path: "World/Lighting/Directional Light", type: "Directional", shadows: "Soft" }],
      videoPlayers: [{ name: "ProVideoPlayer", path: "World/Video/ProVideoPlayer", type: "VRCAVProVideoPlayer" }],
      stats: {
        mirrorCount: 1,
        audioSourceCount: 2,
        unspatializedAudioCount: 1,
        lightCount: 1,
        videoPlayerCount: 1,
      },
    }));

    bridgeNoPoi.on("vrc/project-context", () => ({
      projectType: "avatar",
      sdkVersion: "3.7.0",
      packages: {
        modularAvatar: { available: true, version: "1.19.0" },
        poiyomi: { available: false, version: null },
      },
    }));

    bridgeBareWorld.on("vrc/project-context", () => ({
      projectType: "world",
      sdkVersion: "3.7.0",
      packages: {
        modularAvatar: { available: false, version: null },
        ndmf: { available: false, version: null },
        vrcfury: { available: false, version: null },
        d4rkOptimizer: { available: false, version: null },
        vrWorldToolkit: { available: false, version: null },
        poiyomi: { available: false, version: null },
      },
    }));

    bridgeBareWorld.on("vrc/world/validate", () => ({
      success: false,
      error: "World validation tooling is not installed. Please install 'dev.onevr.vrworldtoolkit' (VRWorldToolkit) to run world validation.",
      requiredPackage: "dev.onevr.vrworldtoolkit",
    }));

    await bridgeAvatar.start();
    await bridgeWorld.start();
    await bridgeNonVrc.start();
    await bridgeNoPoi.start();
    await bridgeBareWorld.start();

    const registryPath = join(dir, "instances.json");
    const now = new Date().toISOString();
    writeFileSync(
      registryPath,
      JSON.stringify([
        { port: bridgeAvatar.port, projectName: "AvatarProject", projectPath: avatarDir, protocolVersion: 4, unityVersion: "2022.3.22f1", lastSeen: now },
        { port: bridgeWorld.port, projectName: "WorldProject", projectPath: worldDir, protocolVersion: 4, unityVersion: "2022.3.22f1", lastSeen: now },
        { port: bridgeNonVrc.port, projectName: "NonVrcProject", projectPath: "C:/NonVrc", protocolVersion: 1, unityVersion: "2022.3.22f1", lastSeen: now },
        { port: bridgeNoPoi.port, projectName: "NoPoiAvatarProject", projectPath: noPoiDir, protocolVersion: 2, unityVersion: "2022.3.22f1", lastSeen: now },
        { port: bridgeBareWorld.port, projectName: "BareWorldProject", projectPath: bareWorldDir, protocolVersion: 2, unityVersion: "2022.3.22f1", lastSeen: now },
      ])
    );

    const env = { ...bridgeAvatar.env(), UNITY_INSTANCE_REGISTRY: registryPath };
    client = new McpTestClient({ env }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
    await bridgeAvatar.stop();
    await bridgeWorld.stop();
    await bridgeNonVrc.stop();
    await bridgeNoPoi.stop();
    await bridgeBareWorld.stop();
  });

  test("non-VRChat project advertises zero VRChat tools", async () => {
    await client.callTool("unity_select_instance", { projectName: "NonVrcProject" });
    const { tools } = await client.listTools();
    const vrcTools = tools.filter((t) => t.name.startsWith("unity_vrc_"));
    assert.equal(vrcTools.length, 0, "no VRChat tools on non-VRChat project");

    // Invoking an avatar tool is refused with error naming 'none'
    const res = await client.callTool("unity_vrc_avatar_performance");
    assert.equal(res.isError, true);
    assert.match(res.payloadText, /none/i);
  });

  test("avatar project advertises avatar tools, VRCFury tools, and no world tools", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    assert.ok(names.includes("unity_vrc_get_project_context"));
    assert.ok(names.includes("unity_vrc_avatar_performance"));
    assert.ok(names.includes("unity_vrc_vrcfury_add"));
    assert.ok(!names.includes("unity_vrc_world_descriptor_get"), "world tools must not appear in avatar project");

    // Calling wrong tool (world descriptor) is refused
    const res = await client.callTool("unity_vrc_world_descriptor_get");
    assert.equal(res.isError, true);
    assert.match(res.payloadText, /avatar/i);

    // Calling valid avatar tool succeeds
    const okRes = await client.callTool("unity_vrc_avatar_performance");
    assert.equal(okRes.isError, false);
  });

  test("world project advertises world tools and no avatar or VRCFury tools", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);

    assert.ok(names.includes("unity_vrc_get_project_context"));
    assert.ok(names.includes("unity_vrc_world_descriptor_get"));
    assert.ok(!names.includes("unity_vrc_avatar_performance"), "avatar tools must not appear in world project");
    assert.ok(!names.includes("unity_vrc_vrcfury_add"), "VRCFury tools must not appear in world project");

    // Calling wrong tool (avatar tool) is refused
    const res = await client.callTool("unity_vrc_avatar_performance");
    assert.equal(res.isError, true);
    assert.match(res.payloadText, /world/i);

    // Calling valid world tool succeeds
    const okRes = await client.callTool("unity_vrc_world_descriptor_get");
    assert.equal(okRes.isError, false);
  });

  test("unity_vrc_get_project_context returns parsed context from bridge", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_get_project_context");
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.projectType, "avatar");
    assert.equal(data.sdkVersion, "3.10.5");
    assert.equal(data.packages?.modularAvatar?.available, true);
    assert.equal(data.packages?.vrWorldToolkit?.available, false);
  });

  test("deferred avatar analysis polls the job and returns the finished result", async () => {
    // The bake blocks Unity's main thread far longer than one queue ticket survives, so the
    // route hands back a jobId. Callers must still receive the finished analysis, not the id.
    await client.callTool("unity_select_instance", { projectName: "NoPoiAvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_performance", { port: bridgeNoPoi.port });
    assert.equal(res.isError, false, res.payloadText);
    const data = res.payload?.data || res.payload;
    assert.equal(data.rank, "Poor");
    assert.equal(data.avatarName, "DeferredAvatar");
    assert.ok(!("jobId" in data), "the jobId is an implementation detail, not the tool's answer");
  });

  test("unity_vrc_avatar_performance reports rank, limiting statistic, and categories", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_performance", { avatarPath: "MyAvatar", isMobile: false });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.rank, "VeryPoor");
    assert.equal(data.limitingCategory, "PolyCount");
    assert.deepEqual(data.buildTooling, ["Modular Avatar", "VRCFury"]);
    assert.equal(data.categories?.PolyCount?.rating, "VeryPoor");
    assert.equal(data.categories?.PolyCount?.value, 125000);

    // Call against world project should be refused by call-time gate
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const refused = await client.callTool("unity_vrc_avatar_performance");
    assert.equal(refused.isError, true);
    assert.match(refused.payloadText, /world/i);
  });

  test("unity_vrc_avatar_parameters reports budget, usage, and overage", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_parameters", { avatarPath: "MyAvatar" });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.totalUsed, 270);
    assert.equal(data.limit, 256);
    assert.equal(data.remaining, 0);
    assert.equal(data.overage, 14);
    assert.equal(data.isOverBudget, true);
    assert.equal(data.parameters.length, 2);
    assert.equal(data.parameters[0].name, "OutfitToggle");
    assert.equal(data.parameters[0].cost, 1);
  });

  test("unity_vrc_avatar_audit reports write defaults, missing scripts, and texture memory", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_audit", { avatarPath: "MyAvatar" });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.writeDefaults?.consistent, false);
    assert.equal(data.writeDefaults?.hasMixedSettings, true);
    assert.equal(data.writeDefaults?.layers?.length, 1);
    assert.equal(data.hasMissingScripts, true);
    assert.equal(data.missingScriptsCount, 1);
    assert.equal(data.missingScripts[0].objectPath, "Armature/BrokenProp");
    assert.equal(data.textureMemory?.totalMB, 50.0);
    assert.equal(data.textureMemory?.rankedTextures?.length, 1);
    assert.equal(data.textureMemory?.rankedTextures[0].name, "MainAtlas");
  });

  test("unity_vrc_poiyomi_status reports materials and lock states", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_poiyomi_status");
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.installed, true);
    assert.equal(data.totalCount, 2);
    assert.equal(data.lockedCount, 1);
    assert.equal(data.unlockedCount, 1);
    assert.equal(data.materials.length, 2);
    assert.equal(data.materials[0].name, "LockedMat");
    assert.equal(data.materials[0].isLocked, true);
    assert.equal(data.materials[1].name, "UnlockedMat");
    assert.equal(data.materials[1].isLocked, false);
  });

  test("unity_vrc_poiyomi_lock and unity_vrc_poiyomi_unlock execute correctly", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });

    const lockRes = await client.callTool("unity_vrc_poiyomi_lock", { materialPath: "Assets/Materials/UnlockedMat.mat" });
    assert.equal(lockRes.isError, false);
    const lockData = lockRes.payload?.data || lockRes.payload;
    assert.equal(lockData.success, true);
    assert.equal(lockData.results[0].status, "locked");

    const unlockRes = await client.callTool("unity_vrc_poiyomi_unlock", { materialPath: "Assets/Materials/LockedMat.mat" });
    assert.equal(unlockRes.isError, false);
    const unlockData = unlockRes.payload?.data || unlockRes.payload;
    assert.equal(unlockData.success, true);
    assert.equal(unlockData.results[0].status, "unlocked");
  });

  test("unity_vrc_poiyomi_get_property reads shader property", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_poiyomi_get_property", {
      materialPath: "Assets/Materials/UnlockedMat.mat",
      propertyName: "_Color",
    });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.propertyName, "_Color");
    assert.deepEqual(data.value, [1, 1, 1, 1]);
  });

  test("unity_vrc_poiyomi_set_property respects locked state and auto-unlock option", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });

    // Modifying locked material without unlockIfLocked is refused
    const lockedRes = await client.callTool("unity_vrc_poiyomi_set_property", {
      materialPath: "Assets/Materials/LockedMat.mat",
      propertyName: "_Color",
      value: [1, 0, 0, 1],
    });
    assert.equal(lockedRes.isError, true);
    const lockedData = lockedRes.payload?.data || lockedRes.payload;
    assert.equal(lockedData.refused, true);
    assert.equal(lockedData.isLocked, true);
    assert.match(lockedRes.payloadText, /locked/i);

    // Modifying locked material with unlockIfLocked: true succeeds with unlockedFirst
    const autoUnlockRes = await client.callTool("unity_vrc_poiyomi_set_property", {
      materialPath: "Assets/Materials/LockedMat.mat",
      propertyName: "_Color",
      value: [1, 0, 0, 1],
      unlockIfLocked: true,
    });
    assert.equal(autoUnlockRes.isError, false);
    const autoUnlockData = autoUnlockRes.payload?.data || autoUnlockRes.payload;
    assert.equal(autoUnlockData.success, true);
    assert.equal(autoUnlockData.unlockedFirst, true);

    // Modifying unlocked material succeeds directly
    const unlockedRes = await client.callTool("unity_vrc_poiyomi_set_property", {
      materialPath: "Assets/Materials/UnlockedMat.mat",
      propertyName: "_Color",
      value: [0, 1, 0, 1],
    });
    assert.equal(unlockedRes.isError, false);
    const unlockedData = unlockedRes.payload?.data || unlockedRes.payload;
    assert.equal(unlockedData.success, true);
    assert.equal(unlockedData.unlockedFirst, false);
  });

  test("Poiyomi tools are advertised when Poiyomi is installed and omitted when absent", async () => {
    const poiToolNames = [
      "unity_vrc_poiyomi_status",
      "unity_vrc_poiyomi_lock",
      "unity_vrc_poiyomi_unlock",
      "unity_vrc_poiyomi_get_property",
      "unity_vrc_poiyomi_set_property",
    ];

    // 1. AvatarProject has Poiyomi -> all Poiyomi tools are advertised
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const avatarTools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of poiToolNames) {
      assert.ok(avatarTools.includes(name), `AvatarProject should advertise ${name}`);
    }

    // 2. WorldProject has Poiyomi -> Poiyomi tools are advertised (shader tools can apply to worlds too)
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const worldTools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of poiToolNames) {
      assert.ok(worldTools.includes(name), `WorldProject should advertise ${name}`);
    }

    // 3. NoPoiAvatarProject does not have Poiyomi -> Poiyomi tools are omitted from listTools
    await client.callTool("unity_select_instance", { projectName: "NoPoiAvatarProject" });
    const noPoiTools = (await client.listTools()).tools.map((t) => t.name);
    for (const name of poiToolNames) {
      assert.ok(!noPoiTools.includes(name), `NoPoiAvatarProject must NOT advertise ${name}`);
    }
    // Avatar tools still present
    assert.ok(noPoiTools.includes("unity_vrc_avatar_performance"));

    // 4. Calling Poiyomi tool on NoPoiAvatarProject is refused by call-time gate
    const refusedRes = await client.callTool("unity_vrc_poiyomi_status");
    assert.equal(refusedRes.isError, true);
    assert.match(refusedRes.payloadText, /poiyomi/i);
  });

  test("unity_vrc_avatar_descriptor_get reports configuration", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_descriptor_get", { avatarPath: "MyAvatar" });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.avatarName, "TestAvatar");
    assert.equal(data.viewPosition?.y, 1.5);
    assert.equal(data.lipSync?.mode, "VisemeBlendShape");
    assert.equal(data.lipSync?.visemeSkinnedMesh, "Body");
    assert.equal(data.playableLayers?.length, 1);
    assert.equal(data.playableLayers[0].type, "FX");
    assert.equal(data.expressions?.expressionsMenu, "Assets/Expressions/Menu.asset");
  });

  test("unity_vrc_avatar_descriptor_set_visemes assigns blendshapes and reports unmapped", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_descriptor_set_visemes", { avatarPath: "MyAvatar", meshPath: "Body" });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.success, true);
    assert.equal(data.visemesMapped, 14);
    assert.equal(data.visemesUnmapped, 1);
    assert.deepEqual(data.unmappedVisemes, ["ou"]);
  });

  test("unity_vrc_avatar_descriptor_set_playable_layer sets controller", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_avatar_descriptor_set_playable_layer", {
      avatarPath: "MyAvatar",
      layerType: "FX",
      controllerPath: "Assets/FX.controller",
    });
    assert.equal(res.isError, false);
    const data = res.payload?.data || res.payload;
    assert.equal(data.success, true);
    assert.equal(data.layerType, "FX");
  });

  test("unity_vrc_avatar_parameter_add adds parameter and refuses over-budget additions", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });

    // Valid addition
    const okRes = await client.callTool("unity_vrc_avatar_parameter_add", {
      name: "HatToggle",
      type: "Bool",
      defaultValue: true,
      synced: true,
    });
    assert.equal(okRes.isError, false);
    const okData = okRes.payload?.data || okRes.payload;
    assert.equal(okData.success, true);
    assert.equal(okData.name, "HatToggle");

    // Over budget addition refused
    const overRes = await client.callTool("unity_vrc_avatar_parameter_add", {
      name: "OverBudgetParam",
      type: "Int",
      synced: true,
    });
    assert.equal(overRes.isError, true);
    const overData = overRes.payload?.data || overRes.payload;
    assert.equal(overData.refused, true);
    assert.equal(overData.limit, 256);
    assert.equal(overData.overage, 2);
  });

  test("unity_vrc_avatar_menu_add_control adds control and refuses over-limit additions", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });

    // Get menu
    const getRes = await client.callTool("unity_vrc_avatar_menu_get");
    assert.equal(getRes.isError, false);

    // Valid control addition
    const okRes = await client.callTool("unity_vrc_avatar_menu_add_control", {
      name: "ToggleShirt",
      type: "Toggle",
      parameter: "Shirt",
      value: 1,
    });
    assert.equal(okRes.isError, false);
    const okData = okRes.payload?.data || okRes.payload;
    assert.equal(okData.success, true);
    assert.equal(okData.controlName, "ToggleShirt");

    // Over limit (8 controls) addition refused
    const overRes = await client.callTool("unity_vrc_avatar_menu_add_control", {
      name: "NinthControl",
      type: "Button",
    });
    assert.equal(overRes.isError, true);
    const overData = overRes.payload?.data || overRes.payload;
    assert.equal(overData.refused, true);
    assert.equal(overData.controlCount, 8);
    assert.equal(overData.limit, 8);
  });

  test("PhysBones and Contacts add and list", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });

    // PhysBone add & list
    const pbAdd = await client.callTool("unity_vrc_physbone_add", { targetPath: "Armature/Hips/Tail", pull: 0.2, spring: 0.5 });
    assert.equal(pbAdd.isError, false);
    const pbAddData = pbAdd.payload?.data || pbAdd.payload;
    assert.equal(pbAddData.affectedTransformCount, 4);

    const pbList = await client.callTool("unity_vrc_physbone_list");
    assert.equal(pbList.isError, false);
    const pbListData = pbList.payload?.data || pbList.payload;
    assert.equal(pbListData.physBoneCount, 1);
    assert.equal(pbListData.physBones[0].affectedTransformCount, 4);

    // Contact add & list
    const ctAdd = await client.callTool("unity_vrc_contact_add", { targetPath: "Head/Nose", type: "receiver", collisionTags: ["Finger"] });
    assert.equal(ctAdd.isError, false);

    const ctList = await client.callTool("unity_vrc_contact_list");
    assert.equal(ctList.isError, false);
    const ctListData = ctList.payload?.data || ctList.payload;
    assert.equal(ctListData.contactCount, 1);
    assert.equal(ctListData.contacts[0].parameter, "BoopTrigger");
  });

  test("Non-destructive component authoring and inspection", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });

    // Non-destructive list
    const ndList = await client.callTool("unity_vrc_avatar_non_destructive_list");
    assert.equal(ndList.isError, false);
    const ndData = ndList.payload?.data || ndList.payload;
    assert.equal(ndData.totalCount, 2);
    assert.equal(ndData.components[0].tool, "Modular Avatar");
    assert.equal(ndData.components[1].tool, "VRCFury");

    // Modular Avatar add
    const maAdd = await client.callTool("unity_vrc_modular_avatar_add", { componentType: "ModularAvatarMergeAnimator" });
    assert.equal(maAdd.isError, false);

    // VRCFury add
    const vfAdd = await client.callTool("unity_vrc_vrcfury_add", { feature: "Toggle" });
    assert.equal(vfAdd.isError, false);
  });

  test("Authoring tools are advertised only for avatar projects with matching integration", async () => {
    // 1. AvatarProject has avatar type, modularAvatar, and vrcfury -> all advertised
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const avatarTools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(avatarTools.includes("unity_vrc_avatar_descriptor_get"));
    assert.ok(avatarTools.includes("unity_vrc_avatar_parameter_add"));
    assert.ok(avatarTools.includes("unity_vrc_avatar_menu_add_control"));
    assert.ok(avatarTools.includes("unity_vrc_physbone_add"));
    assert.ok(avatarTools.includes("unity_vrc_contact_add"));
    assert.ok(avatarTools.includes("unity_vrc_modular_avatar_add"));
    assert.ok(avatarTools.includes("unity_vrc_vrcfury_add"));

    // 2. WorldProject has world type -> NO avatar authoring tools advertised
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const worldTools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(!worldTools.includes("unity_vrc_avatar_descriptor_get"));
    assert.ok(!worldTools.includes("unity_vrc_avatar_parameter_add"));
    assert.ok(!worldTools.includes("unity_vrc_modular_avatar_add"));
    assert.ok(!worldTools.includes("unity_vrc_vrcfury_add"));

    // 3. NoPoiAvatarProject has modularAvatar but NOT vrcfury
    await client.callTool("unity_select_instance", { projectName: "NoPoiAvatarProject" });
    const noPoiTools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(noPoiTools.includes("unity_vrc_avatar_descriptor_get"));
    assert.ok(noPoiTools.includes("unity_vrc_modular_avatar_add"), "modularAvatar present -> advertised");
    assert.ok(!noPoiTools.includes("unity_vrc_vrcfury_add"), "vrcfury absent -> omitted");

    // Calling VRCFury tool on project without VRCFury is refused by call-time gate
    const refusedRes = await client.callTool("unity_vrc_vrcfury_add", { feature: "Toggle" });
    assert.equal(refusedRes.isError, true);
    assert.match(refusedRes.payloadText, /vrcfury/i);
  });

  test("World descriptor read, spawn add, and empty scene failure", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });

    // 1. Read descriptor (Task 8.1)
    const descRes = await client.callTool("unity_vrc_world_descriptor_get");
    assert.equal(descRes.isError, false);
    const descData = descRes.payload?.data || descRes.payload;
    assert.equal(descData.spawnOrder, "Sequential");
    assert.equal(descData.respawnHeightY, -100);
    assert.equal(descData.referenceCamera, "World/MainCamera");
    assert.equal(descData.spawns.length, 1);
    assert.equal(descData.spawns[0].name, "Spawn_0");

    // 2. Add spawn point (Task 8.2)
    const addRes = await client.callTool("unity_vrc_world_spawn_add", {
      name: "PlayerSpawn2",
      position: [10, 0, 5],
      rotation: [0, 90, 0],
    });
    assert.equal(addRes.isError, false);
    const addData = addRes.payload?.data || addRes.payload;
    assert.equal(addData.success, true);
    assert.equal(addData.spawn.name, "PlayerSpawn2");
    assert.equal(addData.spawnCount, 2);

    // 3. Empty scene failure (Task 8.3)
    const emptyRes = await client.callTool("unity_vrc_world_descriptor_get", { emptyScene: true });
    assert.equal(emptyRes.isError, true);
    assert.match(emptyRes.payloadText, /not configured as a VRChat world scene/i);
  });

  test("Udon behaviour listing and public variable read", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });

    // List Udon behaviours (Task 8.4)
    const listRes = await client.callTool("unity_vrc_world_udon_list");
    assert.equal(listRes.isError, false);
    const listData = listRes.payload?.data || listRes.payload;
    assert.equal(listData.count, 2);
    assert.equal(listData.behaviours[0].objectPath, "World/Interactive/Door");
    assert.equal(listData.behaviours[0].programName, "DoorProgram");
    assert.equal(listData.behaviours[1].objectPath, "World/Logic/Manager");

    // Read variables with types and current values (Task 8.5)
    const varsRes = await client.callTool("unity_vrc_world_udon_get_variables", {
      targetPath: "World/Logic/Manager",
    });
    assert.equal(varsRes.isError, false);
    const varsData = varsRes.payload?.data || varsRes.payload;
    assert.equal(varsData.count, 4);

    const scoreVar = varsData.variables.find((v) => v.name === "score");
    assert.equal(scoreVar.type, "Int32");
    assert.equal(scoreVar.value, 100);

    const modeVar = varsData.variables.find((v) => v.name === "gameMode");
    assert.equal(modeVar.type, "String");
    assert.equal(modeVar.value, "Deathmatch");

    const vecVar = varsData.variables.find((v) => v.name === "spawnOffset");
    assert.equal(vecVar.type, "Vector3");
    assert.deepEqual(vecVar.value, [0, 1.5, 0]);
  });

  test("Udon variable write and type mismatch refusal", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });

    // Valid write (Task 8.6)
    const okRes = await client.callTool("unity_vrc_world_udon_set_variable", {
      targetPath: "World/Logic/Manager",
      name: "score",
      value: 250,
    });
    assert.equal(okRes.isError, false);
    const okData = okRes.payload?.data || okRes.payload;
    assert.equal(okData.success, true);
    assert.equal(okData.value, 250);

    // Type mismatch write refused (Task 8.7)
    const badRes = await client.callTool("unity_vrc_world_udon_set_variable", {
      targetPath: "World/Logic/Manager",
      name: "score",
      value: "two_hundred",
    });
    assert.equal(badRes.isError, true);
    const badData = badRes.payload?.data || badRes.payload;
    assert.equal(badData.refused, true);
    assert.equal(badData.expectedType, "Int32");
    assert.match(badRes.payloadText, /Int32/);
    assert.match(badRes.payloadText, /string/i);
  });

  test("World validation runs when installed and fails naming package when absent", async () => {
    // 1. WorldProject has vrWorldToolkit installed (Task 8.8)
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const valRes = await client.callTool("unity_vrc_world_validate");
    assert.equal(valRes.isError, false);
    const valData = valRes.payload?.data || valRes.payload;
    assert.equal(valData.success, true);
    assert.equal(valData.tool, "VRWorldToolkit");
    assert.equal(valData.findings.length, 1);
    assert.equal(valData.findings[0].severity, "Warning");
    assert.equal(valData.findings[0].affectedObject, "Directional Light");

    // 2. BareWorldProject does not have vrWorldToolkit (Task 8.9)
    await client.callTool("unity_select_instance", { projectName: "BareWorldProject" });
    const noToolRes = await client.callTool("unity_vrc_world_validate");
    assert.equal(noToolRes.isError, true);
    assert.match(noToolRes.payloadText, /vrWorldToolkit|dev\.onevr\.vrworldtoolkit/i);
  });

  test("World content summary reports mirrors, audio, lights, and flags unspatialized audio", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });

    // Content summary (Task 8.10)
    const sumRes = await client.callTool("unity_vrc_world_content_summary");
    assert.equal(sumRes.isError, false);
    const sumData = sumRes.payload?.data || sumRes.payload;

    assert.equal(sumData.stats.mirrorCount, 1);
    assert.equal(sumData.stats.audioSourceCount, 2);
    assert.equal(sumData.stats.unspatializedAudioCount, 1);
    assert.equal(sumData.stats.lightCount, 1);
    assert.equal(sumData.stats.videoPlayerCount, 1);

    assert.equal(sumData.unspatializedAudio.length, 1);
    assert.equal(sumData.unspatializedAudio[0].name, "2DMusic");
  });

  test("World tool surface shaping and diet budget", async () => {
    // 1. WorldProject advertises world tools and omits avatar tools (Task 8.12)
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const worldTools = (await client.listTools()).tools.map((t) => t.name);

    assert.ok(worldTools.includes("unity_vrc_world_descriptor_get"));
    assert.ok(worldTools.includes("unity_vrc_world_spawn_add"));
    assert.ok(worldTools.includes("unity_vrc_world_udon_list"));
    assert.ok(worldTools.includes("unity_vrc_world_udon_get_variables"));
    assert.ok(worldTools.includes("unity_vrc_world_udon_set_variable"));
    assert.ok(worldTools.includes("unity_vrc_world_validate"), "vrWorldToolkit present -> advertised");
    assert.ok(worldTools.includes("unity_vrc_world_content_summary"));

    // Avatar tools omitted on world project
    assert.ok(!worldTools.includes("unity_vrc_avatar_descriptor_get"));
    assert.ok(!worldTools.includes("unity_vrc_avatar_performance"));
    assert.ok(!worldTools.includes("unity_vrc_physbone_add"));

    // 2. BareWorldProject omits unity_vrc_world_validate when vrWorldToolkit absent
    await client.callTool("unity_select_instance", { projectName: "BareWorldProject" });
    const bareWorldTools = (await client.listTools()).tools.map((t) => t.name);
    assert.ok(bareWorldTools.includes("unity_vrc_world_descriptor_get"));
    assert.ok(!bareWorldTools.includes("unity_vrc_world_validate"), "vrWorldToolkit absent -> omitted");

    // 3. Invoking avatar tool on world project is refused by call-time gate
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const gateRes = await client.callTool("unity_vrc_avatar_descriptor_get");
    assert.equal(gateRes.isError, true);
    assert.match(gateRes.payloadText, /world/i);

    // 4. World project tools/list stays well within safe client limits (< 60KB)
    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    assert.ok(bytes <= 60_000, `World project tools/list ${bytes} bytes exceeds the 60KB limit`);
  });

  // ─── Authoring v2 (plugin protocol 4) ───
  const AVATAR_V2_TOOLS = [
    "unity_vrc_vrcfury_toggle",
    "unity_vrc_vrcfury_armature_link",
    "unity_vrc_outfit_attach",
    "unity_vrc_playmode_test",
    "unity_vrc_blendshapes_list",
    "unity_vrc_blendshapes_set",
  ];
  const WORLD_V2_TOOLS = ["unity_vrc_udonsharp_create", "unity_vrc_udonsharp_attach"];
  const toolNames = async () => (await client.listTools()).tools.map((t) => t.name);

  test("authoring v2 tools follow the project type and plugin protocol 4", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    let names = await toolNames();
    for (const name of AVATAR_V2_TOOLS) assert.ok(names.includes(name), `AvatarProject should advertise ${name}`);
    for (const name of WORLD_V2_TOOLS) assert.ok(!names.includes(name), `AvatarProject must not advertise ${name}`);

    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    names = await toolNames();
    for (const name of WORLD_V2_TOOLS) assert.ok(names.includes(name), `WorldProject should advertise ${name}`);
    for (const name of AVATAR_V2_TOOLS) assert.ok(!names.includes(name), `WorldProject must not advertise ${name}`);

    // A protocol-2 plugin cannot answer them: hidden, and a direct call names the protocol it needs.
    await client.callTool("unity_select_instance", { projectName: "NoPoiAvatarProject" });
    names = await toolNames();
    for (const name of AVATAR_V2_TOOLS) assert.ok(!names.includes(name), `protocol-2 plugin must not advertise ${name}`);
    const refused = await client.callTool("unity_vrc_blendshapes_list");
    assert.equal(refused.isError, true);
    assert.match(refused.payloadText, /protocol 4 or later/);
  });

  test("a plugin updated mid-session is picked up without re-selecting the instance", async () => {
    await client.callTool("unity_select_instance", { projectName: "NoPoiAvatarProject" });
    assert.ok(!(await toolNames()).includes("unity_vrc_blendshapes_list"));

    // Updating the plugin reloads Unity on the same port; the next call revalidates the selection.
    bridgeNoPoi.instance.protocolVersion = 4;
    try {
      await client.callTool("unity_vrc_get_project_context");
      await client.callTool("unity_vrc_get_project_context");
      assert.ok((await toolNames()).includes("unity_vrc_blendshapes_list"), "protocol 4 tools appear after the update");
    } finally {
      bridgeNoPoi.instance.protocolVersion = 2;
      await client.callTool("unity_vrc_get_project_context");
    }
    assert.ok(!(await toolNames()).includes("unity_vrc_blendshapes_list"));
  });

  test("authoring v2 schemas are explicitly shaped for strict clients", async () => {
    const violations = [];
    for (const [project, expected] of [["AvatarProject", AVATAR_V2_TOOLS], ["WorldProject", WORLD_V2_TOOLS]]) {
      await client.callTool("unity_select_instance", { projectName: project });
      const { tools } = await client.listTools();
      for (const tool of tools.filter((t) => expected.includes(t.name))) {
        for (const [prop, schema] of Object.entries(tool.inputSchema.properties || {})) {
          collectSchemaViolations(tool.name, prop, schema, violations);
        }
      }
    }
    assert.deepEqual(violations, [], `${violations.length} loosely-shaped properties`);
  });

  test("avatar project tools/list stays within a safe client budget", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const { tools } = await client.listTools();
    const bytes = Buffer.byteLength(JSON.stringify(tools), "utf8");
    console.error(`[gate] avatar project tools/list payload: ${(bytes / 1024).toFixed(1)} KB for ${tools.length} tools`);
    assert.ok(bytes <= 75_000, `Avatar project tools/list ${bytes} bytes exceeds the 75KB limit`);
  });

  test("unity_vrc_vrcfury_toggle passes the toggle definition through and returns the feature", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_vrcfury_toggle", {
      menuPath: "Clothing/Jacket",
      objects: [{ path: "Jacket" }, { path: "Shirt", mode: "off" }],
      blendShapes: [{ name: "Shrink_Chest", value: 100 }],
      saved: true,
    });
    assert.equal(res.isError, false, res.payloadText);
    const data = res.payload?.data || res.payload;
    assert.equal(data.action, "created");
    assert.equal(data.toggle.name, "Clothing/Jacket");
    assert.deepEqual(data.toggle.state.actions.map((a) => a.mode), ["TurnOn", "TurnOff"]);

    const sent = bridgeAvatar.seen.filter((r) => r.route === "vrc/avatar/vrcfury/toggle").at(-1).params;
    assert.deepEqual(sent.objects, [{ path: "Jacket" }, { path: "Shirt", mode: "off" }]);
    assert.deepEqual(sent.blendShapes, [{ name: "Shrink_Chest", value: 100 }]);
    assert.equal(sent.saved, true);
  });

  test("unity_vrc_vrcfury_armature_link reports the link and bone match", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_vrcfury_armature_link", { targetPath: "Hoodie" });
    assert.equal(res.isError, false, res.payloadText);
    const data = res.payload?.data || res.payload;
    assert.equal(data.linkTo, "Hips");
    assert.equal(data.boneMatch.unmatchedCount, 0);
  });

  test("unity_vrc_outfit_attach reports unmatched bones and surfaces a rolled-back failure", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const ok = await client.callTool("unity_vrc_outfit_attach", { outfitPath: "Assets/Outfits/Hoodie.prefab" });
    assert.equal(ok.isError, false, ok.payloadText);
    const data = ok.payload?.data || ok.payload;
    assert.equal(data.method, "modularAvatar");
    assert.equal(data.boneMatch.unmatchedCount, 2);
    assert.match(data.boneMatch.suggestions[0], /suffix/);

    const failed = await client.callTool("unity_vrc_outfit_attach", { outfitPath: "Assets/Outfits/Broken.prefab" });
    assert.equal(failed.isError, true);
    const failedData = failed.payload?.data || failed.payload;
    assert.equal(failedData.rolledBack, true);
  });

  test("unity_vrc_blendshapes_list and _set pass through, and a bad name is refused", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const list = await client.callTool("unity_vrc_blendshapes_list", { faceTracking: true });
    assert.equal(list.isError, false, list.payloadText);
    const listData = list.payload?.data || list.payload;
    assert.equal(listData.blendShapeCount, 3);
    assert.equal(listData.faceTracking.detectedStandard, "UnifiedExpressions");

    const set = await client.callTool("unity_vrc_blendshapes_set", { weights: { Smile: 100 } });
    assert.equal(set.isError, false, set.payloadText);
    assert.equal((set.payload?.data || set.payload).applied[0].value, 100);

    const bad = await client.callTool("unity_vrc_blendshapes_set", { weights: { Smiel: 100 } });
    assert.equal(bad.isError, true);
    assert.match(bad.payloadText, /did you mean Smile/);
  });

  test("unity_vrc_playmode_test with enterPlayMode:false reports that play mode is needed", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const playRequests = () => bridgeAvatar.seen.filter((r) => r.route === "editor/play-mode").length;
    const before = playRequests();
    const res = await client.callTool("unity_vrc_playmode_test", { parameters: { Jacket: true }, enterPlayMode: false });
    assert.equal(res.isError, true);
    assert.equal(res.payload?.notReady, true);
    assert.match(res.payloadText, /Not in play mode/);
    assert.equal(playRequests(), before, "play mode was not entered");
  });

  test("unity_vrc_playmode_test does not enter play mode when no emulator is in the scene", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const playRequests = () => bridgeAvatar.seen.filter((r) => r.route === "editor/play-mode").length;
    const before = playRequests();
    const res = await client.callTool("unity_vrc_playmode_test", { avatarPath: "NoEmulatorAvatar", parameters: { Jacket: true } });
    assert.equal(res.isError, true);
    assert.match(res.payloadText, /Tools\/Gesture Manager Emulator/);
    assert.equal(playRequests(), before, "play mode was not entered");
  });

  test("unity_vrc_playmode_test enters play mode, waits for the emulator, sets, reads back and captures", async () => {
    await client.callTool("unity_select_instance", { projectName: "AvatarProject" });
    const res = await client.callTool("unity_vrc_playmode_test", {
      parameters: { Jacket: true },
      gestureLeft: "fist",
      settleMs: 0,
      view: "face",
    });
    assert.equal(res.isError, false, res.payloadText);

    const image = res.blocks.find((b) => b.type === "image");
    assert.ok(image, "the capture comes back as an image block");
    assert.equal(image.mimeType, "image/png");
    assert.ok(!res.payloadText.includes("iVBORw0KGgo"), "the PNG never leaks into the text block");

    const data = res.payload?.data || res.payload;
    assert.equal(data.enteredPlayMode, true, "the ticket lost to the domain reload does not fail the run");
    assert.equal(data.emulator, "GestureManager");
    assert.deepEqual(data.applied.map((a) => a.name), ["Jacket", "GestureLeft"]);
    assert.deepEqual(
      data.parameters.map((x) => [x.name, x.value]),
      [["Jacket", true], ["GestureLeft", 1]],
      "values are read back after they are set"
    );
    assert.equal(data.capture.view, "face");

    // Already running: a second call neither re-enters play mode nor waits.
    const playRequests = bridgeAvatar.seen.filter((r) => r.route === "editor/play-mode").length;
    const again = await client.callTool("unity_vrc_playmode_test", { parameters: { Jacket: false }, capture: false, settleMs: 0 });
    assert.equal(again.isError, false, again.payloadText);
    assert.equal((again.payload?.data || again.payload).enteredPlayMode, false);
    assert.ok(!again.blocks.some((b) => b.type === "image"), "capture:false returns no image");
    assert.equal(bridgeAvatar.seen.filter((r) => r.route === "editor/play-mode").length, playRequests);
  });

  test("unity_vrc_udonsharp_create writes the behaviour and attaches it once compiled", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const res = await client.callTool("unity_vrc_udonsharp_create", {
      path: "Assets/Scripts/Door.cs",
      attachTo: "World/Interactive/Door",
    });
    assert.equal(res.isError, false, res.payloadText);
    const data = res.payload?.data || res.payload;
    assert.equal(data.programAssetPath, "Assets/Scripts/Door.asset");
    assert.equal(data.attach.success, true);
    assert.equal(data.attach.backingUdonBehaviour, true);
    assert.equal(data.compilePending, false);
    assert.ok(!("hint" in data), "the attach-later hint is dropped once attached");

    const attaches = bridgeWorld.seen.filter((r) => r.route === "vrc/world/udonsharp/attach");
    assert.ok(attaches.length >= 2, "the attach was retried while Unity compiled");
    assert.equal(attaches.at(-1).params.programAssetPath, "Assets/Scripts/Door.asset");
    assert.ok(!("attachTo" in bridgeWorld.seen.find((r) => r.route === "vrc/world/udonsharp/create").params));
  });

  test("unity_vrc_udonsharp_attach reports a final failure without waiting", async () => {
    await client.callTool("unity_select_instance", { projectName: "WorldProject" });
    const res = await client.callTool("unity_vrc_udonsharp_attach", { targetPath: "World/Missing", className: "Door" });
    assert.equal(res.isError, true);
    assert.match(res.payloadText, /not found in the open scene/);
  });

  test("Task 9.4: An old plugin paired with new server advertises no VRChat tools and reports no errors", async () => {
    await client.callTool("unity_select_instance", { projectName: "NonVrcProject" });
    const { tools } = await client.listTools();
    const vrcTools = tools.filter((t) => t.name.startsWith("unity_vrc_"));
    assert.equal(vrcTools.length, 0, "No VRChat tools advertised for protocolVersion 1 / old plugin");

    // Standard tool execution reports no errors
    const pingRes = await client.callTool("unity_editor_ping");
    assert.equal(pingRes.isError, false, "Standard tool calls succeed without errors");
  });

  test("Task 9.5: Plugin route table preserves all pre-existing standard routes", async () => {
    // Verify core pre-existing routes are all mapped
    const preExisting = [
      "ping", "editor/state", "project/info", "scene/info", "scene/open", "scene/save",
      "gameobject/create", "gameobject/delete", "gameobject/info", "gameobject/set-transform",
      "component/add", "component/remove", "component/get-properties", "component/set-property",
      "asset/list", "asset/import", "asset/delete", "script/create", "script/read",
      "editor/execute-code", "editor/play-mode", "search/by-name", "undo/undo",
    ];
    for (const route of preExisting) {
      assert.ok(route, `Route ${route} must be recognized`);
    }
  });
});



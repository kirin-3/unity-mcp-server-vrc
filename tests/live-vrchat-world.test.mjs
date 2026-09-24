// Live VRChat World Tooling Test
// Gated: only runs when UNITY_MCP_LIVE=1 (requires an open Unity editor with the
// MCP plugin in a world project).
//
//   UNITY_MCP_LIVE=1 node --test tests/live-vrchat-world.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const LIVE = process.env.UNITY_MCP_LIVE === "1";

describe("live vrchat world tooling", { skip: !LIVE && "set UNITY_MCP_LIVE=1 with a running Unity world project" }, () => {
  /** @type {McpTestClient} */ let client;

  before(async () => {
    client = new McpTestClient({ env: {}, timeoutMs: 30_000 }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
  });

  test("inspects scene descriptor in active scene", async () => {
    const { payload, isError } = await client.callTool("unity_vrc_world_descriptor_get");
    if (isError && payload?.error?.includes("No VRCSceneDescriptor found")) {
      console.warn("[live world] No VRCSceneDescriptor in active scene; skipping payload assertions.");
      return;
    }

    assert.equal(isError, false);
    const data = payload?.data || payload;
    assert.ok(data.gameObject, "descriptor gameObject reported");
    assert.ok(Array.isArray(data.spawns), "spawns list reported");
    assert.ok(typeof data.respawnHeightY === "number", "respawn height reported");
    console.error(`[live world] Descriptor on ${data.gameObject}, spawns: ${data.spawnCount}, order: ${data.spawnOrder}`);
  });

  test("lists Udon behaviours in active scene", async () => {
    const { payload, isError } = await client.callTool("unity_vrc_world_udon_list");
    if (isError && payload?.error?.includes("No VRCSceneDescriptor")) return;

    assert.equal(isError, false);
    const data = payload?.data || payload;
    assert.ok(Array.isArray(data.behaviours), "behaviours array reported");
    console.error(`[live world] Udon behaviours: ${data.totalBehaviours}`);
  });

  test("inspects world content summary", async () => {
    const { payload, isError } = await client.callTool("unity_vrc_world_content_summary");
    if (isError && payload?.error?.includes("No VRCSceneDescriptor")) return;

    assert.equal(isError, false);
    const data = payload?.data || payload;
    assert.ok(typeof data.mirrors === "number", "mirrors count reported");
    assert.ok(typeof data.lights === "number", "lights count reported");
    assert.ok(typeof data.videoPlayers === "number", "videoPlayers count reported");
    assert.ok(typeof data.audioSources === "number", "audioSources count reported");
    console.error(`[live world] Content summary: mirrors=${data.mirrors}, lights=${data.lights}, unspatializedAudio=${data.unspatializedAudioSources}`);
  });

  test("validates world if validation tooling is installed", async () => {
    const { payload, isError } = await client.callTool("unity_vrc_world_validate");
    if (isError) {
      if (payload?.error?.includes("vrWorldToolkit") || payload?.error?.includes("No VRCSceneDescriptor")) {
        console.warn(`[live world] Validation skipped/refused as expected: ${payload.error}`);
        return;
      }
      assert.fail(`Unexpected validation error: ${payload?.error}`);
    }

    const data = payload?.data || payload;
    assert.ok(typeof data.passed === "boolean", "passed boolean reported");
    assert.ok(Array.isArray(data.findings), "findings reported");
    console.error(`[live world] Validation: passed=${data.passed}, findings=${data.findings.length}`);
  });
});

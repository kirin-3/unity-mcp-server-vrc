// Live VRChat Avatar Performance Analysis Test
// Gated: only runs when UNITY_MCP_LIVE=1 (requires an open Unity editor with the
// MCP plugin in an avatar project, e.g. D:/ALCOM/Projects/Sacha).
//
//   UNITY_MCP_LIVE=1 node --test tests/live-vrchat-avatar.test.mjs

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { McpTestClient } from "./helpers/mcp-client.mjs";

const LIVE = process.env.UNITY_MCP_LIVE === "1";

describe("live vrchat avatar analysis", { skip: !LIVE && "set UNITY_MCP_LIVE=1 with a running Unity avatar project" }, () => {
  /** @type {McpTestClient} */ let client;

  before(async () => {
    client = new McpTestClient({ env: {}, timeoutMs: 30_000 }).start();
    await client.initialize();
  });

  after(async () => {
    await client.close();
  });

  test("runs performance analysis against active avatar and verifies rank and limiting stat", async () => {
    const listRes = await client.callTool("unity_list_instances");
    const avatarInstance = listRes.payload.instances?.find((i) =>
      i.projectName?.toLowerCase().includes("sacha") || i.projectPath?.toLowerCase().includes("sacha")
    );
    if (avatarInstance) {
      await client.callTool("unity_select_instance", { port: avatarInstance.port });
    }

    const { payload, isError } = await client.callTool("unity_vrc_avatar_performance");
    if (isError && payload?.error?.includes("No avatar found")) {
      console.warn("[live] No avatar loaded in active scene; skipping payload assertions.");
      return;
    }

    assert.equal(isError, false);
    const data = payload?.data || payload;
    assert.ok(data.rank, "overall performance rank must be reported");
    assert.ok(["Excellent", "Good", "Medium", "Poor", "VeryPoor"].includes(data.rank), `valid rank: ${data.rank}`);
    assert.ok(data.limitingCategory, "limiting category must be identified");
    assert.ok(data.categories, "contributing statistics must be reported");
    console.error(`[live avatar] Avatar: ${data.avatarName}, Rank: ${data.rank}, Limiting: ${data.limitingCategory}, Tooling: ${JSON.stringify(data.buildTooling)}`);
  });

  test("runs parameter budget analysis against active avatar", async () => {
    const { payload, isError } = await client.callTool("unity_vrc_avatar_parameters");
    if (isError && payload?.error?.includes("No avatar found")) return;

    assert.equal(isError, false);
    const data = payload?.data || payload;
    assert.equal(data.limit, 256);
    assert.ok(typeof data.totalUsed === "number");
    assert.ok(typeof data.remaining === "number");
    assert.ok(Array.isArray(data.parameters));
    console.error(`[live avatar] Parameter budget: ${data.totalUsed}/${data.limit} bits, parameters: ${data.parameters.length}`);
  });

  test("runs audit against active avatar", async () => {
    const { payload, isError } = await client.callTool("unity_vrc_avatar_audit");
    if (isError && payload?.error?.includes("No avatar found")) return;

    assert.equal(isError, false);
    const data = payload?.data || payload;
    assert.ok(data.writeDefaults, "writeDefaults audit present");
    assert.ok(Array.isArray(data.missingScripts), "missingScripts audit present");
    assert.ok(data.textureMemory, "textureMemory audit present");
    console.error(`[live avatar] Audit: WD consistent=${data.writeDefaults.consistent}, missingScripts=${data.missingScriptsCount}, textureMB=${data.textureMemory.totalMB}`);
  });
});

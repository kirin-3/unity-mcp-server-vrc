// VRChat Project Context Tool
import * as vrchatBridge from "../vrchat-bridge.js";
import { formatResult } from "../response-format.js";
import { resolveVRChatContext, setCachedVRChatContext } from "../vrchat-detect.js";
import { getTargetInstance } from "../instance-discovery.js";

export const vrchatTools = [
  {
    name: "unity_vrc_get_project_context",
    description:
      "Get VRChat project type (avatar/world/none), SDK version, and ecosystem package availability.",
    vrchatProjectType: "any",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (args = {}) => {
      const inst = getTargetInstance();
      try {
        const res = await vrchatBridge.vrcGetProjectContext(args);
        if (res && res.success !== false) {
          // The plugin is authoritative (it can see compiled defines and loaded
          // assemblies); refresh the server's filesystem-derived cache from its
          // answer so a detection miss does not persist for the whole session.
          const ctx = res.data ?? res;
          if (inst?.port && ctx?.projectType) {
            setCachedVRChatContext(inst.port, {
              projectType: ctx.projectType,
              sdkVersion: ctx.sdkVersion ?? null,
              packages: ctx.packages ?? {},
            });
          }
          return formatResult(res);
        }
      } catch {}

      return formatResult({ success: true, data: resolveVRChatContext(inst) });
    },
  },
  {
    name: "unity_vrc_build",
    description:
      "Build the avatar or world with the VRChat SDK's own builder, as the SDK panel's Build button does: runs the build " +
      "preprocessors (VRCFury, NDMF, optimizers) and the SDK's validation, and reports errors and bundle size. " +
      "test:true runs Build & Test instead (an avatar joins the local test avatars; a world opens in a local VRChat client). Never uploads.",
    vrchatProjectType: "any",
    pluginFeature: "VRCHAT_BUILD",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: { type: "string", description: "Avatar GameObject path or name (avatar projects; default: the scene's avatar)." },
        test: { type: "boolean", description: "Build & Test locally instead of only building (default false). For a world this launches VRChat." },
      },
    },
    handler: async (args) => formatResult(await vrchatBridge.vrcBuild(args)),
  },
];

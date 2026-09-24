// VRChat World Tools
import { formatResult } from "../response-format.js";
import {
  vrcWorldDescriptorGet,
  vrcWorldDescriptorAddSpawn,
  vrcWorldDescriptorSetSpawns,
  vrcWorldUdonList,
  vrcWorldUdonGetVariables,
  vrcWorldUdonSetVariable,
  vrcWorldValidate,
  vrcWorldContentSummary,
  vrcUdonSharpCreate,
  vrcUdonSharpAttach,
} from "../vrchat-bridge.js";

export const vrchatWorldTools = [
  {
    name: "unity_vrc_world_descriptor_get",
    description: "Inspect VRChat world scene descriptor, spawn points, spawn order, respawn height, and reference camera.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (args) => {
      const result = await vrcWorldDescriptorGet(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_spawn_add",
    description: "Add a spawn point GameObject at position/rotation and register it with the VRChat scene descriptor.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Spawn point GameObject name.",
        },
        position: {
          type: "array",
          items: { type: "number" },
          description: "Spawn position [x, y, z].",
        },
        rotation: {
          type: "array",
          items: { type: "number" },
          description: "Spawn rotation euler angles [x, y, z].",
        },
        parentPath: {
          type: "string",
          description: "Optional parent GameObject path.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcWorldDescriptorAddSpawn(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_descriptor_set_spawns",
    description: "Configure scene descriptor spawn points, spawn order, respawn height, or reference camera.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {
        spawns: {
          type: "array",
          items: { type: "string" },
          description: "Array of spawn point GameObject paths or names.",
        },
        spawnOrder: {
          type: "string",
          description: "Spawn order (First, Sequential, Random, Demographic).",
        },
        respawnHeightY: {
          type: "number",
          description: "Respawn height Y threshold.",
        },
        referenceCamera: {
          type: "string",
          description: "Reference camera GameObject path.",
        },
        forbidUserPortals: {
          type: "boolean",
          description: "Whether to forbid user portals.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcWorldDescriptorSetSpawns(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_udon_list",
    description: "List all Udon behaviours in the open scene with object path, program name, and variable count.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (args) => {
      const result = await vrcWorldUdonList(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_udon_get_variables",
    description: "Read public variables on an Udon behaviour with name, type, and current value.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: {
          type: "string",
          description: "Target GameObject path containing UdonBehaviour.",
        },
      },
      required: ["targetPath"],
    },
    handler: async (args) => {
      const result = await vrcWorldUdonGetVariables(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_udon_set_variable",
    description: "Write a public variable on an Udon behaviour with strict type safety.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: {
          type: "string",
          description: "Target GameObject path containing UdonBehaviour.",
        },
        name: {
          type: "string",
          description: "Variable name to write.",
        },
        value: {
          description: "New value. Must match the variable's type.",
        },
      },
      required: ["targetPath", "name", "value"],
    },
    handler: async (args) => {
      const result = await vrcWorldUdonSetVariable(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_validate",
    description: "Run world validation tooling (VRWorldToolkit) and report findings with severity and affected objects.",
    vrchatProjectType: "world",
    vrchatIntegration: "vrWorldToolkit",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (args) => {
      const result = await vrcWorldValidate(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_world_content_summary",
    description: "Inspect world content (mirrors, audio spatialization, lights, video players) and flag unspatialized audio.",
    vrchatProjectType: "world",
    inputSchema: {
      type: "object",
      properties: {},
    },
    handler: async (args) => {
      const result = await vrcWorldContentSummary(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_udonsharp_create",
    description:
      "Create an UdonSharp behaviour: writes the script (an existing one given no content is kept) and its program asset. With attachTo, waits for compilation and adds it to that GameObject.",
    vrchatProjectType: "world",
    pluginFeature: "VRCHAT_AUTHORING_V2",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Script path, e.g. 'Assets/Scripts/Door.cs'. The class is named after the file." },
        content: { type: "string", description: "Full C# source deriving from UdonSharpBehaviour (default: UdonSharp's template)." },
        overwrite: { type: "boolean", description: "Replace an existing program asset, or an existing script when content is given." },
        attachTo: { type: "string", description: "GameObject path to add the behaviour to once compiled." },
      },
      required: ["path"],
    },
    handler: async (args) => formatResult(await vrcUdonSharpCreate(args)),
  },
  {
    name: "unity_vrc_udonsharp_attach",
    description: "Add an UdonSharp behaviour (and its backing UdonBehaviour) to a GameObject, waiting while Unity compiles it.",
    vrchatProjectType: "world",
    pluginFeature: "VRCHAT_AUTHORING_V2",
    inputSchema: {
      type: "object",
      properties: {
        targetPath: { type: "string", description: "GameObject path." },
        scriptPath: { type: "string", description: "The behaviour's script path; or give className or programAssetPath." },
        className: { type: "string" },
        programAssetPath: { type: "string" },
      },
      required: ["targetPath"],
    },
    handler: async (args) => formatResult(await vrcUdonSharpAttach(args)),
  },
];

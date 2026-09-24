// VRChat Shader Tools (Poiyomi)
import { formatResult } from "../response-format.js";
import {
  vrcPoiyomiStatus,
  vrcPoiyomiLock,
  vrcPoiyomiUnlock,
  vrcPoiyomiGetProperty,
  vrcPoiyomiSetProperty,
} from "../vrchat-bridge.js";

export const vrchatShaderTools = [
  {
    name: "unity_vrc_poiyomi_status",
    description: "List Poiyomi materials on an avatar or project with asset path and lock state.",
    vrchatIntegration: "poiyomi",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Target avatar GameObject path or name. Defaults to active scene materials.",
        },
        materialPath: {
          type: "string",
          description: "Target specific material asset path or name.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPoiyomiStatus(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_poiyomi_lock",
    description: "Lock Poiyomi materials into optimized shaders for upload.",
    vrchatIntegration: "poiyomi",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Target avatar to lock all Poiyomi materials on.",
        },
        materials: {
          type: "array",
          items: { type: "string" },
          description: "List of material asset paths or names to lock.",
        },
        materialPath: {
          type: "string",
          description: "Single material asset path or name to lock.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPoiyomiLock(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_poiyomi_unlock",
    description: "Unlock Poiyomi materials to allow editing and parameter modification.",
    vrchatIntegration: "poiyomi",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Target avatar to unlock all Poiyomi materials on.",
        },
        materials: {
          type: "array",
          items: { type: "string" },
          description: "List of material asset paths or names to unlock.",
        },
        materialPath: {
          type: "string",
          description: "Single material asset path or name to unlock.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPoiyomiUnlock(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_poiyomi_get_property",
    description: "Read properties, textures, or keywords from a Poiyomi material.",
    vrchatIntegration: "poiyomi",
    inputSchema: {
      type: "object",
      required: ["materialPath"],
      properties: {
        materialPath: {
          type: "string",
          description: "Material asset path or name.",
        },
        propertyName: {
          type: "string",
          description: "Optional shader property or keyword name. Omit to list all.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPoiyomiGetProperty(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_poiyomi_set_property",
    description: "Set a property on a Poiyomi material with lock protection and auto-unlock support.",
    vrchatIntegration: "poiyomi",
    inputSchema: {
      type: "object",
      required: ["materialPath", "propertyName", "value"],
      properties: {
        materialPath: {
          type: "string",
          description: "Material asset path or name.",
        },
        propertyName: {
          type: "string",
          description: "Shader property name or keyword.",
        },
        value: {
          description: "Value to set (number, RGBA array, hex string, or texture path).",
        },
        unlockIfLocked: {
          type: "boolean",
          description: "Automatically unlock the material if currently locked (default false).",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPoiyomiSetProperty(args);
      return formatResult(result);
    },
  },
];

// VRChat Avatar Tools
import { formatResult } from "../response-format.js";
import {
  vrcAvatarPerformance,
  vrcAvatarParameters,
  vrcAvatarAudit,
  vrcAvatarDescriptorGet,
  vrcAvatarDescriptorSetVisemes,
  vrcAvatarDescriptorSetPlayableLayer,
  vrcAvatarParameterCreate,
  vrcAvatarMenuGet,
  vrcAvatarMenuAddControl,
  vrcPhysboneAdd,
  vrcPhysboneConfigure,
  vrcPhysboneList,
  vrcContactAdd,
  vrcContactList,
  vrcAvatarNonDestructiveList,
  vrcModularAvatarAdd,
  vrcVrcfuryAdd,
} from "../vrchat-bridge.js";

export const vrchatAvatarTools = [
  {
    name: "unity_vrc_avatar_performance",
    description: "Analyze VRChat avatar performance rank, limiting statistic, and contributing metrics against thresholds.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name in scene. Defaults to active avatar.",
        },
        isMobile: {
          type: "boolean",
          description: "Target mobile/Quest limits instead of PC.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarPerformance(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_parameters",
    description: "Inspect VRChat avatar expression parameter memory budget, per-parameter costs, and build-contributed parameters.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name in scene. Defaults to active avatar.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarParameters(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_audit",
    description: "Audit avatar for Write Defaults consistency across layers, missing scripts by object path, and texture memory.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name in scene. Defaults to active avatar.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarAudit(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_descriptor_get",
    description: "Read avatar descriptor configuration (view position, lip sync, eye look, playable layers, expressions).",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name in scene.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarDescriptorGet(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_descriptor_set_visemes",
    description: "Assign viseme blendshapes to descriptor from conventional names, reporting unmatched visemes unmapped.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        meshPath: {
          type: "string",
          description: "Target SkinnedMeshRenderer path or name.",
        },
        mapping: {
          type: "object",
          description: "Optional manual overrides mapping viseme name to blendshape name.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarDescriptorSetVisemes(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_descriptor_set_playable_layer",
    description: "Assign an AnimatorController to an avatar playable layer (FX, Gesture, Action, Base, etc.).",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      required: ["layerType"],
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        layerType: {
          type: "string",
          description: "Playable layer name (e.g. 'FX', 'Gesture', 'Action', 'Base').",
        },
        controllerPath: {
          type: "string",
          description: "Asset path to AnimatorController, or empty to reset to default.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarDescriptorSetPlayableLayer(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_parameter_add",
    description: "Add or modify an expression parameter with 256-bit synced memory limit validation.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        parametersAssetPath: {
          type: "string",
          description: "Direct asset path to VRCExpressionParameters.",
        },
        name: {
          type: "string",
          description: "Parameter name.",
        },
        type: {
          type: "string",
          enum: ["Bool", "Int", "Float"],
          description: "Parameter type (default Bool).",
        },
        defaultValue: {
          description: "Default value (number or boolean).",
        },
        saved: {
          type: "boolean",
          description: "Save value between sessions (default true).",
        },
        synced: {
          type: "boolean",
          description: "Network synced parameter taking budget bits (default true).",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarParameterCreate(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_menu_get",
    description: "Read controls and submenus in an avatar expression menu.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        menuAssetPath: {
          type: "string",
          description: "Direct asset path to VRCExpressionsMenu.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarMenuGet(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_menu_add_control",
    description: "Add a control to an expression menu with 8-control limit validation.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        menuAssetPath: {
          type: "string",
          description: "Direct asset path to VRCExpressionsMenu.",
        },
        name: {
          type: "string",
          description: "Control label.",
        },
        type: {
          type: "string",
          enum: ["Button", "Toggle", "SubMenu", "TwoAxisPuppet", "FourAxisPuppet", "RadialPuppet"],
          description: "Control type.",
        },
        parameter: {
          type: "string",
          description: "Expression parameter name.",
        },
        value: {
          type: "number",
          description: "Parameter value when activated.",
        },
        subMenuAssetPath: {
          type: "string",
          description: "Target submenu asset path if type is SubMenu.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarMenuAddControl(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_physbone_add",
    description: "Add and configure a VRCPhysBone on a bone chain.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        targetPath: {
          type: "string",
          description: "Target GameObject path to attach PhysBone to.",
        },
        rootTransformPath: {
          type: "string",
          description: "Transform root of the bone chain.",
        },
        pull: {
          type: "number",
          description: "Pull force returning bone to rest position.",
        },
        spring: {
          type: "number",
          description: "Spring oscillation force.",
        },
        damping: {
          type: "number",
          description: "Movement damping.",
        },
        gravity: {
          type: "number",
          description: "Gravity force.",
        },
        stiffness: {
          type: "number",
          description: "Chain stiffness.",
        },
        immobility: {
          type: "number",
          description: "Parent motion resistance.",
        },
        radius: {
          type: "number",
          description: "Collision radius.",
        },
        allowGrabbing: {
          type: "boolean",
          description: "Allow players to grab the bone.",
        },
        allowPosing: {
          type: "boolean",
          description: "Allow players to pose the bone.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPhysboneAdd(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_physbone_configure",
    description: "Modify parameters on an existing VRCPhysBone component.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        targetPath: {
          type: "string",
          description: "Target GameObject path carrying the PhysBone.",
        },
        pull: { type: "number" },
        spring: { type: "number" },
        damping: { type: "number" },
        gravity: { type: "number" },
        stiffness: { type: "number" },
        immobility: { type: "number" },
        radius: { type: "number" },
        allowGrabbing: { type: "boolean" },
        allowPosing: { type: "boolean" },
      },
    },
    handler: async (args) => {
      const result = await vrcPhysboneConfigure(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_physbone_list",
    description: "List all PhysBones on an avatar with root, parameters, and affected transform count.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcPhysboneList(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_contact_add",
    description: "Add a VRCContactSender or VRCContactReceiver with shape, tags, and parameters.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        targetPath: {
          type: "string",
          description: "Target GameObject path to attach contact to.",
        },
        type: {
          type: "string",
          enum: ["sender", "receiver"],
          description: "Contact type (sender or receiver).",
        },
        shape: {
          type: "string",
          enum: ["Sphere", "Capsule"],
          description: "Collision shape.",
        },
        radius: {
          type: "number",
          description: "Sphere or capsule radius.",
        },
        height: {
          type: "number",
          description: "Capsule height.",
        },
        collisionTags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for matching collisions.",
        },
        parameter: {
          type: "string",
          description: "Receiver output parameter name.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcContactAdd(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_contact_list",
    description: "List all contact senders and receivers on an avatar.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcContactList(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_avatar_non_destructive_list",
    description: "List all Modular Avatar and VRCFury components on an avatar with object path and role.",
    vrchatProjectType: "avatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcAvatarNonDestructiveList(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_modular_avatar_add",
    description: "Add a Modular Avatar component to an avatar GameObject (requires Modular Avatar package).",
    vrchatProjectType: "avatar",
    vrchatIntegration: "modularAvatar",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        targetPath: {
          type: "string",
          description: "Target GameObject path.",
        },
        componentType: {
          type: "string",
          description: "Component type name (e.g. 'ModularAvatarMergeAnimator').",
        },
      },
    },
    handler: async (args) => {
      const result = await vrcModularAvatarAdd(args);
      return formatResult(result);
    },
  },
  {
    name: "unity_vrc_vrcfury_add",
    description:
      "Add a VRCFury component carrying one feature (e.g. Toggle, ArmatureLink, FullController) to an avatar GameObject (requires VRCFury package).",
    vrchatProjectType: "avatar",
    vrchatIntegration: "vrcfury",
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: {
          type: "string",
          description: "Avatar GameObject path or name.",
        },
        targetPath: {
          type: "string",
          description: "Target GameObject path.",
        },
        feature: {
          type: "string",
          description:
            "VRCFury feature class name (VF.Model.Feature.*), e.g. 'Toggle', 'ArmatureLink', 'FullController'. An unknown name returns the list of valid ones.",
        },
      },
      required: ["feature"],
    },
    handler: async (args) => {
      const result = await vrcVrcfuryAdd(args);
      return formatResult(result);
    },
  },
];

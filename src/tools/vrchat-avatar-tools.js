// VRChat Avatar Tools
import { formatResult, imageResultBlocks } from "../response-format.js";
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
  vrcVrcfuryToggle,
  vrcVrcfuryArmatureLink,
  vrcOutfitAttach,
  vrcPlaymodeTest,
  vrcBlendshapesList,
  vrcBlendshapesSet,
} from "../vrchat-bridge.js";

const AUTHORING_V2 = "VRCHAT_AUTHORING_V2";
const avatarPathProperty = { type: "string", description: "Avatar GameObject path or name." };

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
    description:
      "Audit the baked avatar: Write Defaults consistency, missing scripts, texture memory, animation paths that no longer resolve, mismatched mesh bounds, and Anchor Overrides.",
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
    description:
      "Add or modify an expression parameter. Reports the authored asset's synced bit total but never refuses over 256: VRCFury's Parameter Compressor can fit it at build. Use unity_vrc_avatar_parameters for the built avatar's real total.",
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
        includeDetails: {
          type: "boolean",
          description: "Also return each component's settings (MA fields, VRCFury feature).",
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
  {
    name: "unity_vrc_vrcfury_toggle",
    description:
      "Create or update a VRCFury Toggle, found by its menu path: objects on/off, blendshapes, material swaps, saved, default on. An update replaces only its object, blendshape and material actions.",
    vrchatProjectType: "avatar",
    vrchatIntegration: "vrcfury",
    pluginFeature: AUTHORING_V2,
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: avatarPathProperty,
        menuPath: { type: "string", description: "Menu path, e.g. 'Clothing/Jacket'. Identifies the toggle." },
        targetPath: { type: "string", description: "Object under the avatar that holds a new toggle (default: avatar root)." },
        objects: {
          type: "array",
          description: "Objects the toggle turns on (mode 'on', default) or off.",
          items: {
            type: "object",
            properties: { path: { type: "string" }, mode: { type: "string", enum: ["on", "off"] } },
            required: ["path"],
          },
        },
        blendShapes: {
          type: "array",
          description: "Blendshapes set while on: value 0-100 (default 100); rendererPath limits it to one mesh.",
          items: {
            type: "object",
            properties: { name: { type: "string" }, value: { type: "number" }, rendererPath: { type: "string" } },
            required: ["name"],
          },
        },
        materials: {
          type: "array",
          description: "Material swaps while on: renderer path, slot (default 0), material asset path.",
          items: {
            type: "object",
            properties: { rendererPath: { type: "string" }, slot: { type: "number" }, material: { type: "string" } },
            required: ["rendererPath", "material"],
          },
        },
        saved: { type: "boolean", description: "Keep the state between worlds." },
        defaultOn: { type: "boolean", description: "On by default." },
        slider: { type: "boolean", description: "Radial slider instead of on/off." },
        exclusiveTags: {
          type: "array",
          items: { type: "string" },
          description: "Turning this on turns off other toggles with a shared tag.",
        },
        exclusiveOffState: { type: "boolean", description: "On whenever every toggle sharing its tags is off." },
        globalParam: { type: "string", description: "Use this parameter name instead of a generated one." },
      },
      required: ["menuPath"],
    },
    handler: async (args) => formatResult(await vrcVrcfuryToggle(args)),
  },
  {
    name: "unity_vrc_vrcfury_armature_link",
    description:
      "Add or update a VRCFury Armature Link on a prop or clothing object and report which of its bones link to avatar bones.",
    vrchatProjectType: "avatar",
    vrchatIntegration: "vrcfury",
    pluginFeature: AUTHORING_V2,
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: avatarPathProperty,
        targetPath: { type: "string", description: "Prop or clothing object under the avatar." },
        propBonePath: { type: "string", description: "Bone to link, relative to targetPath (default: found, e.g. 'Armature/Hips')." },
        linkTo: { type: "string", description: "Humanoid bone name or avatar path (default 'Hips')." },
        recursive: { type: "boolean", description: "Also link child bones by name, as clothing needs (default: detected)." },
        align: { type: "boolean", description: "Snap the prop bone onto the avatar bone (default: same as recursive)." },
        removeBoneSuffix: { type: "string", description: "Suffix to strip from prop bone names before matching." },
      },
      required: ["targetPath"],
    },
    handler: async (args) => formatResult(await vrcVrcfuryArmatureLink(args)),
  },
  {
    name: "unity_vrc_outfit_attach",
    description:
      "Put a clothing prefab under a humanoid avatar and merge its armature with Modular Avatar Merge Armature or VRCFury Armature Link, then report bones that won't merge (usually prefix/suffix mismatches) and the fix. A failed attach is undone.",
    vrchatProjectType: "avatar",
    vrchatIntegration: ["modularAvatar", "vrcfury"],
    pluginFeature: AUTHORING_V2,
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: avatarPathProperty,
        outfitPath: { type: "string", description: "Prefab asset path (e.g. 'Assets/Outfits/Hoodie.prefab') or a scene object." },
        method: {
          type: "string",
          enum: ["auto", "modularAvatar", "vrcfury"],
          description: "auto (default): the component the outfit already has, else the installed tool.",
        },
        resetTransform: { type: "boolean", description: "Zero the outfit's local position and rotation (default true for prefabs)." },
      },
      required: ["outfitPath"],
    },
    handler: async (args) => formatResult(await vrcOutfitAttach(args)),
  },
  {
    name: "unity_vrc_playmode_test",
    description:
      "Test an avatar in play mode through Gesture Manager or Av3Emulator: enters play mode if needed, sets parameters and gestures, reads them back, and captures the avatar. Shows whether a toggle really works. Play mode is left running.",
    vrchatProjectType: "avatar",
    vrchatIntegration: ["gestureManager", "av3Emulator"],
    pluginFeature: AUTHORING_V2,
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: avatarPathProperty,
        parameters: { type: "object", description: "Values by parameter name, e.g. {\"Jacket\": true, \"Hue\": 0.5}." },
        gestureLeft: {
          anyOf: [{ type: "integer" }, { type: "string" }],
          description: "0-7 or a name: neutral, fist, open, point, peace, rock, gun, thumbs.",
        },
        gestureRight: { anyOf: [{ type: "integer" }, { type: "string" }], description: "Same as gestureLeft." },
        gestureLeftWeight: { type: "number", description: "Trigger pull 0-1 for analog fist animations." },
        gestureRightWeight: { type: "number", description: "Same as gestureLeftWeight." },
        enterPlayMode: { type: "boolean", description: "Enter play mode when needed (default true)." },
        settleMs: { type: "number", description: "Wait after setting, in ms (default 1000)." },
        capture: { type: "boolean", description: "Return an image (default true)." },
        view: { type: "string", enum: ["front", "back", "left", "right", "face"] },
        width: { type: "number", description: "Image size in pixels (default 512 x 512)." },
        height: { type: "number" },
      },
    },
    handler: async (args) => {
      const result = await vrcPlaymodeTest(args);
      return result?.data?.base64 ? imageResultBlocks(result, "Avatar capture returned no image data") : formatResult(result);
    },
  },
  {
    name: "unity_vrc_blendshapes_list",
    description:
      "List a mesh's blendshape names and weights (default: the face mesh). faceTracking adds Unified Expressions, ARKit and SRanipal coverage.",
    vrchatProjectType: "avatar",
    pluginFeature: AUTHORING_V2,
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: avatarPathProperty,
        meshPath: { type: "string", description: "SkinnedMeshRenderer path under the avatar." },
        filter: { type: "string", description: "Only names containing this text." },
        faceTracking: { type: "boolean", description: "Report face-tracking blendshape coverage." },
      },
    },
    handler: async (args) => formatResult(await vrcBlendshapesList(args)),
  },
  {
    name: "unity_vrc_blendshapes_set",
    description: "Set blendshape weights (0-100) on a mesh by name. Every name is checked before anything changes.",
    vrchatProjectType: "avatar",
    pluginFeature: AUTHORING_V2,
    inputSchema: {
      type: "object",
      properties: {
        avatarPath: avatarPathProperty,
        meshPath: { type: "string", description: "SkinnedMeshRenderer path under the avatar (default: the face mesh)." },
        weights: { type: "object", description: "Weights by blendshape name, e.g. {\"Smile\": 100}." },
      },
      required: ["weights"],
    },
    handler: async (args) => formatResult(await vrcBlendshapesSet(args)),
  },
];

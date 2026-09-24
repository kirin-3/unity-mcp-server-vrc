// VRChat Tool Surface Shaping
// Filters tools based on detected VRChat project type, installed integrations, and
// what the connected plugin's protocol can answer.
import { PLUGIN_FEATURES, pluginSupports } from "./capabilities.js";

/**
 * Is a tool's integration requirement met? `vrchatIntegration` is one package key, or an
 * array of keys where any one installed package is enough (e.g. an outfit can be merged
 * with Modular Avatar or VRCFury).
 */
function integrationAvailable(integration, packages) {
  const keys = Array.isArray(integration) ? integration : [integration];
  return keys.some((key) => Boolean(packages[key]?.available));
}

function describeIntegration(integration) {
  const keys = Array.isArray(integration) ? integration : [integration];
  return keys.map((key) => `"${key}"`).join(" or ");
}

/**
 * Does the connected plugin predate the tool's `pluginFeature`? Only a plugin that reported
 * a protocolVersion is judged: instances known only from the registry (port-routed calls)
 * carry none, and the plugin stays authoritative for those.
 */
function pluginTooOld(tool, instance) {
  if (!tool.pluginFeature) return false;
  if (!instance || typeof instance.protocolVersion !== "number") return false;
  return !pluginSupports(instance, tool.pluginFeature);
}

/**
 * Filter an array of MCP tool definitions based on the active VRChat project context.
 *
 * Rules:
 * 1. Tools without vrchatProjectType and without vrchatIntegration are non-VRChat tools;
 *    they are always preserved.
 * 2. If projectType is 'none', all VRChat tools are omitted (clean non-VRChat surface).
 * 3. If a tool has vrchatProjectType:
 *    - 'avatar': only kept if projectType === 'avatar'
 *    - 'world': only kept if projectType === 'world'
 *    - 'any': kept if projectType === 'avatar' || projectType === 'world'
 * 4. If a tool has vrchatIntegration (a package key, or an array of keys meaning any one):
 *    - only kept if one of those packages is available
 * 5. If a tool has pluginFeature, it is omitted when the instance's plugin reported an
 *    older protocolVersion than the feature needs.
 * 6. A tool with hiddenOnVRChat (a standard tool VRChat has its own route for) is omitted
 *    from VRChat projects. It stays callable by name, where the plugin's guard decides.
 *
 * @param {Array<object>} tools Array of tool definitions
 * @param {object} [projectContext] { projectType, sdkVersion, packages }
 * @param {{protocolVersion?: number}|null} [instance] The instance the list is for.
 * @returns {Array<object>} Filtered array of tools
 */
export function filterToolsForProject(tools, projectContext, instance) {
  if (!Array.isArray(tools)) return [];

  const projType = projectContext?.projectType || "none";
  const packages = projectContext?.packages || {};

  return tools.filter((tool) => {
    if (pluginTooOld(tool, instance)) {
      return false;
    }

    // Non-VRChat tool: keep
    if (!tool.vrchatProjectType && !tool.vrchatIntegration) {
      return !tool.hiddenOnVRChat || projType === "none";
    }

    // VRChat tool against non-VRChat project: omit
    if (projType === "none") {
      return false;
    }

    // Project type filtering
    if (tool.vrchatProjectType) {
      if (tool.vrchatProjectType === "avatar" && projType !== "avatar") {
        return false;
      }
      if (tool.vrchatProjectType === "world" && projType !== "world") {
        return false;
      }
      if (tool.vrchatProjectType === "any" && projType !== "avatar" && projType !== "world") {
        return false;
      }
    }

    // Integration availability filtering
    if (tool.vrchatIntegration && !integrationAvailable(tool.vrchatIntegration, packages)) {
      return false;
    }

    return true;
  });
}

/**
 * Check whether a tool can be invoked against the active project context at call time.
 * If not allowed, returns { allowed: false, reason: string }.
 *
 * @param {object} tool Tool definition
 * @param {object} [projectContext] { projectType, sdkVersion, packages }
 * @param {{protocolVersion?: number}|null} [instance] The instance the call targets.
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkToolProjectGate(tool, projectContext, instance) {
  if (!tool) return { allowed: true };

  const projectGate = checkProjectRequirements(tool, projectContext);
  if (!projectGate.allowed) return projectGate;

  if (pluginTooOld(tool, instance)) {
    return {
      allowed: false,
      reason:
        `Tool "${tool.name}" needs Unity MCP plugin protocol ${PLUGIN_FEATURES[tool.pluginFeature]} or later, ` +
        `but the connected plugin reports protocol ${instance.protocolVersion}. Update the Unity plugin (unity-mcp-plugin-vrc).`,
    };
  }

  return { allowed: true };
}

function checkProjectRequirements(tool, projectContext) {
  // No context at all means we could not inspect the target project (e.g. a
  // port-routed call to an instance that is not in the registry). The plugin is
  // authoritative at execution time, so defer to it rather than refusing blind.
  if (!projectContext) return { allowed: true };

  // Non-VRChat tool
  if (!tool.vrchatProjectType && !tool.vrchatIntegration) {
    return { allowed: true };
  }

  const projType = projectContext?.projectType || "none";
  const packages = projectContext?.packages || {};

  // VRChat tool against non-VRChat project
  if (projType === "none") {
    return {
      allowed: false,
      reason: `Tool "${tool.name}" requires a VRChat project, but the active project type is "none".`,
    };
  }

  // Project type mismatch
  if (tool.vrchatProjectType) {
    if (tool.vrchatProjectType === "avatar" && projType !== "avatar") {
      return {
        allowed: false,
        reason: `Tool "${tool.name}" requires a VRChat avatar project, but the active project type is "${projType}".`,
      };
    }
    if (tool.vrchatProjectType === "world" && projType !== "world") {
      return {
        allowed: false,
        reason: `Tool "${tool.name}" requires a VRChat world project, but the active project type is "${projType}".`,
      };
    }
  }

  // Integration check
  if (tool.vrchatIntegration && !integrationAvailable(tool.vrchatIntegration, packages)) {
    const several = Array.isArray(tool.vrchatIntegration) && tool.vrchatIntegration.length > 1;
    return {
      allowed: false,
      reason: `Tool "${tool.name}" requires the ${describeIntegration(tool.vrchatIntegration)} package to be installed, but ${
        several ? "none of them was" : "it was not"
      } found in the active project.`,
    };
  }

  return { allowed: true };
}

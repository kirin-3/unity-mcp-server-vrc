// VRChat Tool Surface Shaping
// Filters tools based on detected VRChat project type and installed integrations.

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
 * 4. If a tool has vrchatIntegration:
 *    - only kept if packages[vrchatIntegration]?.available === true
 *
 * @param {Array<object>} tools Array of tool definitions
 * @param {object} [projectContext] { projectType, sdkVersion, packages }
 * @returns {Array<object>} Filtered array of tools
 */
export function filterToolsForProject(tools, projectContext) {
  if (!Array.isArray(tools)) return [];

  const projType = projectContext?.projectType || "none";
  const packages = projectContext?.packages || {};

  return tools.filter((tool) => {
    // Non-VRChat tool: keep
    if (!tool.vrchatProjectType && !tool.vrchatIntegration) {
      return true;
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
    if (tool.vrchatIntegration) {
      const integration = packages[tool.vrchatIntegration];
      if (!integration || !integration.available) {
        return false;
      }
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
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function checkToolProjectGate(tool, projectContext) {
  if (!tool) return { allowed: true };

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
  if (tool.vrchatIntegration) {
    const integration = packages[tool.vrchatIntegration];
    if (!integration || !integration.available) {
      return {
        allowed: false,
        reason: `Tool "${tool.name}" requires the "${tool.vrchatIntegration}" package to be installed, but it was not found in the active project.`,
      };
    }
  }

  return { allowed: true };
}

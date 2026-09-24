<p align="center">
  <img src="icon.png" alt="AnkleBreaker MCP" width="140" />
</p>

# Unity MCP Server: VRChat fork

> **This is a fork of [AnkleBreaker-Studio/unity-mcp-server](https://github.com/AnkleBreaker-Studio/unity-mcp-server).** It keeps everything upstream does and adds VRChat avatar and world tooling. Powered by AnkleBreaker MCP.

It's an MCP server that lets Claude, Cursor, or any other MCP client drive the Unity Editor and Unity Hub. It needs the companion Unity plugin fork: **[unity-mcp-plugin-vrc](https://github.com/kirin-3/unity-mcp-plugin-vrc)**.

For the full list of Unity tools, see the [upstream README](https://github.com/AnkleBreaker-Studio/unity-mcp-server#readme).

## Changes in this fork (v2.37.0)

- **39 VRChat tools (`unity_vrc_*`)**
  - **Avatar analysis:** performance rank against PC and Quest limits, the 256-bit synced parameter budget, and an audit of the baked avatar: Write Defaults, missing scripts, texture memory, animation paths that no longer resolve, mesh bounds, and Anchor Overrides.
  - **Avatar authoring:** descriptor inspection, viseme auto-mapping, playable layers, expression parameters that refuse to go over budget, expression menus that respect the 8-control limit, PhysBones, contacts, Modular Avatar and VRCFury components.
  - **VRCFury features:** create or update a Toggle (objects, blendshapes, material swaps, menu path, saved, default) and Armature Link.
  - **Outfits:** attach a clothing prefab with MA Merge Armature or VRCFury Armature Link and get a report of the bones that won't merge.
  - **Play-mode testing:** set parameters and gestures through Gesture Manager or Av3Emulator and get an image of the result, in one call.
  - **Blendshapes:** list and set them by name, with Unified Expressions, ARKit, and SRanipal face-tracking coverage.
  - **Poiyomi:** material lock status, batch lock/unlock, and reading and writing properties.
  - **Worlds:** scene descriptor and spawn points, Udon behaviour listing, type-safe writes to public variables, UdonSharp behaviours (script, program asset, and component), VRWorldToolkit validation, and a content summary that flags unspatialized audio.
  - **Project context:** detects whether the project is an avatar, world, or neither, plus the ecosystem packages installed (MA, NDMF, VRCFury, d4rk, VRWorldToolkit, Gesture Manager, Av3Emulator, Poiyomi).
- **Project-aware tool list:** avatar projects only see avatar tools and world projects only see world tools. Non-VRChat projects see no VRChat tools.
- **VRChat safety guards:** on a VRChat project, `unity_build`, the player/quality/physics settings tools, and edits to reserved layers 0–22 or their collision matrix are refused. Pass `override: true` on a single call to run one anyway. There is no global switch for this.
- **Trimmed default surface:** UMA, Amplify, MPPM, Input System, and NavMesh tools are pinned to the advanced tier. You can still reach them through `unity_advanced_tool`.
- **Plugin protocol:** the server only advertises the VRChat tools the connected plugin can answer (protocol 2 for the original set, protocol 4 for the authoring tools above). Updating the plugin mid-session is picked up on the next call.
- **Tests:** unit tests for detection and tool-surface shaping, protocol tests, and live avatar and world suites.

See [CHANGELOG.md](CHANGELOG.md) for details.

## Quick start

1. In Unity, go to **Window > Package Manager > + > Add package from git URL** and enter:
   ```
   https://github.com/kirin-3/unity-mcp-plugin-vrc.git
   ```
2. Clone and install the server:
   ```bash
   git clone https://github.com/kirin-3/unity-mcp-server-vrc.git
   cd unity-mcp-server-vrc && npm install
   ```
3. Add the server to your MCP client config:
   ```json
   {
     "mcpServers": {
       "unity": {
         "command": "node",
         "args": ["C:/path/to/unity-mcp-server-vrc/src/index.js"]
       }
     }
   }
   ```

Requires Node.js 18+ and Unity 2021.3+ (VRChat projects use 2022.3). Environment variables are the same as upstream.

No tool uploads or publishes anything to VRChat.

## License

AnkleBreaker Open License v1.0 (see [LICENSE](LICENSE)). **Powered by AnkleBreaker MCP.** Free to use; reselling is not allowed.

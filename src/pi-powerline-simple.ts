import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ReadonlyFooterDataProvider,
  Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { readSettings, writePowerlinePresetSetting } from "./settings.ts";
import { renderStatusLines } from "./status-line.ts";
import { CoreContextUsageCache } from "./upstream/context-usage.ts";
import {
  getGitStatus,
  invalidateGitBranch,
  invalidateGitStatus,
  subscribeGitUpdates,
} from "./upstream/git-status.ts";
import {
  collectHiddenExtensionStatusKeys,
  configForWidth,
  getNotificationExtensionStatuses,
  mergeSegmentOptions,
  parsePowerlineConfig,
  type PowerlineConfig,
} from "./upstream/powerline-config.ts";
import { getAgentPath } from "./upstream/paths.ts";
import { PRESETS, getPreset } from "./upstream/presets.ts";
import { createRenderScheduler } from "./upstream/render-scheduler.ts";
import { getDefaultColors } from "./upstream/theme.ts";
import { SessionBranchCache, SessionTokenStatsCache } from "./upstream/token-stats.ts";
import type {
  ColorScheme,
  QueueSummary,
  SegmentContext,
  StatusLinePreset,
} from "./upstream/types.ts";

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];
const CUSTOM_COMPACTION_STATUS_KEY = "compact-policy";
const EMPTY_QUEUE_SUMMARY: QueueSummary = {
  queueCount: 0,
  ideaCount: 0,
  blockedCount: 0,
  compacting: false,
  leadingText: null,
  leadingIntent: null,
  leadingStatus: null,
};

interface AssistantUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens?: number;
  cost: { total: number };
}

interface AssistantMessageLike {
  role: "assistant";
  stopReason?: string;
  usage: AssistantUsage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasAssistantUsage(value: unknown): value is AssistantUsage {
  return isRecord(value)
    && typeof value.input === "number"
    && typeof value.output === "number"
    && typeof value.cacheRead === "number"
    && typeof value.cacheWrite === "number"
    && isRecord(value.cost)
    && typeof value.cost.total === "number";
}

function isAssistantMessage(value: unknown): value is AssistantMessageLike {
  return isRecord(value)
    && value.role === "assistant"
    && hasAssistantUsage(value.usage)
    && (value.stopReason === undefined || typeof value.stopReason === "string");
}

function usageTokenTotal(usage: AssistantUsage): number {
  return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

function readBooleanSetting(path: string): boolean | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(parsed) && typeof parsed.enabled === "boolean" ? parsed.enabled : false;
  } catch (error) {
    console.debug(`[pi-powerline-simple] Failed to read ${path}:`, error);
    return false;
  }
}

function customCompactionEnabled(cwd: string): boolean {
  if (!existsSync(getAgentPath("extensions", "pi-custom-compaction"))) return false;
  const project = readBooleanSetting(join(cwd, ".pi", "compaction-policy.json"));
  return project ?? readBooleanSetting(getAgentPath("compaction-policy.json")) ?? false;
}

function configuredAutoCompaction(settings: Record<string, unknown>): boolean {
  return !isRecord(settings.compaction) || settings.compaction.enabled !== false;
}

function runtimeAutoCompaction(ctx: ExtensionContext, fallback: boolean): boolean {
  const manager = Reflect.get(ctx as object, "settingsManager");
  if (!isRecord(manager)) return fallback;
  const getter = manager.getCompactionSettings;
  if (typeof getter !== "function") return fallback;
  const value = getter.call(manager);
  return isRecord(value) && typeof value.enabled === "boolean" ? value.enabled : fallback;
}

function usingSubscription(ctx: ExtensionContext): boolean {
  return ctx.model ? ctx.modelRegistry.isUsingOAuth(ctx.model) : false;
}

function mightChangeGitBranch(command: string): boolean {
  return [
    /\bgit\s+(checkout|switch|branch\s+-[dDmM]|merge|rebase|pull|reset|worktree)/,
    /\bgit\s+stash\s+(pop|apply)/,
  ].some((pattern) => pattern.test(command));
}

function warnInvalidConfig(ctx: ExtensionContext, config: PowerlineConfig): void {
  const displays = config.narrow ? [config, config.narrow.config] : [config];
  for (const display of displays) {
    if (display.invalidDisabledSegments.length > 0) {
      ctx.ui.notify(`Ignoring unknown powerline disabled segments: ${display.invalidDisabledSegments.join(", ")}`, "warning");
    }
    if (display.invalidLayoutSegments.length > 0) {
      ctx.ui.notify(`Ignoring unknown powerline layout segments: ${display.invalidLayoutSegments.join(", ")}`, "warning");
    }
  }
}

export default function piPowerlineSimple(pi: ExtensionAPI): void {
  let enabled = true;
  let config = parsePowerlineConfig(undefined, PRESET_NAMES);
  let settings: Record<string, unknown> = {};
  let currentCtx: ExtensionContext | null = null;
  let footerDataRef: ReadonlyFooterDataProvider | null = null;
  let requestTuiRender: (() => void) | null = null;
  let sessionStartedAt = Date.now();
  let isStreaming = false;
  let liveAssistantUsage: AssistantUsage | null = null;
  let selectedThinkingLevel: string | null = null;
  let hasCustomCompaction = false;

  const branchCache = new SessionBranchCache();
  const tokenStatsCache = new SessionTokenStatsCache();
  const contextUsageCache = new CoreContextUsageCache();
  const scheduler = createRenderScheduler(() => requestTuiRender?.(), 33);

  const resetCaches = () => {
    branchCache.reset();
    tokenStatsCache.reset();
    contextUsageCache.reset();
  };

  const requestRender = (immediate = false) => scheduler.schedule(immediate ? 0 : undefined);

  const buildContext = (ctx: ExtensionContext, theme: Theme, activeConfig: PowerlineConfig): SegmentContext => {
    const preset = getPreset(activeConfig.preset);
    const colors: ColorScheme = preset.colors ?? getDefaultColors();
    const branch = branchCache.get(ctx.sessionManager);
    const tokenStats = tokenStatsCache.get(branch);
    const latestUsage = isStreaming
      ? liveAssistantUsage ?? (tokenStats.lastAssistant?.usage as AssistantUsage | undefined)
      : tokenStats.lastAssistant?.usage as AssistantUsage | undefined;
    const coreContext = isStreaming && liveAssistantUsage ? null : contextUsageCache.get(ctx);
    const contextTokens = coreContext?.contextTokens ?? (latestUsage ? usageTokenTotal(latestUsage) : 0);
    const contextWindow = coreContext?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const contextPercent = coreContext?.contextPercent
      ?? (contextWindow > 0 ? (contextTokens / contextWindow) * 100 : 0);
    const options = mergeSegmentOptions(preset.segmentOptions, activeConfig.segmentOptions);
    const extensionStatuses = footerDataRef?.getExtensionStatuses() ?? new Map<string, string>();
    const providerBranch = footerDataRef?.getGitBranch() ?? null;

    return {
      model: ctx.model,
      thinkingLevel: selectedThinkingLevel ?? tokenStats.thinkingLevelFromSession ?? ctx.thinkingLevel ?? "off",
      sessionId: ctx.sessionManager.getSessionId(),
      cwd: ctx.cwd,
      usageStats: {
        input: tokenStats.input,
        output: tokenStats.output,
        cacheRead: tokenStats.cacheRead,
        cacheWrite: tokenStats.cacheWrite,
        cost: tokenStats.cost,
        subagentCost: tokenStats.subagentCost,
      },
      contextTokens,
      contextPercent,
      contextWindow,
      autoCompactEnabled: runtimeAutoCompaction(ctx, configuredAutoCompaction(settings)),
      customCompactionEnabled: hasCustomCompaction || extensionStatuses.has(CUSTOM_COMPACTION_STATUS_KEY),
      usingSubscription: usingSubscription(ctx),
      queueSummary: EMPTY_QUEUE_SUMMARY,
      sessionStartTime: sessionStartedAt,
      shellModeActive: false,
      shellRunning: false,
      shellName: null,
      shellCwd: null,
      git: getGitStatus(providerBranch, options.git?.polling),
      extensionStatuses,
      hiddenExtensionStatusKeys: collectHiddenExtensionStatusKeys(activeConfig.customItems),
      customItemsById: new Map(activeConfig.customItems.map((item) => [item.id, item])),
      options,
      theme,
      colors,
    };
  };

  const installFooter = (ctx: ExtensionContext) => {
    ctx.ui.setFooter((tui, theme, footerData) => {
      requestTuiRender = () => tui.requestRender();
      footerDataRef = footerData;
      const unsubscribeBranch = footerData.onBranchChange(() => requestRender(true));
      const unsubscribeGit = subscribeGitUpdates(() => requestRender());
      const refresh = setInterval(() => requestRender(), 1_000);
      refresh.unref?.();

      const writableFooterData = footerData as ReadonlyFooterDataProvider & {
        setExtensionStatus?: (key: string, text: string | undefined) => void;
        clearExtensionStatuses?: () => void;
      };
      const originalSetStatus = writableFooterData.setExtensionStatus;
      const originalClearStatuses = writableFooterData.clearExtensionStatuses;
      if (originalSetStatus) {
        writableFooterData.setExtensionStatus = function setExtensionStatusAndRender(key, text) {
          originalSetStatus.call(this, key, text);
          requestRender(true);
        };
      }
      if (originalClearStatuses) {
        writableFooterData.clearExtensionStatuses = function clearExtensionStatusesAndRender() {
          originalClearStatuses.call(this);
          requestRender(true);
        };
      }

      return {
        dispose() {
          clearInterval(refresh);
          unsubscribeBranch();
          unsubscribeGit();
          if (originalSetStatus) writableFooterData.setExtensionStatus = originalSetStatus;
          if (originalClearStatuses) writableFooterData.clearExtensionStatuses = originalClearStatuses;
          footerDataRef = null;
          requestTuiRender = null;
        },
        invalidate() {
          requestRender();
        },
        render(width: number): string[] {
          if (!currentCtx) return [];
          const activeConfig = configForWidth(config, width);
          const context = buildContext(currentCtx, theme, activeConfig);
          return renderStatusLines(context, getPreset(activeConfig.preset), activeConfig, width);
        },
      };
    });
  };

  const installNotificationWidget = (ctx: ExtensionContext) => {
    ctx.ui.setWidget("powerline-simple-notifications", () => ({
      dispose() {},
      invalidate() {
        requestRender();
      },
      render(width: number): string[] {
        if (!footerDataRef) return [];
        const hiddenKeys = collectHiddenExtensionStatusKeys(configForWidth(config, width).customItems);
        return getNotificationExtensionStatuses(footerDataRef.getExtensionStatuses(), hiddenKeys)
          .map((value) => ` ${value}`)
          .filter((value) => visibleWidth(value) <= width);
      },
    }), { placement: "aboveEditor" });
  };

  const installPowerlineUi = (ctx: ExtensionContext) => {
    installFooter(ctx);
    installNotificationWidget(ctx);
  };

  const clearPowerlineUi = (ctx: ExtensionContext) => {
    ctx.ui.setFooter(undefined);
    ctx.ui.setWidget("powerline-simple-notifications", undefined);
  };

  pi.registerCommand("powerline", {
    description: "Configure the Powerline status bar (toggle or select a preset)",
    handler: async (args, ctx) => {
      currentCtx = ctx;
      const value = args?.trim().toLowerCase();
      if (!value) {
        enabled = !enabled;
        if (enabled) installPowerlineUi(ctx);
        else clearPowerlineUi(ctx);
        ctx.ui.notify(`Powerline ${enabled ? "enabled" : "disabled"}`, "info");
        return;
      }

      if (!Object.prototype.hasOwnProperty.call(PRESETS, value)) {
        ctx.ui.notify(`Usage: /powerline [${PRESET_NAMES.join("|")}]`, "info");
        return;
      }

      config.preset = value as StatusLinePreset;
      resetCaches();
      requestRender(true);
      const persisted = writePowerlinePresetSetting(ctx.cwd, config.preset);
      ctx.ui.notify(`Preset set to: ${config.preset}${persisted ? "" : " (not persisted; check settings.json)"}`, persisted ? "info" : "warning");
    },
  });

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    sessionStartedAt = Date.now();
    isStreaming = false;
    liveAssistantUsage = null;
    selectedThinkingLevel = ctx.thinkingLevel ?? null;
    settings = readSettings(ctx.cwd);
    config = parsePowerlineConfig(settings.powerline, PRESET_NAMES);
    hasCustomCompaction = customCompactionEnabled(ctx.cwd);
    resetCaches();
    warnInvalidConfig(ctx, config);
    if (enabled) installPowerlineUi(ctx);
  });

  pi.on("agent_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    isStreaming = true;
    liveAssistantUsage = null;
    requestRender();
  });

  pi.on("message_update", (event, ctx) => {
    if (ctx.mode !== "tui" || !isAssistantMessage(event.message)) return;
    if (event.message.stopReason === "error" || event.message.stopReason === "aborted") return;
    if (usageTokenTotal(event.message.usage) <= 0) return;
    currentCtx = ctx;
    liveAssistantUsage = event.message.usage;
    requestRender();
  });

  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    contextUsageCache.reset();
    if (isAssistantMessage(event.message)) {
      liveAssistantUsage = event.message.stopReason === "error" || event.message.stopReason === "aborted"
        ? null
        : event.message.usage;
    }
    requestRender(true);
  });

  pi.on("turn_end", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    isStreaming = false;
    contextUsageCache.reset();
    requestRender(true);
  });

  pi.on("model_select", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    contextUsageCache.reset();
    requestRender(true);
  });

  pi.on("thinking_level_select", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    selectedThinkingLevel = typeof event.level === "string" ? event.level : ctx.thinkingLevel ?? null;
    requestRender(true);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    selectedThinkingLevel = null;
    liveAssistantUsage = null;
    resetCaches();
    requestRender(true);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentCtx = ctx;
    liveAssistantUsage = null;
    resetCaches();
    requestRender(true);
  });

  pi.on("tool_result", (event) => {
    if (event.toolName === "write" || event.toolName === "edit") {
      invalidateGitStatus();
      requestRender();
    }
    if (event.toolName === "bash" && isRecord(event.input) && typeof event.input.command === "string" && mightChangeGitBranch(event.input.command)) {
      invalidateGitStatus();
      invalidateGitBranch();
      requestRender(true);
    }
  });

  pi.on("user_bash", (event) => {
    if (!mightChangeGitBranch(event.command)) return;
    invalidateGitStatus();
    invalidateGitBranch();
    setTimeout(() => requestRender(), 100);
    setTimeout(() => requestRender(), 300);
    setTimeout(() => requestRender(), 500);
  });

  pi.on("session_shutdown", () => {
    scheduler.cancel();
    currentCtx = null;
    footerDataRef = null;
    requestTuiRender = null;
    liveAssistantUsage = null;
    resetCaches();
  });
}

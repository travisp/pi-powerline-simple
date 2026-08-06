import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readSettings } from "./settings.ts";
import { getIcons } from "./upstream/icons.ts";
import { mergeSegmentOptions, parsePowerlineConfig } from "./upstream/powerline-config.ts";
import { PRESETS, getPreset } from "./upstream/presets.ts";
import type { StatusLinePreset } from "./upstream/types.ts";

const PRESET_NAMES = Object.keys(PRESETS) as StatusLinePreset[];

export const CACHE_HIT_STATUS_KEY = "powerline-cache-hit";
export const LAST_RESPONSE_STATUS_KEY = "powerline-last-response";

interface UsageLike {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}

interface EntryLike {
  type: string;
  timestamp: string;
  message?: {
    role: string;
    stopReason?: string;
    usage?: UsageLike;
  };
  usage?: UsageLike;
}

export interface ExtraStatusState {
  hasCacheUsage: boolean;
  latestCacheHitRate?: number;
  lastResponseEndedAt?: number;
}

interface ExtraStatusConfig {
  cacheHit: boolean;
  lastResponse: boolean;
  timeFormat: "12h" | "24h";
}

function cacheHitRate(usage: UsageLike): number | undefined {
  const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
  return promptTokens > 0 ? (usage.cacheRead / promptTokens) * 100 : undefined;
}

export function computeExtraStatusState(entries: readonly EntryLike[]): ExtraStatusState {
  const state: ExtraStatusState = { hasCacheUsage: false };

  for (const entry of entries) {
    const usage = entry.type === "message" ? entry.message?.usage : entry.usage;
    if (usage && (usage.cacheRead > 0 || usage.cacheWrite > 0)) state.hasCacheUsage = true;

    if (entry.type !== "message" || entry.message?.role !== "assistant") continue;
    if (entry.message.stopReason === "error" || entry.message.stopReason === "aborted") continue;
    if (entry.message.usage) state.latestCacheHitRate = cacheHitRate(entry.message.usage);
    state.lastResponseEndedAt = Date.parse(entry.timestamp);
  }

  return state;
}

function formatClock(timestamp: number, format: "12h" | "24h"): string {
  const date = new Date(timestamp);
  let hours = date.getHours();
  let suffix = "";
  if (format === "12h") {
    suffix = hours >= 12 ? "pm" : "am";
    hours = hours % 12 || 12;
  }
  return `${hours}:${date.getMinutes().toString().padStart(2, "0")}${suffix}`;
}

function formatRelativeAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d${hours % 24}h`;
}

export function formatLastResponse(
  timestamp: number,
  now = Date.now(),
  format: "12h" | "24h" = "24h",
): string {
  return `${formatClock(timestamp, format)} · ${formatRelativeAge(now - timestamp)} ago`;
}

function resolveExtraConfig(cwd: string): ExtraStatusConfig {
  const config = parsePowerlineConfig(readSettings(cwd).powerline, PRESET_NAMES);
  const options = mergeSegmentOptions(getPreset(config.preset).segmentOptions, config.segmentOptions);
  const statusKeys = new Set(config.customItems.map((item) => item.statusKey));
  return {
    cacheHit: statusKeys.has(CACHE_HIT_STATUS_KEY),
    lastResponse: statusKeys.has(LAST_RESPONSE_STATUS_KEY),
    timeFormat: options.time?.format ?? "24h",
  };
}

function publish(ctx: ExtensionContext, state: ExtraStatusState, config: ExtraStatusConfig): void {
  const cacheHit = config.cacheHit && state.hasCacheUsage && state.latestCacheHitRate !== undefined
    ? `CH${state.latestCacheHitRate.toFixed(1)}%`
    : undefined;
  const lastResponse = !config.lastResponse || state.lastResponseEndedAt === undefined
    ? undefined
    : [getIcons().time, formatLastResponse(state.lastResponseEndedAt, Date.now(), config.timeFormat)].filter(Boolean).join(" ");

  ctx.ui.setStatus(CACHE_HIT_STATUS_KEY, cacheHit);
  ctx.ui.setStatus(LAST_RESPONSE_STATUS_KEY, lastResponse);
}

export default function powerlineExtras(pi: ExtensionAPI): void {
  let state: ExtraStatusState = { hasCacheUsage: false };
  let currentContext: ExtensionContext | undefined;
  let extraConfig: ExtraStatusConfig = { cacheHit: false, lastResponse: false, timeFormat: "24h" };
  let ageRefresh: ReturnType<typeof setInterval> | undefined;

  const restore = (ctx: ExtensionContext) => {
    currentContext = ctx;
    extraConfig = resolveExtraConfig(ctx.cwd);
    state = computeExtraStatusState(ctx.sessionManager.getBranch());
    publish(ctx, state, extraConfig);
  };

  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    restore(ctx);
    ageRefresh = setInterval(() => {
      if (currentContext) publish(currentContext, state, extraConfig);
    }, 60_000);
    ageRefresh.unref?.();
  });

  pi.on("message_end", (event, ctx) => {
    if (ctx.mode !== "tui") return;
    currentContext = ctx;
    const message = event.message;
    const usage = "usage" in message ? message.usage : undefined;
    if (usage && (usage.cacheRead > 0 || usage.cacheWrite > 0)) state.hasCacheUsage = true;

    if (message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted") {
      state.latestCacheHitRate = cacheHitRate(message.usage);
      state.lastResponseEndedAt = Date.now();
    }
    publish(ctx, state, extraConfig);
  });

  pi.on("session_tree", (_event, ctx) => {
    if (ctx.mode === "tui") restore(ctx);
  });

  pi.on("session_compact", (_event, ctx) => {
    if (ctx.mode === "tui") restore(ctx);
  });

  pi.on("session_shutdown", () => {
    if (ageRefresh) clearInterval(ageRefresh);
    ageRefresh = undefined;
    currentContext = undefined;
  });
}

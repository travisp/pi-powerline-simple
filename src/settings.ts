import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { nextPowerlineSettingWithPreset } from "./upstream/powerline-config.ts";
import { getAgentPath } from "./upstream/paths.ts";
import type { StatusLinePreset } from "./upstream/types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectSettingsPath(cwd: string): string {
  return join(cwd, ".pi", "settings.json");
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : {};
  } catch (error) {
    console.debug(`[pi-powerline-simple] Failed to read ${path}:`, error);
    return {};
  }
}

function readWritableSettingsFile(path: string): Record<string, unknown> | null {
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return isRecord(value) ? value : null;
  } catch (error) {
    console.debug(`[pi-powerline-simple] Refusing to overwrite unreadable settings at ${path}:`, error);
    return null;
  }
}

function mergeSettings(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    merged[key] = isRecord(merged[key]) && isRecord(value)
      ? mergeSettings(merged[key] as Record<string, unknown>, value)
      : value;
  }
  return merged;
}

export function readSettings(cwd: string): Record<string, unknown> {
  return mergeSettings(readSettingsFile(getAgentPath("settings.json")), readSettingsFile(projectSettingsPath(cwd)));
}

export function writePowerlinePresetSetting(cwd: string, preset: StatusLinePreset): boolean {
  const globalPath = getAgentPath("settings.json");
  const projectPath = projectSettingsPath(cwd);
  const globalSettings = readWritableSettingsFile(globalPath);
  const projectSettings = readWritableSettingsFile(projectPath);
  if (!globalSettings || !projectSettings) return false;

  const useProject = Object.prototype.hasOwnProperty.call(projectSettings, "powerline");
  const path = useProject ? projectPath : globalPath;
  const settings = useProject ? projectSettings : globalSettings;
  settings.powerline = nextPowerlineSettingWithPreset(settings.powerline, preset);

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
    return true;
  } catch (error) {
    console.debug(`[pi-powerline-simple] Failed to persist preset to ${path}:`, error);
    return false;
  }
}

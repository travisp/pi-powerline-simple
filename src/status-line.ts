import { visibleWidth } from "@earendil-works/pi-tui";
import { customizeModelName, customizeSegment } from "./segment-overrides.ts";
import { ansi, getFgAnsiCode } from "./upstream/colors.ts";
import { mergeSegmentsWithCustomItems, type PowerlineConfig } from "./upstream/powerline-config.ts";
import { getSeparator } from "./upstream/separators.ts";
import { renderSegment } from "./upstream/segments.ts";
import type { PresetDef, SegmentContext, StatusLineSegmentId, StatusLineSeparatorStyle } from "./upstream/types.ts";

interface RenderedPart {
  content: string;
  width: number;
}

function renderPart(id: StatusLineSegmentId, context: SegmentContext): RenderedPart | null {
  // Shorten the model before upstream adds icons, colors, and thinking text.
  if (id === "model" && context.model) {
    context = {
      ...context,
      model: {
        ...context.model,
        id: customizeModelName(context.model.id),
        name: context.model.name === undefined ? undefined : customizeModelName(context.model.name),
      },
    };
  }
  const rendered = renderSegment(id, context);
  if (!rendered.visible || !rendered.content) return null;
  const content = customizeSegment(id, rendered.content);
  return { content, width: visibleWidth(content) };
}

function buildContent(parts: readonly RenderedPart[], separatorStyle: StatusLineSeparatorStyle): string {
  if (parts.length === 0) return "";
  const separator = getSeparator(separatorStyle).left;
  const styledSeparator = `${getFgAnsiCode("sep")}${separator}${ansi.reset}`;
  return ` ${parts.map((part) => part.content).join(` ${styledSeparator} `)}${ansi.reset} `;
}

/**
 * Upstream's adaptive layout rendered in Pi's native footer: one line when all
 * segments fit, otherwise a primary line and one overflow line below it.
 */
export function renderStatusLines(
  context: SegmentContext,
  preset: PresetDef,
  config: PowerlineConfig,
  availableWidth: number,
): string[] {
  const layout = mergeSegmentsWithCustomItems(preset, config.customItems, {
    layout: config.layout,
    disabledSegments: config.disabledSegments,
  });
  const ids = [...layout.leftSegments, ...layout.rightSegments, ...layout.secondarySegments];
  const parts = ids.flatMap((id) => {
    const part = renderPart(id, context);
    return part ? [part] : [];
  });
  if (parts.length === 0) return [];

  const separatorStyle = config.separator ?? preset.separator;
  const separatorWidth = visibleWidth(getSeparator(separatorStyle).left) + 2;
  const primary: RenderedPart[] = [];
  const overflow: RenderedPart[] = [];
  let primaryWidth = 2;
  let didOverflow = false;

  for (const part of parts) {
    const needed = part.width + (primary.length > 0 ? separatorWidth : 0);
    if (!didOverflow && primaryWidth + needed <= availableWidth) {
      primary.push(part);
      primaryWidth += needed;
    } else {
      didOverflow = true;
      overflow.push(part);
    }
  }

  const secondary: RenderedPart[] = [];
  let secondaryWidth = 2;
  for (const part of overflow) {
    const needed = part.width + (secondary.length > 0 ? separatorWidth : 0);
    if (secondaryWidth + needed > availableWidth) break;
    secondary.push(part);
    secondaryWidth += needed;
  }

  return [buildContent(primary, separatorStyle), buildContent(secondary, separatorStyle)].filter(Boolean);
}

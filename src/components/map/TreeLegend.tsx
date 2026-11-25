"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useControl } from "react-map-gl/maplibre";
import type { LatLng } from "@/lib/types";
import {
  TREE_LEGEND_LABELS,
  TREE_LEGEND_RANGES,
  TREE_LEGEND_TITLE,
  treeSurveyWords,
  type TreeLook,
} from "./trees";
import { useTreeSurvey } from "./useTreeSurvey";

interface TreeLegendProps {
  /** How the trees are coloured right now (the legend shows the same colours). */
  look: TreeLook;
  /** The pinned place, if any: the survey's year is looked up for it. */
  place: LatLng | null;
  /**
   * The corner of the map it sits in (fixed for the life of the component:
   * give it a new `key` to move it). Phones: top left, under the search pill
   * — the one corner with nothing in it, clear of the pin in the middle, and
   * in view with the sheet half up. Desktop: bottom left, above the time bar
   * (the top corners hold the building notice and the credits).
   */
  corner: "top-left" | "bottom-left";
}

/**
 * What the colours of the Trees layer mean, and how old the heights are.
 * Rendered only while the trees are drawn; a child of the map, where it
 * becomes one of the map's corner boxes (see `.tree-legend` in globals.css).
 */
export function TreeLegend({ look, place, corner }: TreeLegendProps) {
  const survey = useTreeSurvey(place);
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "maplibregl-ctrl tree-legend";
    return element;
  });
  useControl(() => ({ onAdd: () => container, onRemove: () => container.remove() }), {
    position: corner,
  });

  const token = look === "photo" ? "--tree-photo-" : "--tree-";
  const [when, name] = treeSurveyWords(survey);
  return createPortal(
    <div role="group" aria-label={`${TREE_LEGEND_TITLE} legend`}>
      <p className="font-semibold">
        {TREE_LEGEND_TITLE} <span className="font-normal text-ink-2">in feet</span>
      </p>
      <div className="tree-legend-scale" aria-hidden="true">
        {TREE_LEGEND_LABELS.map((label, i) => (
          <span
            key={`swatch-${label}`}
            className="tree-legend-swatch"
            style={{ background: `var(${token}${i + 1})` }}
          />
        ))}
        {TREE_LEGEND_LABELS.map((label) => (
          <span key={`tick-${label}`} className="tree-legend-tick">
            {label}
          </span>
        ))}
      </div>
      <ul className="sr-only">
        {TREE_LEGEND_RANGES.map((range) => (
          <li key={range}>{range}</li>
        ))}
      </ul>
      {/* The survey's name stays in one piece: it goes to a line of its own rather than break. */}
      <p className="mt-0.5 text-ink-2">
        {when}
        {name && (
          <>
            {" "}
            <span className="inline-block">{name}</span>
          </>
        )}
      </p>
    </div>,
    container,
  );
}

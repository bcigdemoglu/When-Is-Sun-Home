"use client";

import type { SearchExperienceProps } from "./types";

/** Placeholder — replaced by the full search experience. */
export function SearchExperience({ place, className = "" }: SearchExperienceProps) {
  return (
    <div className={className}>
      <input
        type="search"
        aria-label="Search an address"
        placeholder="Search an address"
        defaultValue={place?.name ?? ""}
        className="h-12 w-full rounded-full border border-line bg-surface px-4"
      />
    </div>
  );
}

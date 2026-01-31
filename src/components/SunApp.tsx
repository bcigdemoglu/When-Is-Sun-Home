"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { Location, AnimationMode, SunVisibility } from "@/types/sun";
import { deriveSunVisibility } from "@/types/sun";
import { useSunCalculations } from "@/hooks/useSunCalculations";
import { useAnimationTimer } from "@/hooks/useAnimationTimer";
import { useBuildingData } from "@/hooks/useBuildingData";
import { useSunBlockage } from "@/hooks/useSunBlockage";
import {
  loadAppState,
  updateAppState,
  dateToTimeMinutes,
  dateToDayOfYear,
  applyTimeAndDay,
} from "@/lib/appState";
import AddressSearch from "./AddressSearch";
import SunCompass from "./SunCompass";
import TimeControls from "./TimeControls";
import SunDataPanel from "./SunDataPanel";
import BuildingControls from "./BuildingControls";

const Map = dynamic(() => import("./Map"), { ssr: false });

export default function SunApp() {
  // ── State (defaults for SSR — real values loaded in useEffect) ──────
  const [location, setLocation] = useState<Location | null>(null);
  const [dateTime, setDateTime] = useState<Date>(() => new Date(0));
  const [zoom, setZoom] = useState(13);
  const [isPlaying, setIsPlaying] = useState(false);
  const [animationMode, setAnimationMode] = useState<AnimationMode>("time");
  const [speed, setSpeed] = useState(1);
  const [buildingsEnabled, setBuildingsEnabled] = useState(false);
  const [userFloor, setUserFloor] = useState(1);
  const hydrated = useRef(false);

  // ── Load persisted state after hydration ────────────────────────────
  useEffect(() => {
    const s = loadAppState();
    if (s.location) setLocation(s.location);
    setZoom(s.zoom);
    setBuildingsEnabled(s.buildingsEnabled);
    setUserFloor(s.userFloor);

    // Restore time/date or fall back to "now"
    const now = new Date();
    const timeMin = s.timeMinutes ?? dateToTimeMinutes(now);
    const day = s.dayOfYear ?? dateToDayOfYear(now);
    setDateTime(applyTimeAndDay(timeMin, day));

    hydrated.current = true;
  }, []);

  // ── Derived data ────────────────────────────────────────────────────
  const sunData = useSunCalculations(location, dateTime);
  const { buildingData, pinBuilding, isLoading: buildingsLoading } =
    useBuildingData(location, buildingsEnabled);
  const userElevation = (userFloor - 1) * 3;
  const sunBlockage = useSunBlockage(
    location, sunData, buildingData, buildingsEnabled, userElevation
  );
  const sunVisibility: SunVisibility = deriveSunVisibility(sunData, sunBlockage);

  // ── Persisted setters (update React state + localStorage) ───────────
  const handleLocationChange = useCallback((loc: Location) => {
    setLocation(loc);
    updateAppState("location", loc);
  }, []);

  const handleZoomChange = useCallback((z: number) => {
    setZoom(z);
    updateAppState("zoom", z);
  }, []);

  const handleDateTimeChange = useCallback((dt: Date) => {
    setDateTime(dt);
    if (hydrated.current) {
      updateAppState("timeMinutes", dateToTimeMinutes(dt));
      updateAppState("dayOfYear", dateToDayOfYear(dt));
    }
  }, []);

  const handleBuildingsToggle = useCallback((enabled: boolean) => {
    setBuildingsEnabled(enabled);
    updateAppState("buildingsEnabled", enabled);
  }, []);

  const handleFloorChange = useCallback((floor: number) => {
    setUserFloor(floor);
    updateAppState("userFloor", floor);
  }, []);

  // ── Animation ───────────────────────────────────────────────────────
  const handleTick = useCallback(() => {
    setDateTime((prev) => {
      const next = new Date(prev);
      if (animationMode === "time") {
        next.setMinutes(next.getMinutes() + 5);
      } else {
        next.setDate(next.getDate() + 1);
        if (next.getFullYear() !== prev.getFullYear()) {
          next.setFullYear(prev.getFullYear(), 0, 1);
        }
      }
      // Persist periodically during animation (not every tick — throttle)
      return next;
    });
  }, [animationMode]);

  // Persist time when animation stops
  useEffect(() => {
    if (!isPlaying && hydrated.current) {
      updateAppState("timeMinutes", dateToTimeMinutes(dateTime));
      updateAppState("dayOfYear", dateToDayOfYear(dateTime));
    }
  }, [isPlaying, dateTime]);

  useAnimationTimer({ isPlaying, speed, onTick: handleTick });

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col lg:flex-row">
      {/* Map area */}
      <div className="relative flex-1 lg:flex-[65]">
        <div className="absolute left-3 right-3 top-3 z-10">
          <AddressSearch onSelect={handleLocationChange} />
        </div>
        <Map
          location={location}
          sunData={sunData}
          onLocationChange={handleLocationChange}
          buildingsEnabled={buildingsEnabled}
          buildingData={buildingData}
          sunVisibility={sunVisibility}
          zoom={zoom}
          onZoomChange={handleZoomChange}
        />
        {/* Compass overlay */}
        <div className="absolute bottom-4 left-4 z-10">
          <SunCompass sunData={sunData} sunVisibility={sunVisibility} />
        </div>
        {/* Zoom slider overlay */}
        <div className="absolute right-3 top-1/2 z-10 -translate-y-1/2">
          <div className="flex flex-col items-center gap-1 rounded-lg bg-white/90 px-1.5 py-2 shadow-md backdrop-blur dark:bg-zinc-800/90">
            <span className="text-[10px] font-medium text-zinc-500 dark:text-zinc-400">
              {zoom.toFixed(1)}
            </span>
            <input
              type="range"
              min={1}
              max={20}
              step={0.1}
              value={zoom}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className="sun-slider h-32"
              style={{
                writingMode: "vertical-lr" as const,
                direction: "rtl" as const,
                width: "6px",
              }}
            />
          </div>
        </div>
      </div>

      {/* Sidebar / bottom panel */}
      <div className="flex flex-col gap-3 overflow-y-auto bg-zinc-50 p-3 lg:flex-[35] lg:max-w-md dark:bg-zinc-900">
        {location && (
          <div className="rounded-xl bg-white/90 px-4 py-2.5 text-xs text-zinc-500 shadow-md backdrop-blur dark:bg-zinc-800/90 dark:text-zinc-400">
            <span className="font-medium text-zinc-700 dark:text-zinc-300">
              {location.name ?? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}
            </span>
          </div>
        )}
        <TimeControls
          dateTime={dateTime}
          onDateTimeChange={handleDateTimeChange}
          isPlaying={isPlaying}
          onPlayPause={() => setIsPlaying((p) => !p)}
          animationMode={animationMode}
          onAnimationModeChange={setAnimationMode}
          speed={speed}
          onSpeedChange={setSpeed}
        />
        <BuildingControls
          enabled={buildingsEnabled}
          onToggle={handleBuildingsToggle}
          userFloor={userFloor}
          onFloorChange={handleFloorChange}
          pinBuilding={pinBuilding}
          isLoading={buildingsLoading}
        />
        <SunDataPanel
          sunData={sunData}
          sunVisibility={sunVisibility}
          sunBlockage={sunBlockage}
        />
      </div>
    </div>
  );
}

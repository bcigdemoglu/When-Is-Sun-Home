"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import type { Location, AnimationMode, SunVisibility } from "@/types/sun";
import { deriveSunVisibility } from "@/types/sun";
import { useSunCalculations } from "@/hooks/useSunCalculations";
import { useAnimationTimer } from "@/hooks/useAnimationTimer";
import { useBuildingData } from "@/hooks/useBuildingData";
import { useSunBlockage } from "@/hooks/useSunBlockage";
import { useDayBlockage } from "@/hooks/useDayBlockage";
import {
  loadAppState,
  updateAppState,
  resetAppState,
  clearBuildingCache,
  dateToTimeMinutes,
  dateToDayOfYear,
  applyTimeAndDay,
} from "@/lib/appState";
import AddressSearch from "./AddressSearch";
import SunCompass from "./SunCompass";
import TimeControls from "./TimeControls";
import SunDataPanel from "./SunDataPanel";
import BuildingControls from "./BuildingControls";
import SunWindowsPanel from "./SunWindowsPanel";

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
  const [blockageEnabled, setBlockageEnabled] = useState(false);
  const [shadowsEnabled, setShadowsEnabled] = useState(false);
  const [userFloor, setUserFloor] = useState(1);
  const [pinDirection, setPinDirection] = useState(180);
  const [pinFov, setPinFov] = useState(180);
  const hydrated = useRef(false);

  // ── Load persisted state after hydration ────────────────────────────
  useEffect(() => {
    const s = loadAppState();
    if (s.location) setLocation(s.location);
    setZoom(s.zoom);
    setBuildingsEnabled(s.buildingsEnabled);
    setBlockageEnabled(s.blockageEnabled);
    setShadowsEnabled(s.shadowsEnabled);
    setUserFloor(s.userFloor);
    setPinDirection(s.pinDirection);
    setPinFov(s.pinFov);

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
    location, sunData, buildingData, blockageEnabled && buildingsEnabled, userElevation, pinDirection, pinFov
  );
  const sunVisibility: SunVisibility = deriveSunVisibility(sunData, sunBlockage);
  const { dayBlockageMap, sunWindows } = useDayBlockage(
    location, sunData, buildingData, blockageEnabled && buildingsEnabled, userElevation, pinDirection, pinFov
  );

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

  const handleBlockageToggle = useCallback((enabled: boolean) => {
    setBlockageEnabled(enabled);
    updateAppState("blockageEnabled", enabled);
  }, []);

  const handleShadowsToggle = useCallback((enabled: boolean) => {
    setShadowsEnabled(enabled);
    updateAppState("shadowsEnabled", enabled);
  }, []);

  const handleFloorChange = useCallback((floor: number) => {
    setUserFloor(floor);
    updateAppState("userFloor", floor);
  }, []);

  const handleDirectionChange = useCallback((direction: number) => {
    setPinDirection(direction);
    updateAppState("pinDirection", direction);
  }, []);

  const handleFovChange = useCallback((fov: number) => {
    setPinFov(fov);
    updateAppState("pinFov", fov);
  }, []);

  const handleReset = useCallback(() => {
    const s = resetAppState(location);
    clearBuildingCache();
    setZoom(s.zoom);
    const now = new Date();
    setDateTime(applyTimeAndDay(dateToTimeMinutes(now), dateToDayOfYear(now)));
    setIsPlaying(false);
    setAnimationMode("time");
    setSpeed(1);
    setBuildingsEnabled(s.buildingsEnabled);
    setBlockageEnabled(s.blockageEnabled);
    setShadowsEnabled(s.shadowsEnabled);
    setUserFloor(s.userFloor);
    setPinDirection(s.pinDirection);
    setPinFov(s.pinFov);
  }, [location]);

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
          <AddressSearch onSelect={handleLocationChange} initialValue={location?.name} />
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
          dayBlockageMap={dayBlockageMap}
          shadowsEnabled={shadowsEnabled && buildingsEnabled}
          pinDirection={pinDirection}
        />
        {/* Compass overlay */}
        <div className="absolute bottom-4 left-4 z-10">
          <SunCompass sunData={sunData} sunVisibility={sunVisibility} />
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
        <button
          onClick={handleReset}
          className="w-full rounded-xl bg-red-500/90 px-4 py-2.5 text-xs font-medium text-white shadow-md backdrop-blur transition-colors hover:bg-red-600 dark:bg-red-600/90 dark:hover:bg-red-700"
        >
          Reset all settings and cache
        </button>
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
          blockageEnabled={blockageEnabled}
          onBlockageToggle={handleBlockageToggle}
          shadowsEnabled={shadowsEnabled}
          onShadowsToggle={handleShadowsToggle}
          pinDirection={pinDirection}
          onDirectionChange={handleDirectionChange}
          pinFov={pinFov}
          onFovChange={handleFovChange}
        />
        <SunWindowsPanel
          sunWindows={sunWindows}
          blockageEnabled={blockageEnabled && buildingsEnabled}
        />
        <div className="flex flex-col gap-2 rounded-xl bg-white/90 p-4 shadow-md backdrop-blur dark:bg-zinc-800/90">
          <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
            <h3 className="font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
              Zoom
            </h3>
            <span className="font-mono font-medium text-zinc-800 dark:text-zinc-200">
              {zoom.toFixed(1)}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            step={0.1}
            value={zoom}
            onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
            className="sun-slider w-full"
          />
        </div>
        <SunDataPanel
          sunData={sunData}
          sunVisibility={sunVisibility}
          sunBlockage={sunBlockage}
        />
      </div>
    </div>
  );
}

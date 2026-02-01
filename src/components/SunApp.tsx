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
  const [buildingsEnabled, setBuildingsEnabled] = useState(true);
  const [blockageEnabled, setBlockageEnabled] = useState(true);
  const [shadowsEnabled, setShadowsEnabled] = useState(false);
  const [userFloor, setUserFloor] = useState(1);
  const [pinDirection, setPinDirection] = useState(180);
  const [pinFov, setPinFov] = useState(180);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  // ── Sidebar content (shared between mobile overlay & desktop panel) ─
  const sidebarContent = (
    <>
      {location && (
        <div className="rounded-xl bg-white/90 px-4 py-2.5 text-xs text-zinc-500 shadow-md backdrop-blur dark:bg-zinc-800/90 dark:text-zinc-400">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {location.name ?? `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`}
          </span>
        </div>
      )}
      <SunWindowsPanel
        sunWindows={sunWindows}
        blockageEnabled={blockageEnabled && buildingsEnabled}
      />
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
    </>
  );

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="flex h-screen flex-col lg:flex-row">
      {/* Map area — full screen on mobile, 65% on desktop */}
      <div className="relative h-full flex-1 lg:flex-[65]">
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
        {/* Compass overlay — smaller on mobile */}
        <div className="absolute bottom-4 left-4 z-10 origin-bottom-left scale-[0.3] lg:scale-100">
          <SunCompass sunData={sunData} sunVisibility={sunVisibility} />
        </div>
        {/* Compact time controls — mobile only, bottom center */}
        <div className="absolute bottom-3 left-1/2 z-10 w-56 -translate-x-1/2 lg:hidden">
          <TimeControls
            dateTime={dateTime}
            onDateTimeChange={handleDateTimeChange}
            isPlaying={isPlaying}
            onPlayPause={() => setIsPlaying((p) => !p)}
            animationMode={animationMode}
            onAnimationModeChange={setAnimationMode}
            speed={speed}
            onSpeedChange={setSpeed}
            compact
          />
        </div>
        {/* Burger button — mobile only, top-right above everything */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute right-3 top-16 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 shadow-lg backdrop-blur transition-colors hover:bg-zinc-100 lg:hidden dark:bg-zinc-800/90 dark:hover:bg-zinc-700"
          aria-label="Open settings"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-zinc-700 dark:text-zinc-200">
            <line x1="3" y1="5" x2="17" y2="5" />
            <line x1="3" y1="10" x2="17" y2="10" />
            <line x1="3" y1="15" x2="17" y2="15" />
          </svg>
        </button>
      </div>

      {/* Backdrop — mobile only, visible when sidebar is open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar — slide-over on mobile, static panel on desktop */}
      <div
        className={`
          fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col
          bg-black/25 backdrop-blur-[3px]
          transition-transform duration-300 ease-in-out
          dark:bg-black/35
          lg:bg-zinc-50 lg:backdrop-blur-none lg:dark:bg-zinc-900
          ${sidebarOpen ? "translate-x-0" : "translate-x-full"}
          lg:static lg:z-auto lg:w-auto lg:max-w-md lg:flex-[35] lg:translate-x-0 lg:transition-none
        `}
      >
        {/* Close header — mobile only */}
        <div className="flex items-center justify-between border-b border-white/20 px-4 py-3 lg:hidden lg:border-zinc-200 lg:dark:border-zinc-700">
          <h2 className="text-sm font-semibold text-white lg:text-zinc-700 dark:text-zinc-300">Settings</h2>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-white transition-colors hover:bg-white/20 lg:text-zinc-500 lg:hover:bg-zinc-200 dark:text-zinc-400 dark:hover:bg-zinc-700 dark:hover:text-zinc-200"
            aria-label="Close settings"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="3" x2="13" y2="13" />
              <line x1="13" y1="3" x2="3" y2="13" />
            </svg>
          </button>
        </div>
        <div className="sidebar-glass flex flex-col gap-3 overflow-y-auto p-3 max-lg:[&>*]:!bg-transparent max-lg:[&>*]:!shadow-none max-lg:[&>*]:![backdrop-filter:none] max-lg:[&>*]:!border max-lg:[&>*]:!border-zinc-300/50 max-lg:[&>*]:!rounded-xl dark:max-lg:[&>*]:!border-zinc-600/50">
          {sidebarContent}
        </div>
      </div>
    </div>
  );
}

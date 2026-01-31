import { useMemo } from "react";
import SunCalc from "suncalc";
import type { Location, SunData, SunPosition, SunTimes, ArcPoint } from "@/types/sun";

function radToDeg(rad: number): number {
  return rad * (180 / Math.PI);
}

function sunCalcAzimuthToCompass(azimuthRad: number): number {
  // SunCalc returns azimuth in radians, measured from south, clockwise
  // Convert to compass degrees (0=N, 90=E, 180=S, 270=W)
  return (radToDeg(azimuthRad) + 180) % 360;
}

function getSunPosition(lat: number, lng: number, date: Date): SunPosition {
  const pos = SunCalc.getPosition(date, lat, lng);
  return {
    azimuth: sunCalcAzimuthToCompass(pos.azimuth),
    altitude: radToDeg(pos.altitude),
  };
}

function getSunTimes(lat: number, lng: number, date: Date): SunTimes {
  const times = SunCalc.getTimes(date, lat, lng);
  const sunriseMs = times.sunrise.getTime();
  const sunsetMs = times.sunset.getTime();
  const dayLength = (sunsetMs - sunriseMs) / 60000; // minutes

  return {
    sunrise: times.sunrise,
    sunset: times.sunset,
    solarNoon: times.solarNoon,
    nadir: times.nadir,
    goldenHourStart: times.goldenHour,
    goldenHourEnd: times.goldenHourEnd,
    civilDawn: times.dawn,
    civilDusk: times.dusk,
    nauticalDawn: times.nauticalDawn,
    nauticalDusk: times.nauticalDusk,
    astronomicalDawn: times.nightEnd,
    astronomicalDusk: times.night,
    dayLength: Math.max(0, dayLength),
  };
}

function computeArc(lat: number, lng: number, date: Date): ArcPoint[] {
  const points: ArcPoint[] = [];
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);

  // Sample every 10 minutes across 24 hours
  for (let m = 0; m <= 1440; m += 10) {
    const t = new Date(dayStart.getTime() + m * 60000);
    const pos = SunCalc.getPosition(t, lat, lng);
    points.push({
      azimuth: sunCalcAzimuthToCompass(pos.azimuth),
      altitude: radToDeg(pos.altitude),
      time: t,
    });
  }
  return points;
}

export function useSunCalculations(
  location: Location | null,
  dateTime: Date
): SunData | null {
  return useMemo(() => {
    if (!location) return null;
    const { lat, lng } = location;
    return {
      position: getSunPosition(lat, lng, dateTime),
      times: getSunTimes(lat, lng, dateTime),
      arc: computeArc(lat, lng, dateTime),
    };
  }, [location, dateTime]);
}

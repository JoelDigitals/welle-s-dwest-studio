/** Echtes Wetter für Saarland/Rheinland-Pfalz über Open-Meteo (api.open-meteo.com) – komplett
 *  kostenlos, kein API-Key nötig. Ersetzt die bisherige rein rechnerische Simulation
 *  (Jahreszeiten-Durchschnittstabelle + Datum-Modulo), die sich Tag für Tag praktisch identisch
 *  anhörte ("wie festgenagelt"), weil sie nie echte Wetterdaten einbezog. */
import type { WeatherData, DailyWeather } from "@/lib/broadcast-types";

// Saarbrücken – zentral fürs Sendegebiet, repräsentativ für Saarland und angrenzendes RLP.
const LAT = 49.2402;
const LON = 6.9969;

async function fetchWithTimeout(url: string, ms: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeather(): Promise<WeatherData | null> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}` +
      `&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,weather_code` +
      `&timezone=Europe%2FBerlin&forecast_days=3`;
    const res = await fetchWithTimeout(url, 8000);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      elevation?: number;
      current?: {
        temperature_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        wind_direction_10m?: number;
      };
      daily?: {
        time?: string[];
        temperature_2m_max?: number[];
        temperature_2m_min?: number[];
        weather_code?: number[];
      };
    };
    if (data.current?.temperature_2m == null) return null;
    const daily: DailyWeather[] = (data.daily?.time ?? []).map((date, i) => ({
      date,
      max: Math.round(data.daily?.temperature_2m_max?.[i] ?? 0),
      min: Math.round(data.daily?.temperature_2m_min?.[i] ?? 0),
      code: data.daily?.weather_code?.[i] ?? 0,
    }));
    return {
      currentTemp: Math.round(data.current.temperature_2m),
      currentCode: data.current.weather_code ?? 0,
      windSpeedKmh: Math.round(data.current.wind_speed_10m ?? 0),
      windDirectionDeg: data.current.wind_direction_10m ?? 0,
      elevation: data.elevation ?? 200,
      daily,
    };
  } catch {
    return null;
  }
}

/** WMO-Wettercode → radiotaugliche deutsche Beschreibung. Eigene Datei (statt in fetch-weather.ts
 *  oder planner.ts), damit sowohl der Server-Fetch als auch planner.ts (das clientseitig auch von
 *  der alten Simulation genutzt wird, siehe use-radio-engine.ts) sie ohne Server-Import nutzen
 *  können. Quelle der Codes: Open-Meteo / WMO-Wetterinterpretationscodes. */
const WEATHER_CODE_TEXT: Record<number, string> = {
  0: "klarem Himmel",
  1: "meist klarem Himmel, nur wenigen Wolkenfeldern",
  2: "wechselnd bewölktem Himmel mit freundlichen Abschnitten",
  3: "starker Bewölkung bis bedecktem Himmel",
  45: "Nebel",
  48: "Nebel mit Reifbildung",
  51: "leichtem Nieselregen",
  53: "Nieselregen",
  55: "dichtem Nieselregen",
  56: "gefrierendem Nieselregen",
  57: "dichtem, gefrierendem Nieselregen",
  61: "leichtem Regen",
  63: "Regen",
  65: "kräftigem Regen",
  66: "gefrierendem Regen",
  67: "kräftigem, gefrierendem Regen",
  71: "leichtem Schneefall",
  73: "Schneefall",
  75: "starkem Schneefall",
  77: "Schneegriesel",
  80: "einzelnen Regenschauern",
  81: "Regenschauern",
  82: "kräftigen Regenschauern",
  85: "Schneeschauern",
  86: "kräftigen Schneeschauern",
  95: "einem Gewitter",
  96: "einem Gewitter mit Hagel",
  99: "einem kräftigen Gewitter mit Hagel",
};

export function weatherCodeToSky(code: number): string {
  return WEATHER_CODE_TEXT[code] ?? "wechselhaftem Wetter";
}

/** WMO-Wettercode → radiotaugliche deutsche Beschreibung. Eigene Datei (statt in fetch-weather.ts
 *  oder planner.ts), damit sowohl der Server-Fetch als auch planner.ts (das clientseitig auch von
 *  der alten Simulation genutzt wird, siehe use-radio-engine.ts) sie ohne Server-Import nutzen
 *  können. Quelle der Codes: Open-Meteo / WMO-Wetterinterpretationscodes.
 *
 *  Mehrere Formulierungen pro Code statt nur einer (siehe weatherCodeToSky) - bei länger
 *  anhaltender, unveränderter Wetterlage (z. B. mehrere Stunden durchgehend bewölkt) kam sonst in
 *  JEDER Wetter-Durchsage exakt derselbe Satz, was sich für Hörer:innen wie eine Wiederholung
 *  anhörte, obwohl die Werte echt waren (Nutzer-Feedback: "Wetter wiederholt sich des Öfteren"). */
const WEATHER_CODE_TEXT: Record<number, string[]> = {
  0: ["klarem Himmel", "strahlend blauem Himmel", "wolkenlosem Himmel"],
  1: ["meist klarem Himmel, nur wenigen Wolkenfeldern", "überwiegend klarem Himmel mit ein paar Wolken"],
  2: [
    "wechselnd bewölktem Himmel mit freundlichen Abschnitten",
    "einem Mix aus Sonne und Wolken",
    "lockerer Bewölkung mit Sonnenfenstern",
  ],
  3: [
    "starker Bewölkung bis bedecktem Himmel",
    "durchweg dichter Bewölkung",
    "einem grauen, bedeckten Himmel",
  ],
  45: ["Nebel", "zähem Nebel", "eingeschränkter Sicht durch Nebel"],
  48: ["Nebel mit Reifbildung", "gefrierendem Nebel"],
  51: ["leichtem Nieselregen", "vereinzeltem Sprühregen"],
  53: ["Nieselregen", "anhaltendem Sprühregen"],
  55: ["dichtem Nieselregen"],
  56: ["gefrierendem Nieselregen"],
  57: ["dichtem, gefrierendem Nieselregen"],
  61: ["leichtem Regen", "vereinzelten Regentropfen"],
  63: ["Regen", "anhaltendem Regen"],
  65: ["kräftigem Regen", "starkem, andauerndem Regen"],
  66: ["gefrierendem Regen"],
  67: ["kräftigem, gefrierendem Regen"],
  71: ["leichtem Schneefall", "vereinzelten Schneeflocken"],
  73: ["Schneefall", "anhaltendem Schneefall"],
  75: ["starkem Schneefall"],
  77: ["Schneegriesel"],
  80: ["einzelnen Regenschauern", "vereinzelten Schauern"],
  81: ["Regenschauern", "wiederkehrenden Schauern"],
  82: ["kräftigen Regenschauern", "heftigen Schauern"],
  85: ["Schneeschauern"],
  86: ["kräftigen Schneeschauern"],
  95: ["einem Gewitter", "Gewitterneigung"],
  96: ["einem Gewitter mit Hagel"],
  99: ["einem kräftigen Gewitter mit Hagel"],
};

export function weatherCodeToSky(code: number, seed = 0): string {
  const variants = WEATHER_CODE_TEXT[code] ?? ["wechselhaftem Wetter"];
  return variants[Math.abs(seed) % variants.length];
}

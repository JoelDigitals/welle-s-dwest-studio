/**
 * Anschlussstellen (AS), Kreuze und Dreiecke der wichtigsten Autobahnen
 * im Saarland und in Rheinland-Pfalz – in geografischer Reihenfolge.
 * Damit lässt sich aus einer Meldung immer ein exakter Abschnitt
 * „zwischen AS X und AS Y" bilden.
 */
export const AUTOBAHN_EXITS: Record<string, string[]> = {
  A1: [
    "Kreuz Wittlich", "Salmtal", "Hasborn", "Laufeld", "Wittlich-Mitte", "Mehring",
    "Schweich", "Trier-Ehrang", "Kreuz Trier", "Reinsfeld", "Hermeskeil", "Nonnweiler",
    "Nonnweiler-Otzenhausen", "Nonnweiler-Braunshausen", "Tholey", "Eppelborn",
    "Illingen", "Kreuz Neunkirchen", "Neunkirchen-Kohlhof", "Kreuz Saarbrücken",
  ],
  A6: [
    "Kreuz Saarbrücken", "Saarbrücken-Fechingen", "Saarbrücken-Brebach", "St. Ingbert-West",
    "St. Ingbert-Mitte", "Rohrbach", "Homburg", "Bruchmühlbach-Miesau", "Landstuhl-West",
    "Landstuhl-Ost", "Kreuz Landstuhl", "Ramstein-Miesenbach", "Kaiserslautern-Einsiedlerhof",
    "Kaiserslautern-West", "Kreuz Kaiserslautern", "Kaiserslautern-Ost", "Enkenbach-Alsenborn",
    "Sembach", "Wattenheim", "Grünstadt", "Kreuz Frankenthal", "Frankenthal", "Kreuz Mannheim",
  ],
  A8: [
    "Perl-Borg", "Merzig-Schwemlingen", "Merzig", "Merzig-Wellingen", "Beckingen",
    "Dreieck Saarlouis", "Schwalbach-Hülzweiler", "Heusweiler", "Kreuz Neunkirchen",
    "Neunkirchen-Wellesweiler", "Homburg-Einöd", "Zweibrücken-Mitte", "Zweibrücken-Ixheim",
    "Pirmasens-Winzeln",
  ],
  A62: [
    "Nonnweiler", "Freisen", "Kusel", "Glan-Münchweiler", "Bruchmühlbach-Miesau",
    "Landstuhl-West", "Kreuz Landstuhl", "Trippstadt", "Pirmasens-Nord", "Thaleischweiler-Fröschen",
    "Pirmasens-Zweibrücken",
  ],
  A620: [
    "Saarlouis-Mitte", "Saarlouis-Ost", "Bous", "Völklingen-Wehrden", "Völklingen-Stadtmitte",
    "Püttlingen", "Saarbrücken-Klarenthal", "Saarbrücken-Ludwigsberg", "Saarbrücken-Malstatt",
    "Saarbrücken-Wilhelm-Heinrich-Brücke", "Saarbrücken-Ost", "Kreuz Saarbrücken",
  ],
  A61: [
    "Kreuz Meckenheim", "Bad Neuenahr-Ahrweiler", "Sinzig", "Kreuz Koblenz", "Boppard",
    "Emmelshausen", "Laudert", "Rheinböllen", "Dreieck Nahetal", "Bad Kreuznach",
    "Gau-Bickelheim", "Kreuz Alzey", "Worms", "Frankenthal", "Kreuz Frankenthal",
    "Ludwigshafen", "Speyer", "Hockenheim",
  ],
  A63: [
    "Kreuz Mainz-Süd", "Mainz-Finthen", "Nieder-Olm", "Saulheim", "Wörrstadt",
    "Biebelnheim", "Alzey", "Kreuz Alzey", "Kirchheimbolanden", "Winnweiler",
    "Sembach", "Kreuz Kaiserslautern",
  ],
  A65: [
    "Kreuz Ludwigshafen", "Mutterstadt", "Schifferstadt", "Haßloch", "Neustadt-Nord",
    "Neustadt-Süd", "Edenkoben", "Landau-Nord", "Landau-Zentrum", "Landau-Süd",
    "Insheim", "Rohrbach", "Kandel-Nord",
  ],
  A48: [
    "Dreieck Vulkaneifel", "Ulmen", "Kaisersesch", "Kaifenheim", "Polch", "Ochtendung",
    "Koblenz-Metternich", "Kreuz Koblenz",
  ],
  A60: [
    "Prüm", "Bitburg", "Dreieck Vulkaneifel", "Wittlich", "Rheinböllen",
    "Mainz-Finthen", "Mainz-Gonsenheim", "Kreuz Mainz-Süd", "Rüsselsheim",
  ],
  A3: [
    "Bad Honnef/Linz", "Neuwied", "Dierdorf", "Dreieck Dernbach", "Montabaur", "Diez", "Limburg-Nord", "Bad Camberg", "Idstein", "Niedernhausen",
    "Wiesbaden", "Kreuz Wiesbaden",
  ],
  A64: ["Trier-Ehrang", "Trier-Zewen", "Igel", "Wasserbillig"],
  A602: ["Kreuz Trier", "Trier-Ehrang", "Trier-Nord", "Trier-Verteilerkreis"],
  A623: [
    "Dreieck Friedrichsthal", "Sulzbach/Altenwald", "Sulzbach", "Saarbrücken-Dudweiler",
    "Saarbrücken-Herrensohr", "Saarbrücken-Rodenhof", "Saarbrücken-Ludwigsberg",
  ],
};

const AUTOBAHN_REGION_EXITS: Record<string, Record<string, string[]>> = {
  Saarland: {
    A1: ["Nonnweiler", "Nonnweiler-Otzenhausen", "Nonnweiler-Braunshausen", "Tholey", "Eppelborn", "Illingen", "Kreuz Neunkirchen", "Neunkirchen-Kohlhof", "Kreuz Saarbrücken"],
    A6: ["Kreuz Saarbrücken", "Saarbrücken-Fechingen", "Saarbrücken-Brebach", "St. Ingbert-West", "St. Ingbert-Mitte", "Rohrbach", "Homburg"],
    A8: ["Perl-Borg", "Merzig-Schwemlingen", "Merzig", "Merzig-Wellingen", "Beckingen", "Dreieck Saarlouis", "Schwalbach-Hülzweiler", "Heusweiler", "Kreuz Neunkirchen", "Neunkirchen-Wellesweiler", "Homburg-Einöd"],
    A62: ["Nonnweiler", "Freisen"],
    A620: ["Saarlouis-Mitte", "Saarlouis-Ost", "Bous", "Völklingen-Wehrden", "Völklingen-Stadtmitte", "Püttlingen", "Saarbrücken-Klarenthal", "Saarbrücken-Ludwigsberg", "Saarbrücken-Malstatt", "Saarbrücken-Wilhelm-Heinrich-Brücke", "Saarbrücken-Ost", "Kreuz Saarbrücken"],
    A623: ["Dreieck Friedrichsthal", "Sulzbach/Altenwald", "Sulzbach", "Saarbrücken-Dudweiler", "Saarbrücken-Herrensohr", "Saarbrücken-Rodenhof", "Saarbrücken-Ludwigsberg"],
  },
  "Rheinland-Pfalz": {
    A1: ["Kreuz Wittlich", "Salmtal", "Hasborn", "Laufeld", "Wittlich-Mitte", "Mehring", "Schweich", "Trier-Ehrang", "Kreuz Trier", "Reinsfeld", "Hermeskeil"],
    A3: ["Bad Honnef/Linz", "Neuwied", "Dierdorf", "Dreieck Dernbach", "Montabaur", "Diez"],
    A6: ["Bruchmühlbach-Miesau", "Landstuhl-West", "Landstuhl-Ost", "Kreuz Landstuhl", "Ramstein-Miesenbach", "Kaiserslautern-Einsiedlerhof", "Kaiserslautern-West", "Kreuz Kaiserslautern", "Kaiserslautern-Ost", "Enkenbach-Alsenborn", "Sembach", "Wattenheim", "Grünstadt", "Kreuz Frankenthal", "Frankenthal"],
    A8: ["Zweibrücken-Mitte", "Zweibrücken-Ixheim", "Pirmasens-Winzeln"],
    A48: ["Dreieck Vulkaneifel", "Ulmen", "Kaisersesch", "Kaifenheim", "Polch", "Ochtendung", "Koblenz-Metternich", "Kreuz Koblenz"],
    A60: ["Prüm", "Bitburg", "Dreieck Vulkaneifel", "Wittlich", "Rheinböllen", "Mainz-Finthen", "Mainz-Gonsenheim", "Kreuz Mainz-Süd"],
    A61: ["Kreuz Meckenheim", "Bad Neuenahr-Ahrweiler", "Sinzig", "Kreuz Koblenz", "Boppard", "Emmelshausen", "Laudert", "Rheinböllen", "Dreieck Nahetal", "Bad Kreuznach", "Gau-Bickelheim", "Kreuz Alzey", "Worms", "Frankenthal", "Kreuz Frankenthal", "Ludwigshafen", "Speyer"],
    A62: ["Freisen", "Kusel", "Glan-Münchweiler", "Bruchmühlbach-Miesau", "Landstuhl-West", "Kreuz Landstuhl", "Trippstadt", "Pirmasens-Nord", "Thaleischweiler-Fröschen", "Pirmasens-Zweibrücken"],
    A63: ["Kreuz Mainz-Süd", "Mainz-Finthen", "Nieder-Olm", "Saulheim", "Wörrstadt", "Biebelnheim", "Alzey", "Kreuz Alzey", "Kirchheimbolanden", "Winnweiler", "Sembach", "Kreuz Kaiserslautern"],
    A64: ["Trier-Ehrang", "Trier-Zewen", "Igel", "Wasserbillig"],
    A65: ["Kreuz Ludwigshafen", "Mutterstadt", "Schifferstadt", "Haßloch", "Neustadt-Nord", "Neustadt-Süd", "Edenkoben", "Landau-Nord", "Landau-Zentrum", "Landau-Süd", "Insheim", "Rohrbach", "Kandel-Nord"],
    A602: ["Kreuz Trier", "Trier-Ehrang", "Trier-Nord", "Trier-Verteilerkreis"],
  },
};

/** Kreuze/Dreiecke korrekt benennen, sonst ist es eine Ausfahrt. */
export function exitLabel(name: string) {
  if (/^Kreuz\s/i.test(name)) return name.replace(/^Kreuz\s/i, "dem Autobahnkreuz ");
  if (/^Dreieck\s/i.test(name)) return name.replace(/^Dreieck\s/i, "dem Autobahndreieck ");
  return `der Ausfahrt ${name}`;
}

function endpointLabel(raw: string) {
  const value = raw
    .replace(/^(?:der|dem|die)\s+/i, "")
    .replace(/\s+(?:Ereignismeldung|Ereignisnummer|Beginn|seit)\b.*$/i, "")
    .replace(/^AS\s+/i, "Ausfahrt ")
    .replace(/^ASt\.?\s+/i, "Ausfahrt ")
    .replace(/^Anschlussstelle\s+/i, "Ausfahrt ")
    .replace(/^AK\s+/i, "Autobahnkreuz ")
    .replace(/^AD\s+/i, "Autobahndreieck ")
    .replace(/^Kreuz\s+/i, "Autobahnkreuz ")
    .replace(/^Dreieck\s+/i, "Autobahndreieck ")
    .trim();

  if (!/^(AS|ASt\.?|Anschlussstelle|Ausfahrt|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck|Raststätte|Rastanlage|Tunnel|Brücke)\s/i.test(raw.trim())) {
    return value;
  }
  if (/^(Ausfahrt|Autobahnkreuz|Autobahndreieck|Raststätte|Rastanlage|Tunnel|Brücke)\s/i.test(value)) {
    return value;
  }
  return `Ausfahrt ${value}`;
}

function explicitSection(text: string) {
  const m = text.match(
    /zwischen\s+(?:(?:\d+(?:[.,]\d+)?)\s*km\s+)?(?:hinter|nach)?\s*((?:(?:AS|ASt\.?|Anschlussstelle|Ausfahrt|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck)\s+)?[A-ZÄÖÜ][\wäöüß./-]*(?:[- ][A-ZÄÖÜ][\wäöüß./-]*)?)\s+und\s+(?:(?:\d+(?:[.,]\d+)?)\s*km\s+)?(?:vor|bis)?\s*((?:(?:AS|ASt\.?|Anschlussstelle|Ausfahrt|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck)\s+)?[A-ZÄÖÜ][\wäöüß./-]*(?:[- ][A-ZÄÖÜ][\wäöüß./-]*)?)/i,
  );
  if (!m) return null;
  return `zwischen ${endpointLabel(m[1])} und ${endpointLabel(m[2])}`;
}

function norm(s: string) {
  return s.toLowerCase().replace(/[-\s./]/g, "");
}

function roadKey(road: string) {
  return road?.replace(/\s+/g, "").toUpperCase();
}

function aliases(name: string) {
  const withoutKind = name.replace(/^(Kreuz|Dreieck)\s/i, "");
  const isJunction = /^(Kreuz|Dreieck)\s/i.test(name);
  const values = isJunction
    ? [
        name,
        name.replace(/^Kreuz\s/i, "AK "),
        name.replace(/^Dreieck\s/i, "AD "),
        name.replace(/^Kreuz\s/i, "Autobahnkreuz "),
        name.replace(/^Dreieck\s/i, "Autobahndreieck "),
      ]
    : [name, `AS ${name}`, `ASt ${name}`, `Ausfahrt ${name}`, `Anschlussstelle ${name}`, withoutKind];
  return Array.from(new Set(values)).filter((a) => norm(a).length >= 4);
}

function hasAlias(text: string, name: string) {
  return aliases(name).some((alias) => {
    const prefix = /^(AS|ASt\.?|Ausfahrt|Anschlussstelle|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck)\s/i.test(alias)
      ? ""
      : "(?:AS|ASt\\.?|Ausfahrt|Anschlussstelle|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck)?\\s*";
    return new RegExp(`(?:^|[^\\p{L}\\p{N}/-])${prefix}${escapeRegExp(alias)}(?![\\p{L}\\p{N}/-])`, "iu").test(text);
  });
}

function contextBefore(text: string, name: string) {
  return aliases(name).some((alias) =>
    new RegExp(`\\bvor\\s+(?:AS|ASt\\.?|Ausfahrt|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck)?\\s*${escapeRegExp(alias)}`, "i").test(text),
  );
}

function contextAfter(text: string, name: string) {
  return aliases(name).some((alias) =>
    new RegExp(`\\bhinter\\s+(?:AS|ASt\\.?|Ausfahrt|AK|AD|Kreuz|Dreieck|Autobahnkreuz|Autobahndreieck)?\\s*${escapeRegExp(alias)}`, "i").test(text),
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Ermittelt den exakten Stau-Abschnitt einer Autobahn.
 * Werden zwei Punkte erkannt, wird der Abschnitt dazwischen benannt;
 * bei nur einem Punkt wird die benachbarte Anschlussstelle ergänzt.
 */
export function exactSection(road: string, text: string): string | null {
  const explicit = explicitSection(text);
  if (explicit) return explicit;

  const list = AUTOBAHN_EXITS[roadKey(road)];
  if (!list) return null;

  const hits: number[] = [];
  list.forEach((name, i) => {
    if (hasAlias(text, name)) hits.push(i);
  });
  if (!hits.length) return null;

  let a = Math.min(...hits);
  let b = Math.max(...hits);
  if (a === b) {
    // Nur ein Punkt bekannt: aus „vor AS X" bzw. „hinter AS X" den korrekten Nachbarn wählen.
    if (contextBefore(text, list[a]) && a - 1 >= 0) a = a - 1;
    else if (contextAfter(text, list[b]) && b + 1 < list.length) b = b + 1;
    else if (b + 1 < list.length) b = b + 1;
    else if (a - 1 >= 0) a = a - 1;
    else return `an ${exitLabel(list[a])}`;
  }
  return `zwischen ${exitLabel(list[a])} und ${exitLabel(list[b])}`;
}

/** True, wenn eine Meldung auf einen bekannten Saarland/RLP-Abschnitt passt. */
export function isRegionalTraffic(road: string, text: string, region?: "Saarland" | "Rheinland-Pfalz") {
  const key = roadKey(road);
  const list = region ? AUTOBAHN_REGION_EXITS[region]?.[key] : AUTOBAHN_EXITS[key];
  return Boolean(list?.some((name) => hasAlias(text, name)));
}

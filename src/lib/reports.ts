import type { Report } from "./broadcast-types";

const KEY = "ws-reports";

export function loadReports(): Report[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Report[]) : [];
  } catch {
    return [];
  }
}

export function saveReports(reports: Report[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(reports));
}

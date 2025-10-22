// src/state/notif.ts
import fs from "node:fs";
import path from "node:path";

const FILE = path.resolve(process.cwd(), ".notif-state.json");

type State = { enabled: boolean; lastRowCount: number; lastHash?: string };

function load(): State {
  try { return JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { return { enabled: true, lastRowCount: 0 }; }
}
function save(s: State) { fs.writeFileSync(FILE, JSON.stringify(s), "utf8"); }

export const NotifState = { load, save, FILE };

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

function stripQuotes(value) {
  if (
    (value.startsWith("\"") && value.endsWith("\""))
    || (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadEnvFile({
  filePath = path.join(process.cwd(), ".env.local"),
  env = process.env
} = {}) {
  if (!existsSync(filePath)) return false;

  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = stripQuotes(trimmed.slice(separatorIndex + 1).trim());
    if (!key || env[key] !== undefined) continue;

    env[key] = value;
  }

  return true;
}

loadEnvFile();

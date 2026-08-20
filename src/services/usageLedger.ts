import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { CostTier } from "./costPolicy.js";

export interface UsageEvent {
  api: string;
  operation: string;
  tier: CostTier;
  units: number;
  parentTool?: string;
  reason?: string;
}

interface UsageMonth {
  month: string;
  byKey: Record<string, number>;
  totalUnits: number;
}

const DEFAULT_CAPS: Record<CostTier, number> = { T0: 0, T1: 10000, T2: 5000, T3: 1000, T4: 1000 };

function warningCap(tier: CostTier): number {
  const configured = Number.parseInt(process.env[`MCP_USAGE_WARNING_CAP_${tier}`] || "", 10);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_CAPS[tier];
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7);
}

function defaultPath(): string {
  const stateHome = process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
  return join(stateHome, "mcp-google-map", "usage.json");
}

export class UsageLedger {
  private readonly filePath: string;
  private queue: Promise<void> = Promise.resolve();

  constructor(filePath = process.env.MCP_USAGE_LEDGER_PATH || defaultPath()) {
    this.filePath = filePath;
  }

  get path(): string {
    return this.filePath;
  }

  record(event: UsageEvent): Promise<string[]> {
    const operation = async () => {
      const month = await this.load();
      const key = `${event.api}:${event.operation}:${event.tier}`;
      month.byKey[key] = (month.byKey[key] || 0) + event.units;
      month.totalUnits += event.units;
      await this.save(month);

      const used = month.byKey[key];
      const cap = warningCap(event.tier);
      const warnings: string[] = [];
      if (cap > 0 && used >= cap * 0.95)
        warnings.push(`${key} usage is at or above 95% of the documented monthly allowance (${used}/${cap}).`);
      else if (cap > 0 && used >= cap * 0.8)
        warnings.push(`${key} usage is at or above 80% of the documented monthly allowance (${used}/${cap}).`);
      return warnings;
    };
    const result = this.queue.then(operation);
    this.queue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }

  private async load(): Promise<UsageMonth> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as UsageMonth;
      if (parsed.month === monthKey()) return parsed;
    } catch {
      // A missing or malformed ledger is recoverable because it contains no source data.
    }
    return { month: monthKey(), byKey: {}, totalUnits: 0 };
  }

  private async save(month: UsageMonth): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(month, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}

export const usageLedger = new UsageLedger();

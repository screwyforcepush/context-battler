import { mkdir, writeFile as fsWriteFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { makeConvexClient } from "./client.js";
import { api } from "../convex/_generated/api.js";
import {
  computeBehaviourDiagnostics,
  type BehaviourDiagnostics,
} from "./diagnostics/behaviour.js";
import {
  computeCriticalDiagnostics,
  type CriticalDiagnostics,
} from "./diagnostics/critical.js";
import {
  computeMechanicsDiagnostics,
  type MechanicsDiagnostics,
} from "./diagnostics/mechanics.js";
import {
  MAX_MATCHES,
  type DiagnosticMatch,
  type DiagnosticsClient,
  type FetchSlimAcross,
  type SlimMatchRows,
  type SlimTurnRow,
} from "./diagnostics/types.js";

type DiagnosticsFormat = "json" | "markdown";

export type DiagnosticsArgs = {
  last: number;
  format: DiagnosticsFormat;
  out?: string;
  help: boolean;
};

export type DiagnosticsReport = {
  metadata: {
    matchIds: string[];
    matchCount: number;
    turnCount: number;
    recordCount: number;
  };
  critical: CriticalDiagnostics;
  mechanics: MechanicsDiagnostics;
  behaviour: BehaviourDiagnostics;
};

export type DiagnosticsCliDeps = {
  client?: DiagnosticsClient;
  makeClient?: () => DiagnosticsClient;
  listMatches?: (
    client: DiagnosticsClient,
    last: number,
  ) => Promise<DiagnosticMatch[]>;
  fetchSlimAcross?: FetchSlimAcross;
  writeStdout?: (text: string) => void;
  writeStderr?: (text: string) => void;
  writeFile?: (path: string, text: string) => Promise<void>;
};

export type DiagnosticsCliResult = {
  exitCode: number;
  report?: DiagnosticsReport;
};

type ApiRefs = {
  replay: { listMatches: unknown };
  turns: { byMatchSlim: unknown };
};

const apiRefs = api as unknown as ApiRefs;

export function parseDiagnosticsArgs(argv: string[]): DiagnosticsArgs {
  let last = MAX_MATCHES;
  let format: DiagnosticsFormat = "markdown";
  let out: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--last") {
      const next = argv[i + 1];
      if (next === undefined) throw new Error("--last requires a number");
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) {
        throw new Error(`--last must be a number, got ${next}`);
      }
      last = clampLast(Math.trunc(parsed));
      i += 1;
    } else if (arg === "--format") {
      const next = argv[i + 1];
      if (next !== "json" && next !== "markdown") {
        throw new Error("--format must be json or markdown");
      }
      format = next;
      i += 1;
    } else if (arg === "--out") {
      const next = argv[i + 1];
      if (next === undefined || next.trim().length === 0) {
        throw new Error("--out requires a path");
      }
      out = next;
      i += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return out === undefined
    ? { last, format, help }
    : { last, format, out, help };
}

export function buildDiagnosticsReport(
  matches: SlimMatchRows[] | SlimTurnRow[],
): DiagnosticsReport {
  const matchRows = normaliseMatchRows(matches);
  const rows = matchRows.flat();
  const matchIds = [...new Set(rows.map((row) => row.matchId))];
  const recordCount = rows.reduce(
    (count, row) => count + row.agentRecords.length,
    0,
  );

  return {
    metadata: {
      matchIds,
      matchCount: matchIds.length,
      turnCount: rows.length,
      recordCount,
    },
    critical: computeCriticalDiagnostics(rows),
    mechanics: computeMechanicsDiagnostics(rows),
    behaviour: computeBehaviourDiagnostics(rows),
  };
}

export function renderDiagnosticsJson(report: DiagnosticsReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderDiagnosticsMarkdown(report: DiagnosticsReport): string {
  const lines: string[] = [];
  lines.push("# Behavioural Diagnostics");
  lines.push("");
  lines.push(
    `Matches: ${report.metadata.matchCount} | Turns: ${report.metadata.turnCount} | Agent records: ${report.metadata.recordCount}`,
  );
  lines.push("");
  lines.push("## Critical Fails");
  lines.push("");
  lines.push(
    `Fallbacks: ${report.critical.fallback.count}/${report.critical.totalRecords} (${pct(
      report.critical.fallback.rate,
    )})`,
  );
  lines.push(
    `Retry recovery: ${report.critical.retry.recovered}/${report.critical.retry.attempts} (${pct(
      report.critical.retry.recoveryRate,
    )})`,
  );
  appendCountTable(lines, "Failure reasons", report.critical.fallback.byReason);
  appendCountTable(
    lines,
    "Validator field rejections",
    report.critical.validatorFieldRejections.byField,
  );
  lines.push("");
  lines.push("## Mechanics");
  lines.push("");
  appendCountTable(lines, "Attack outcomes", report.mechanics.attackOutcomes);
  lines.push(
    `Overwatch movement-triggered: ${report.mechanics.overwatch.movementTriggered}; defensive: ${report.mechanics.overwatch.defensive}`,
  );
  lines.push(
    `Counters fired: ${report.mechanics.counter.fired}; primed without incoming attack: ${report.mechanics.counter.primedWithoutIncomingAttack}`,
  );
  lines.push(
    `Crate loot: seen ${report.mechanics.loot.crate.seen}, actions ${report.mechanics.loot.crate.lootActions}, opened ${report.mechanics.loot.crate.opened}, equipped ${report.mechanics.loot.crate.equipped}`,
  );
  lines.push(
    `Airdrop funnel: telegraphed-seen ${report.mechanics.airdrop.telegraphedSeen}, landed ${report.mechanics.airdrop.landedSeen}, looted/spent ${report.mechanics.airdrop.lootedSpent}, telefrags ${report.mechanics.airdrop.telefrags}`,
  );
  lines.push(
    `Environmental deaths: ${report.mechanics.environmentalDeaths}; telefrags: ${report.mechanics.airdrop.telefrags}`,
  );
  lines.push(
    `Corpse loot: seen ${report.mechanics.loot.corpse.seen}, actions ${report.mechanics.loot.corpse.lootActions}, looted ${report.mechanics.loot.corpse.looted}, drained-repeat ${report.mechanics.loot.corpse.drainedRepeat}`,
  );
  lines.push(
    `Speech: ${report.mechanics.speech.events} events, mean length ${report.mechanics.speech.meanTextLength.toFixed(
      1,
    )}, fanout ${report.mechanics.speech.heardFanout}`,
  );
  lines.push(
    `Wall-blocked moves: ${report.mechanics.wallBlockedMoves}; movement capped: ${report.mechanics.movement.declaredVsActual.capped}`,
  );
  lines.push("");
  lines.push("## Behaviour");
  lines.push("");
  lines.push(
    `Armed stance pause: ${report.behaviour.noOpSplit.armedStancePauseCount}/${report.behaviour.totalRecords} (${pct(
      report.behaviour.noOpSplit.armedStancePauseRate,
    )})`,
  );
  lines.push(
    `True stationary: ${report.behaviour.noOpSplit.trueStationaryCount}/${report.behaviour.totalRecords} (${pct(
      report.behaviour.noOpSplit.trueStationaryRate,
    )})`,
  );
  lines.push(
    `Saw enemy and no-op: armed stance ${report.behaviour.sawEnemyAndNoOp.armedStancePause}, true stationary ${report.behaviour.sawEnemyAndNoOp.trueStationary}`,
  );
  lines.push("");
  lines.push("| Combo | Count | Examples |");
  lines.push("|---|---:|---|");
  for (const [combo, data] of Object.entries(
    report.behaviour.contextualCombos,
  )) {
    if (data.count === 0) continue;
    const examples = data.examples
      .map((example) => `[${escapePipe(example.label)}](${example.url})`)
      .join(", ");
    lines.push(`| ${escapePipe(combo)} | ${data.count} | ${examples} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export async function runDiagnosticsCli(
  argv = process.argv.slice(2),
  deps: DiagnosticsCliDeps = {},
): Promise<DiagnosticsCliResult> {
  const args = parseDiagnosticsArgs(argv);
  if (args.help) {
    const usage =
      "usage: npx tsx harness/diagnostics.ts --last N --format json|markdown [--out path]\n";
    (deps.writeStdout ?? process.stdout.write.bind(process.stdout))(usage);
    return { exitCode: 0 };
  }

  const client =
    deps.client ??
    deps.makeClient?.() ??
    (makeConvexClient() as unknown as DiagnosticsClient);
  const listMatches = deps.listMatches ?? resolveLastCompletedMatches;
  const fetchSlimAcross =
    deps.fetchSlimAcross ?? (await loadFetchSlimAcross()) ?? fetchSlimAcrossDirect;

  const matches = await listMatches(client, args.last);
  const matchIds = matches.map((match) => match._id);
  const slimRows = await fetchSlimAcross(client, matchIds);
  const report = buildDiagnosticsReport(slimRows);
  const rendered =
    args.format === "json"
      ? renderDiagnosticsJson(report)
      : renderDiagnosticsMarkdown(report);

  if (args.out !== undefined) {
    await (deps.writeFile ?? writeOutputFile)(args.out, rendered);
  } else {
    (deps.writeStdout ?? process.stdout.write.bind(process.stdout))(rendered);
  }

  return { exitCode: 0, report };
}

export async function resolveLastCompletedMatches(
  client: DiagnosticsClient,
  last: number,
): Promise<DiagnosticMatch[]> {
  const result = await client.query(apiRefs.replay.listMatches, {
    paginationOpts: { numItems: clampLast(last), cursor: null },
  });
  if (Array.isArray(result)) return result as DiagnosticMatch[];
  if (
    typeof result === "object" &&
    result !== null &&
    "page" in result &&
    Array.isArray((result as { page: unknown }).page)
  ) {
    return (result as { page: DiagnosticMatch[] }).page;
  }
  throw new Error("replay.listMatches returned an unexpected shape");
}

export async function fetchSlimAcrossDirect(
  client: DiagnosticsClient,
  matchIds: string[],
): Promise<SlimMatchRows[]> {
  return await Promise.all(
    matchIds.map(async (matchId) => {
      const rows = await client.query(apiRefs.turns.byMatchSlim, { matchId });
      if (!Array.isArray(rows)) {
        throw new Error(`turns.byMatchSlim returned non-array for ${matchId}`);
      }
      return rows as SlimMatchRows;
    }),
  );
}

function clampLast(last: number): number {
  if (last < 1) return 1;
  if (last > MAX_MATCHES) return MAX_MATCHES;
  return last;
}

function normaliseMatchRows(
  matches: SlimMatchRows[] | SlimTurnRow[],
): SlimMatchRows[] {
  if (matches.length === 0) return [];
  const first = matches[0];
  if (Array.isArray(first)) return matches as SlimMatchRows[];
  return [matches as SlimTurnRow[]];
}

async function loadFetchSlimAcross(): Promise<FetchSlimAcross | null> {
  const modulePath = "./diagnostics/fanout.js";
  try {
    const mod = (await import(modulePath)) as {
      fetchSlimAcross?: unknown;
    };
    return typeof mod.fetchSlimAcross === "function"
      ? (mod.fetchSlimAcross as FetchSlimAcross)
      : null;
  } catch (error) {
    if (isModuleNotFoundForFanout(error)) return null;
    throw error;
  }
}

function isModuleNotFoundForFanout(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as Error & { code?: string }).code === "ERR_MODULE_NOT_FOUND" &&
    error.message.includes("diagnostics/fanout")
  );
}

async function writeOutputFile(path: string, text: string): Promise<void> {
  const absolute = resolve(path);
  await mkdir(dirname(absolute), { recursive: true });
  await fsWriteFile(absolute, text, "utf8");
}

function appendCountTable(
  lines: string[],
  title: string,
  counts: Partial<Record<string, number>>,
): void {
  lines.push("");
  lines.push(`### ${title}`);
  lines.push("");
  lines.push("| Bucket | Count |");
  lines.push("|---|---:|");
  const entries = Object.entries(counts);
  if (entries.length === 0) {
    lines.push("| none | 0 |");
    return;
  }
  for (const [key, count] of entries) {
    lines.push(`| ${escapePipe(key)} | ${count} |`);
  }
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function escapePipe(value: string): string {
  return value.replaceAll("|", "\\|");
}

function isMain(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url);
}

if (isMain()) {
  try {
    const result = await runDiagnosticsCli();
    process.exitCode = result.exitCode;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

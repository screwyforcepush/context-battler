import React, { useEffect, useMemo, useState } from "react";
import {
  computeBehaviourDiagnostics,
  type BehaviourDiagnostics,
} from "../../../../harness/diagnostics/behaviour";
import {
  computeCriticalDiagnostics,
  type CriticalDiagnostics,
} from "../../../../harness/diagnostics/critical";
import {
  computeMechanicsDiagnostics,
  type MechanicsDiagnostics,
} from "../../../../harness/diagnostics/mechanics";
import type {
  CountMap,
  DrilldownExample,
  SlimAgentRecord,
  SlimTurnRow,
} from "../../../../harness/diagnostics/types";
import { convexClient } from "../lib/convexClient";
import {
  fetchDiagnosticsDashboardData,
  type CompletedMatch,
  type DiagnosticsDashboardData,
} from "../lib/diagnosticsFanout";
import { clampDiagnosticsLast } from "../lib/useHashRoute";

type DiagnosticsReport = {
  critical: CriticalDiagnostics;
  mechanics: MechanicsDiagnostics;
  behaviour: BehaviourDiagnostics;
};

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: Error }
  | { status: "ready"; data: DiagnosticsDashboardData };

type ExampleBuckets = Record<string, DrilldownExample[]>;

type DashboardExamples = {
  attackOutcomes: ExampleBuckets;
  consumeItems: ExampleBuckets;
  loot: ExampleBuckets;
  validatorFields: ExampleBuckets;
};

type CountRow = {
  label: string;
  count: number;
  examples?: DrilldownExample[];
};

export function Diagnostics(props: { last: number }): React.ReactElement {
  const last = clampDiagnosticsLast(props.last);
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchDiagnosticsDashboardData(convexClient, last)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          status: "error",
          error: err instanceof Error ? err : new Error(String(err)),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [last]);

  return (
    <main style={mainStyle}>
      <header style={headerStyle}>
        <div>
          <h1 style={h1Style}>Behavioural Diagnostics</h1>
          <p style={subtitleStyle}>Last completed matches: {last}</p>
        </div>
        <label style={controlStyle}>
          <span style={controlLabelStyle}>last</span>
          <input
            type="number"
            min={1}
            max={20}
            value={last}
            onChange={(e) => {
              const next = clampDiagnosticsLast(Number(e.currentTarget.value));
              window.location.hash = `#/diagnostics?last=${next}`;
            }}
            style={numberInputStyle}
          />
        </label>
      </header>

      {state.status === "loading" ? (
        <p style={mutedBlockStyle}>Loading diagnostics...</p>
      ) : state.status === "error" ? (
        <ErrorBlock error={state.error} />
      ) : (
        <DiagnosticsBody data={state.data} />
      )}
    </main>
  );
}

function DiagnosticsBody(props: {
  data: DiagnosticsDashboardData;
}): React.ReactElement {
  const { data } = props;
  const report = useMemo(() => buildReport(data.rows), [data.rows]);
  const examples = useMemo(() => collectExamples(data.rows), [data.rows]);

  if (data.matches.length === 0) {
    return (
      <p style={mutedBlockStyle}>
        No completed matches found in this deployment.
      </p>
    );
  }

  return (
    <div style={pageStackStyle}>
      <RunSummary
        matches={data.matches}
        turnCount={data.rows.length}
        recordCount={report.critical.totalRecords}
      />
      <CriticalSection report={report.critical} examples={examples} />
      <MechanicsSection report={report.mechanics} examples={examples} />
      <BehaviourSection report={report.behaviour} />
    </div>
  );
}

function buildReport(rows: SlimTurnRow[]): DiagnosticsReport {
  return {
    critical: computeCriticalDiagnostics(rows),
    mechanics: computeMechanicsDiagnostics(rows),
    behaviour: computeBehaviourDiagnostics(rows),
  };
}

function RunSummary(props: {
  matches: CompletedMatch[];
  turnCount: number;
  recordCount: number;
}): React.ReactElement {
  const newest = props.matches[0];
  return (
    <section style={summaryBandStyle}>
      <MetricCard label="matches" value={String(props.matches.length)} />
      <MetricCard label="turns" value={formatInt(props.turnCount)} />
      <MetricCard label="agent records" value={formatInt(props.recordCount)} />
      <MetricCard
        label="newest"
        value={newest ? truncateId(newest._id) : "-"}
        detail={newest ? formatStarted(newest.startedAt) : undefined}
      />
    </section>
  );
}

function CriticalSection(props: {
  report: CriticalDiagnostics;
  examples: DashboardExamples;
}): React.ReactElement {
  const { report, examples } = props;
  const tokenRows: CountRow[] = [
    { label: "<50%", count: report.outputTokenProximity.histogram.lt50 },
    {
      label: "50-80%",
      count: report.outputTokenProximity.histogram.from50To80,
    },
    {
      label: "80-95%",
      count: report.outputTokenProximity.histogram.from80To95,
    },
    { label: ">=95%", count: report.outputTokenProximity.histogram.gte95 },
    { label: "missing", count: report.outputTokenProximity.histogram.missing },
  ];
  return (
    <Section title="Critical">
      <section style={summaryBandStyle}>
        <MetricCard
          label="fallbacks"
          value={`${formatInt(report.fallback.count)} / ${formatInt(
            report.totalRecords,
          )}`}
          detail={formatPct(report.fallback.rate)}
        />
        <MetricCard
          label="retry recovery"
          value={`${formatInt(report.retry.recovered)} / ${formatInt(
            report.retry.attempts,
          )}`}
          detail={formatPct(report.retry.recoveryRate)}
        />
        <MetricCard
          label="field rejections"
          value={formatInt(report.validatorFieldRejections.total)}
        />
        <MetricCard
          label="token cap"
          value={formatInt(report.outputTokenProximity.cap)}
        />
      </section>
      <TwoColumn>
        <CountTable
          title="Failure reasons"
          rows={rowsFromCountMap(
            report.fallback.byReason,
            report.fallback.examplesByReason,
          )}
        />
        <CountTable title="Output token proximity" rows={tokenRows} />
      </TwoColumn>
      <TwoColumn>
        <CountTable
          title="Validator fields"
          rows={rowsFromPartialCountMap(
            report.validatorFieldRejections.byField,
            examples.validatorFields,
          )}
        />
        <PersonaFailureTable data={report.personaFailureReasons} />
      </TwoColumn>
    </Section>
  );
}

function MechanicsSection(props: {
  report: MechanicsDiagnostics;
  examples: DashboardExamples;
}): React.ReactElement {
  const { report, examples } = props;
  return (
    <Section title="Mechanics">
      <section style={summaryBandStyle}>
        <MetricCard
          label="overwatch"
          value={`${formatInt(report.overwatch.movementTriggered)} / ${formatInt(
            report.overwatch.defensive,
          )}`}
          detail="movement / defensive"
        />
        <MetricCard
          label="counter"
          value={`${formatInt(report.counter.fired)} / ${formatInt(
            report.counter.primedWithoutIncomingAttack,
          )}`}
          detail="fired / primed"
        />
        <MetricCard
          label="speech"
          value={formatInt(report.speech.events)}
          detail={`mean ${report.speech.meanTextLength.toFixed(1)} chars`}
        />
        <MetricCard
          label="damage feed"
          value={`${formatInt(report.damageFeedAudit.incoming)} / ${formatInt(
            report.damageFeedAudit.outgoing,
          )}`}
          detail="incoming / outgoing"
        />
      </section>
      <TwoColumn>
        <CountTable
          title="Attack outcomes"
          rows={rowsFromCountMap(
            report.attackOutcomes,
            examples.attackOutcomes,
          )}
        />
        <CountTable
          title="Consume"
          rows={[
            ...rowsFromCountMap(report.consume.byItem, examples.consumeItems),
            {
              label: "speed without movement",
              count: report.consume.wastedSpeedWithoutMovement,
            },
            { label: "heal at full HP", count: report.consume.healAtFullHp },
          ]}
        />
      </TwoColumn>
      <TwoColumn>
        <CountTable
          title="Chest funnel"
          rows={[
            {
              label: "seen",
              count: report.loot.chest.seen,
              examples: examples.loot["chest:seen"],
            },
            {
              label: "loot actions",
              count: report.loot.chest.lootActions,
              examples: examples.loot["chest:action"],
            },
            {
              label: "opened",
              count: report.loot.chest.opened,
              examples: examples.loot["chest:opened"],
            },
            {
              label: "equipped",
              count: report.loot.chest.equipped,
              examples: examples.loot["chest:equipped"],
            },
            {
              label: "empty",
              count: report.loot.chest.empty,
              examples: examples.loot["chest:empty"],
            },
            {
              label: "same-turn collision",
              count: report.loot.chest.sameTurnCollision,
              examples: examples.loot["chest:already_opened"],
            },
          ]}
        />
        <CountTable
          title="Corpse funnel"
          rows={[
            {
              label: "seen",
              count: report.loot.corpse.seen,
              examples: examples.loot["corpse:seen"],
            },
            {
              label: "loot actions",
              count: report.loot.corpse.lootActions,
              examples: examples.loot["corpse:action"],
            },
            {
              label: "looted",
              count: report.loot.corpse.looted,
              examples: examples.loot["corpse:looted"],
            },
            {
              label: "drained repeat",
              count: report.loot.corpse.drainedRepeat,
              examples: examples.loot["corpse:empty"],
            },
            {
              label: "no corpse",
              count: report.loot.corpse.noCorpse,
              examples: examples.loot["corpse:no_corpse"],
            },
          ]}
        />
      </TwoColumn>
      <CountTable
        title="Movement"
        rows={[
          {
            label: "declared vs actual compared",
            count: report.movement.declaredVsActual.compared,
          },
          {
            label: "exact",
            count: report.movement.declaredVsActual.exact,
          },
          {
            label: "capped",
            count: report.movement.declaredVsActual.capped,
            examples: report.movement.declaredVsActual.examples,
          },
          {
            label: "over-moved",
            count: report.movement.declaredVsActual.overMoved,
          },
          { label: "wall-blocked", count: report.wallBlockedMoves },
          { label: "deaths", count: report.deaths },
        ]}
      />
    </Section>
  );
}

function BehaviourSection(props: {
  report: BehaviourDiagnostics;
}): React.ReactElement {
  const { report } = props;
  return (
    <Section title="Behaviour">
      <section style={summaryBandStyle}>
        <MetricCard
          label="armed stance pause"
          value={formatInt(report.noOpSplit.armedStancePauseCount)}
          detail={formatPct(report.noOpSplit.armedStancePauseRate)}
        />
        <MetricCard
          label="true stationary"
          value={formatInt(report.noOpSplit.trueStationaryCount)}
          detail={formatPct(report.noOpSplit.trueStationaryRate)}
        />
        <MetricCard
          label="saw enemy + no-op"
          value={formatInt(report.sawEnemyAndNoOp.total)}
          detail={`${formatInt(
            report.sawEnemyAndNoOp.armedStancePause,
          )} armed / ${formatInt(report.sawEnemyAndNoOp.trueStationary)} true`}
        />
        <MetricCard
          label="records"
          value={formatInt(report.totalRecords)}
        />
      </section>
      <TwoColumn>
        <CountTable
          title="Turn phase"
          rows={rowsFromCountMap(report.phaseDistribution)}
        />
        <CountTable
          title="Visibility"
          rows={rowsFromCountMap(report.crossCuts.visibility)}
        />
      </TwoColumn>
      <CountTable
        title="Contextual combos"
        rows={Object.entries(report.contextualCombos)
          .filter(([, data]) => data.count > 0)
          .map(([label, data]) => ({
            label,
            count: data.count,
            examples: data.examples,
          }))}
      />
      <TwoColumn>
        <PersonaRatesTable
          title="Say rate by persona"
          rows={report.sayRateByPersona}
        />
        <PersonaRatesTable
          title="Scratchpad churn by persona"
          rows={report.scratchpadChurnByPersona}
        />
      </TwoColumn>
      <TwoColumn>
        <CountTable
          title="Equipment"
          rows={rowsFromCountMap(report.crossCuts.equipment)}
        />
        <PersonaCutTable data={report.crossCuts.persona} />
      </TwoColumn>
    </Section>
  );
}

function collectExamples(rows: SlimTurnRow[]): DashboardExamples {
  const buckets: DashboardExamples = {
    attackOutcomes: {},
    consumeItems: {},
    loot: {},
    validatorFields: {},
  };

  for (const turn of rows) {
    for (const record of turn.agentRecords) {
      for (const field of Object.keys(record.llm.validatorFieldErrors ?? {})) {
        pushBucketExample(buckets.validatorFields, field, turn, record);
      }
      if (record.visibleSummary.chests > 0) {
        pushBucketExample(buckets.loot, "chest:seen", turn, record);
      }
      if (record.visibleSummary.corpses > 0) {
        pushBucketExample(buckets.loot, "corpse:seen", turn, record);
      }
      if (record.decision.action.kind === "loot") {
        const target = record.decision.action.targetId;
        if (isChestTarget(target)) {
          pushBucketExample(buckets.loot, "chest:action", turn, record);
        } else if (isCorpseTarget(target)) {
          pushBucketExample(buckets.loot, "corpse:action", turn, record);
        }
      }
      if (record.decision.use === "consumable") {
        const item = record.selfEquipment.consumable ?? "consumable";
        pushBucketExample(buckets.consumeItems, item, turn, record);
      }
    }

    for (const action of turn.resolution.actions) {
      const record = turn.agentRecords.find(
        (candidate) => candidate.characterId === action.characterId,
      );
      if (!record) continue;
      if (action.kind === "attack") {
        pushBucketExample(
          buckets.attackOutcomes,
          attackOutcomeBucket(action.result),
          turn,
          record,
        );
      } else if (action.kind === "loot") {
        if (isChestTarget(action.target)) {
          pushBucketExample(buckets.loot, `chest:${action.result}`, turn, record);
          if (
            action.result === "opened" &&
            typeof action.lootedItem === "string"
          ) {
            pushBucketExample(buckets.loot, "chest:equipped", turn, record);
          }
        } else if (isCorpseTarget(action.target)) {
          pushBucketExample(
            buckets.loot,
            `corpse:${action.result}`,
            turn,
            record,
          );
        }
      }
    }
  }

  return buckets;
}

function pushBucketExample(
  buckets: ExampleBuckets,
  key: string,
  turn: SlimTurnRow,
  record: SlimAgentRecord,
): void {
  const examples = buckets[key] ?? [];
  buckets[key] = examples;
  if (examples.length >= 5) return;
  examples.push(makeDrilldownExample(turn, record));
}

function makeDrilldownExample(
  turn: SlimTurnRow,
  record: SlimAgentRecord,
): DrilldownExample {
  const character = personaDisplayName(record.personaId);
  return {
    matchId: String(turn.matchId),
    turn: turn.turn,
    characterId: record.characterId,
    personaId: record.personaId,
    url: `#/match/${encodeURIComponent(String(turn.matchId))}?turn=${
      turn.turn
    }&character=${encodeURIComponent(character)}`,
    label: `${character} T${turn.turn}`,
  };
}

function rowsFromCountMap(
  map: CountMap,
  examples: ExampleBuckets = {},
): CountRow[] {
  return Object.entries(map).map(([label, count]) => ({
    label,
    count,
    examples: examples[label],
  }));
}

function rowsFromPartialCountMap(
  map: Partial<Record<string, number>>,
  examples: ExampleBuckets = {},
): CountRow[] {
  return Object.entries(map)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .map(([label, count]) => ({
      label,
      count,
      examples: examples[label],
    }));
}

function CountTable(props: {
  title: string;
  rows: CountRow[];
}): React.ReactElement {
  const max = Math.max(1, ...props.rows.map((row) => row.count));
  return (
    <section style={tablePanelStyle}>
      <h3 style={h3Style}>{props.title}</h3>
      {props.rows.length === 0 ? (
        <p style={mutedTableStyle}>No rows.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>bucket</th>
              <th style={numericThStyle}>count</th>
              <th style={barThStyle}>share</th>
              <th style={thStyle}>examples</th>
            </tr>
          </thead>
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.label}>
                <td style={cellStyle}>{row.label}</td>
                <td style={numericCellStyle}>{formatInt(row.count)}</td>
                <td style={barCellStyle}>
                  <InlineBar value={row.count} max={max} />
                </td>
                <td style={cellStyle}>
                  <ExampleLinks examples={row.count > 0 ? (row.examples ?? []) : []} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PersonaFailureTable(props: {
  data: Record<string, CountMap>;
}): React.ReactElement {
  const rows = Object.entries(props.data);
  return (
    <section style={tablePanelStyle}>
      <h3 style={h3Style}>Persona failure reasons</h3>
      {rows.length === 0 ? (
        <p style={mutedTableStyle}>No rows.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>persona</th>
              <th style={thStyle}>top reasons</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([persona, counts]) => (
              <tr key={persona}>
                <td style={cellStyle}>{persona}</td>
                <td style={cellStyle}>{formatTopCounts(counts)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PersonaRatesTable(props: {
  title: string;
  rows: Record<string, { total: number; rate: number; said?: number; changed?: number }>;
}): React.ReactElement {
  const rows = Object.entries(props.rows);
  return (
    <section style={tablePanelStyle}>
      <h3 style={h3Style}>{props.title}</h3>
      {rows.length === 0 ? (
        <p style={mutedTableStyle}>No rows.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>persona</th>
              <th style={numericThStyle}>rate</th>
              <th style={barThStyle}>bar</th>
              <th style={numericThStyle}>total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([persona, row]) => (
              <tr key={persona}>
                <td style={cellStyle}>{persona}</td>
                <td style={numericCellStyle}>{formatPct(row.rate)}</td>
                <td style={barCellStyle}>
                  <InlineBar value={row.rate} max={1} />
                </td>
                <td style={numericCellStyle}>{formatInt(row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PersonaCutTable(props: {
  data: BehaviourDiagnostics["crossCuts"]["persona"];
}): React.ReactElement {
  const rows = Object.entries(props.data);
  return (
    <section style={tablePanelStyle}>
      <h3 style={h3Style}>Persona cross-cut</h3>
      {rows.length === 0 ? (
        <p style={mutedTableStyle}>No rows.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>persona</th>
              <th style={numericThStyle}>total</th>
              <th style={numericThStyle}>enemy visible</th>
              <th style={numericThStyle}>damaged</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([persona, row]) => (
              <tr key={persona}>
                <td style={cellStyle}>{persona}</td>
                <td style={numericCellStyle}>{formatInt(row.total)}</td>
                <td style={numericCellStyle}>
                  {formatInt(row.visibility.enemyVisible)}
                </td>
                <td style={numericCellStyle}>
                  {formatInt(row.visibility.damagedLastTurn)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function Section(props: {
  title: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section style={sectionStyle}>
      <h2 style={h2Style}>{props.title}</h2>
      <div style={sectionStackStyle}>{props.children}</div>
    </section>
  );
}

function TwoColumn(props: { children: React.ReactNode }): React.ReactElement {
  return <div style={twoColumnStyle}>{props.children}</div>;
}

function MetricCard(props: {
  label: string;
  value: string;
  detail?: string;
}): React.ReactElement {
  return (
    <div style={metricStyle}>
      <div style={metricLabelStyle}>{props.label}</div>
      <div style={metricValueStyle}>{props.value}</div>
      {props.detail ? <div style={metricDetailStyle}>{props.detail}</div> : null}
    </div>
  );
}

function InlineBar(props: {
  value: number;
  max: number;
}): React.ReactElement {
  const width = props.max <= 0 ? 0 : Math.max(0, Math.min(1, props.value / props.max));
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      style={barStyle}
      aria-hidden="true"
    >
      <rect x="0" y="1" width="100" height="8" rx="1" fill="#e9ecef" />
      <rect
        x="0"
        y="1"
        width={width * 100}
        height="8"
        rx="1"
        fill="#4f6f8f"
      />
    </svg>
  );
}

function ExampleLinks(props: {
  examples: DrilldownExample[];
}): React.ReactElement {
  if (props.examples.length === 0) {
    return <span style={mutedInlineStyle}>-</span>;
  }
  return (
    <span style={exampleLinksStyle}>
      {props.examples.map((example, index) => (
        <React.Fragment key={`${example.matchId}:${example.turn}:${example.characterId}`}>
          {index > 0 ? <span style={mutedInlineStyle}>, </span> : null}
          <a href={example.url} style={linkStyle}>
            {example.label}
          </a>
        </React.Fragment>
      ))}
    </span>
  );
}

function ErrorBlock(props: { error: Error }): React.ReactElement {
  return (
    <div role="alert" style={errorBoxStyle}>
      <p style={errorTitleStyle}>Couldn’t load diagnostics.</p>
      <p style={errorBodyStyle}>
        Convex deployment doesn’t expose the replay diagnostics queries.
      </p>
      <code style={errorCodeStyle}>{props.error.message}</code>
    </div>
  );
}

function personaDisplayName(personaId: string): string {
  return personaId
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function attackOutcomeBucket(result: string): string {
  if (/^dmg \d+$/.test(result)) return "landed";
  if (result === "missed") return "missed";
  if (result === "out_of_range") return "out_of_range";
  if (result === "blocked_by_cover" || result.includes("cover")) {
    return "blocked_by_cover";
  }
  if (result === "no_target") return "no_target";
  return "other";
}

function isChestTarget(target: string): boolean {
  return /^Chest_-?\d+_-?\d+$/.test(target) || /^chest_\d+$/.test(target);
}

function isCorpseTarget(target: string): boolean {
  return target.startsWith("Corpse_");
}

function formatTopCounts(counts: CountMap): string {
  return Object.entries(counts)
    .slice(0, 3)
    .map(([label, count]) => `${label} ${formatInt(count)}`)
    .join(", ");
}

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatInt(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatStarted(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

function truncateId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

const mainStyle: React.CSSProperties = {
  fontFamily: "system-ui, -apple-system, sans-serif",
  padding: "1.25rem 2rem 2rem 2rem",
  maxWidth: "1500px",
  margin: "0 auto",
  color: "#1a1a1a",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "1rem",
  marginBottom: "1.25rem",
};

const h1Style: React.CSSProperties = {
  fontSize: "1.5rem",
  fontWeight: 600,
  margin: "0 0 0.25rem 0",
};

const h2Style: React.CSSProperties = {
  fontSize: "1.125rem",
  fontWeight: 650,
  margin: 0,
};

const h3Style: React.CSSProperties = {
  fontSize: "0.9375rem",
  fontWeight: 650,
  margin: "0 0 0.625rem 0",
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#666",
  fontSize: "0.875rem",
};

const controlStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "0.5rem",
  fontSize: "0.875rem",
};

const controlLabelStyle: React.CSSProperties = {
  color: "#555",
  fontWeight: 600,
};

const numberInputStyle: React.CSSProperties = {
  width: "4.5rem",
  padding: "0.375rem 0.5rem",
  border: "1px solid #ccc",
  borderRadius: 4,
  fontSize: "0.875rem",
};

const pageStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "1rem",
};

const sectionStyle: React.CSSProperties = {
  borderTop: "1px solid #d8dee4",
  paddingTop: "1rem",
};

const sectionStackStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.875rem",
  marginTop: "0.75rem",
};

const summaryBandStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: "0.75rem",
};

const metricStyle: React.CSSProperties = {
  border: "1px solid #d8dee4",
  borderRadius: 6,
  padding: "0.75rem 0.875rem",
  background: "#fff",
};

const metricLabelStyle: React.CSSProperties = {
  fontSize: "0.75rem",
  color: "#666",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontWeight: 650,
};

const metricValueStyle: React.CSSProperties = {
  fontSize: "1.375rem",
  fontWeight: 650,
  marginTop: "0.25rem",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const metricDetailStyle: React.CSSProperties = {
  color: "#666",
  fontSize: "0.8125rem",
  marginTop: "0.125rem",
};

const twoColumnStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))",
  gap: "0.875rem",
};

const tablePanelStyle: React.CSSProperties = {
  minWidth: 0,
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.8125rem",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "0.45rem 0.55rem",
  borderBottom: "2px solid #d0d7de",
  fontWeight: 650,
  color: "#333",
};

const numericThStyle: React.CSSProperties = {
  ...thStyle,
  textAlign: "right",
  width: "5rem",
};

const barThStyle: React.CSSProperties = {
  ...thStyle,
  width: "9rem",
};

const cellStyle: React.CSSProperties = {
  padding: "0.45rem 0.55rem",
  borderBottom: "1px solid #eaeef2",
  verticalAlign: "top",
};

const numericCellStyle: React.CSSProperties = {
  ...cellStyle,
  textAlign: "right",
  fontFamily:
    'ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace',
};

const barCellStyle: React.CSSProperties = {
  ...cellStyle,
  width: "9rem",
};

const barStyle: React.CSSProperties = {
  width: "100%",
  height: "0.75rem",
  display: "block",
};

const linkStyle: React.CSSProperties = {
  color: "#0366d6",
  textDecoration: "none",
};

const exampleLinksStyle: React.CSSProperties = {
  display: "inline",
  lineHeight: 1.5,
};

const mutedInlineStyle: React.CSSProperties = {
  color: "#888",
};

const mutedBlockStyle: React.CSSProperties = {
  color: "#666",
  fontSize: "0.875rem",
  margin: 0,
};

const mutedTableStyle: React.CSSProperties = {
  color: "#666",
  fontSize: "0.8125rem",
  margin: 0,
};

const errorBoxStyle: React.CSSProperties = {
  padding: "1rem 1.25rem",
  border: "1px solid #d73a49",
  borderLeft: "4px solid #d73a49",
  borderRadius: 4,
  background: "#fff5f6",
};

const errorTitleStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontWeight: 650,
};

const errorBodyStyle: React.CSSProperties = {
  margin: "0 0 0.5rem 0",
  fontSize: "0.875rem",
};

const errorCodeStyle: React.CSSProperties = {
  display: "block",
  padding: "0.5rem",
  background: "#fff",
  border: "1px solid #ddd",
  borderRadius: 4,
  fontSize: "0.75rem",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

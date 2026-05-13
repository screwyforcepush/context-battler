import type { FailureReason } from "../../convex/engine/types.js";
import {
  DEFAULT_OUTPUT_TOKEN_CAP,
  type CountMap,
  type DrilldownExample,
  type SlimTurnRow,
  type ValidatorFieldName,
} from "./types.js";
import { increment, pushExample, rate, sortedCountMap } from "./helpers.js";

export type FailureBucket = FailureReason | "field_rejection" | "unknown";

export type CriticalDiagnostics = {
  totalRecords: number;
  fallback: {
    count: number;
    rate: number;
    byReason: CountMap;
    examplesByReason: Record<string, DrilldownExample[]>;
  };
  retry: {
    attempts: number;
    recovered: number;
    failedAfterRetry: number;
    recoveryRate: number;
  };
  outputTokenProximity: {
    cap: number;
    histogram: {
      lt50: number;
      from50To80: number;
      from80To95: number;
      gte95: number;
      missing: number;
    };
  };
  validatorFieldRejections: {
    total: number;
    byField: Partial<Record<ValidatorFieldName, number>>;
    byFieldAndReason: CountMap;
  };
  personaFailureReasons: Record<string, CountMap>;
};

export function computeCriticalDiagnostics(
  rows: SlimTurnRow[],
  outputTokenCap = DEFAULT_OUTPUT_TOKEN_CAP,
): CriticalDiagnostics {
  let totalRecords = 0;
  let fallbackCount = 0;
  const byReason: CountMap = {};
  const examplesByReason: Record<string, DrilldownExample[]> = {};
  const personaFailureReasons: Record<string, CountMap> = {};
  let retryAttempts = 0;
  let retryRecovered = 0;
  let retryFailed = 0;
  const histogram = {
    lt50: 0,
    from50To80: 0,
    from80To95: 0,
    gte95: 0,
    missing: 0,
  };
  let fieldRejectionTotal = 0;
  const byField: Partial<Record<ValidatorFieldName, number>> = {};
  const byFieldAndReason: CountMap = {};

  for (const turn of rows) {
    for (const record of turn.agentRecords) {
      totalRecords += 1;

      const outputTokens = record.llm.usage?.output_tokens;
      if (typeof outputTokens !== "number" || !Number.isFinite(outputTokens)) {
        histogram.missing += 1;
      } else {
        const proximity = outputTokens / outputTokenCap;
        if (proximity < 0.5) histogram.lt50 += 1;
        else if (proximity < 0.8) histogram.from50To80 += 1;
        else if (proximity < 0.95) histogram.from80To95 += 1;
        else histogram.gte95 += 1;
      }

      if (record.llm.retried === true) {
        retryAttempts += 1;
        if (record.llm.fellBackToSafeDefault) retryFailed += 1;
        else retryRecovered += 1;
      }

      const fieldErrors = record.llm.validatorFieldErrors ?? {};
      for (const [field, reason] of Object.entries(fieldErrors) as Array<
        [ValidatorFieldName, string]
      >) {
        byField[field] = (byField[field] ?? 0) + 1;
        fieldRejectionTotal += 1;
        increment(byFieldAndReason, `${field}: ${reason}`);
      }

      if (!record.llm.fellBackToSafeDefault) continue;

      fallbackCount += 1;
      const reason = failureReasonForRecord(
        record.llm.failureReason,
        Object.keys(fieldErrors).length,
      );
      increment(byReason, reason);
      const examples = examplesByReason[reason] ?? [];
      examplesByReason[reason] = examples;
      pushExample(examples, turn, record);
      const personaCounts = personaFailureReasons[record.personaId] ?? {};
      personaFailureReasons[record.personaId] = personaCounts;
      increment(personaCounts, reason);
    }
  }

  return {
    totalRecords,
    fallback: {
      count: fallbackCount,
      rate: rate(fallbackCount, totalRecords),
      byReason: sortedCountMap(byReason),
      examplesByReason,
    },
    retry: {
      attempts: retryAttempts,
      recovered: retryRecovered,
      failedAfterRetry: retryFailed,
      recoveryRate: rate(retryRecovered, retryAttempts),
    },
    outputTokenProximity: {
      cap: outputTokenCap,
      histogram,
    },
    validatorFieldRejections: {
      total: fieldRejectionTotal,
      byField,
      byFieldAndReason: sortedCountMap(byFieldAndReason),
    },
    personaFailureReasons: Object.fromEntries(
      Object.entries(personaFailureReasons).map(([persona, counts]) => [
        persona,
        sortedCountMap(counts),
      ]),
    ),
  };
}

function failureReasonForRecord(
  failureReason: FailureReason | undefined,
  fieldErrorCount: number,
): FailureBucket {
  if (failureReason !== undefined) return failureReason;
  if (fieldErrorCount > 0) return "field_rejection";
  return "unknown";
}

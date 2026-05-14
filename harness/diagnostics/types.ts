import type {
  FailureReason,
  ParsedDecision,
  PersonaId,
  UseVariant,
} from "../../convex/engine/types.js";

export const DEFAULT_OUTPUT_TOKEN_CAP = 1200;
export const MAX_MATCHES = 20;

export type ValidatorFieldName =
  | "use"
  | "position"
  | "action"
  | "say"
  | "scratchpad";

export type ValidatorFieldErrors = Partial<
  Record<ValidatorFieldName, string>
>;

export type AzureUsageSlim = {
  output_tokens?: number;
  [key: string]: unknown;
};

export type VisibleSummary = {
  enemies: number;
  chests: number;
  corpses: number;
  evacSeen: boolean;
};

export type SelfEquipment = {
  weapon: string | null;
  armour: string | null;
  consumable?: string | null;
};

export type SelfHp = {
  hp: number;
  maxHp: number;
};

export type DamageFeedAudit = {
  incoming: number;
  outgoing: number;
  dealtKills: number;
  expectedIncoming?: number;
  missingIncoming?: number;
  expectedOutgoing?: number;
  missingOutgoing?: number;
  expectedDealtKills?: number;
  missingDealtKills?: number;
  bodyCollisionIncoming?: number;
  bodyCollisionExpectedIncoming?: number;
  bodyCollisionMissingIncoming?: number;
  bodyCollisionOutgoing?: number;
  bodyCollisionExpectedOutgoing?: number;
  bodyCollisionMissingOutgoing?: number;
  chargeDamageFeedDelivered?: number;
  chargeDamageFeedExpected?: number;
  chargeDamageFeedMissing?: number;
};

export type LootOutcomeFeedEntry = {
  result: "opened" | "looted" | "already_opened" | "empty" | "no_corpse" | string;
  item?: string;
  target?: string;
  delivered?: boolean;
};

export type SlimAgentRecord = {
  characterId: string;
  personaId: PersonaId;
  decision: ParsedDecision;
  scratchpadAfter: string;
  scratchpadChanged: boolean;
  visibleSummary: VisibleSummary;
  visibleRectKeys: string[];
  insideBearingHere: boolean;
  observerPos: Tile;
  selfEquipment: SelfEquipment;
  selfHp?: SelfHp;
  damageFeedAudit: DamageFeedAudit;
  inboundSpeechCount: number;
  inboundSpeechExpected?: number;
  inboundSpeechMissing?: number;
  lootOutcomeFeed: LootOutcomeFeedEntry[];
  lootOutcomeExpected?: number;
  lootOutcomeMissing?: number;
  input: {
    systemPromptHash: string;
    personaPromptHash: string;
    useVariant?: UseVariant;
  };
  llm: {
    responseId: string | null;
    callId: string | null;
    usage: AzureUsageSlim | null;
    latencyMs: number;
    httpStatus: number | null;
    fellBackToSafeDefault: boolean;
    failureReason?: FailureReason;
    validatorFieldErrors?: ValidatorFieldErrors;
    retried?: boolean;
  };
};

export type Tile = { x: number; y: number };

export type ResolutionConsumed = {
  characterId: string;
  item: { category: "consumable"; name: string };
};

export type ResolutionSpeech = {
  characterId: string;
  text: string;
  heardBy: string[];
};

export type ResolutionMove = {
  characterId: string;
  from: Tile;
  to: Tile;
  blockedBy?: "wall";
  slide?: {
    wallRectId: string;
    axis: "N" | "E" | "S" | "W";
    intent: string;
  };
  bodyCollision?:
    | { kind: "character"; defenderId: string }
    | { kind: "wall"; wallRectId: string };
};

export type ResolutionAction = {
  characterId: string;
  kind: "attack" | "loot" | "overwatch" | "counter" | string;
  target: string;
  result: string;
  triggeredByMovement?: boolean;
  weapon?: string;
  lootedItem?: string;
};

export type SlimTurnRow = {
  _id: string;
  matchId: string;
  turn: number;
  resolution: {
    consumed: ResolutionConsumed[];
    speech: ResolutionSpeech[];
    moves: ResolutionMove[];
    actions: ResolutionAction[];
    deaths: string[];
    visibilityUpdates: Array<{
      characterId: string;
      hidden: boolean;
      revealedBy?: string;
    }>;
  };
  agentRecords: SlimAgentRecord[];
};

export type SlimMatchRows = SlimTurnRow[];

export type DrilldownExample = {
  matchId: string;
  turn: number;
  characterId: string;
  personaId: PersonaId;
  url: string;
  label: string;
};

export type CountMap = Record<string, number>;

export type DiagnosticsClient = {
  query: (ref: unknown, args: unknown) => Promise<unknown>;
};

export type FetchSlimAcross = (
  client: DiagnosticsClient,
  matchIds: string[],
) => Promise<SlimMatchRows[]>;

export type DiagnosticMatch = {
  _id: string;
  [key: string]: unknown;
};

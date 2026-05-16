import { hashHex } from "./engine/hash.js";

export type PromptKind = "system" | "persona";

type PromptInsert = {
  hash: string;
  kind: PromptKind;
  text: string;
};

type PromptRow = PromptInsert & {
  _id: string;
};

type PromptIndexQuery = {
  eq(field: "hash" | "kind", value: string): PromptIndexQuery;
};

type PromptUniqueQuery = {
  unique(): Promise<PromptRow | null>;
};

type PromptTableQuery = {
  withIndex(
    indexName: "by_hash_kind",
    cb: (q: PromptIndexQuery) => unknown,
  ): PromptUniqueQuery;
};

export type PromptPersistenceContext = {
  db: {
    query(table: "prompts"): unknown;
    insert(table: "prompts", value: PromptInsert): Promise<string>;
  };
};

export class PromptHashCollisionError extends Error {
  constructor(kind: PromptKind, hash: string) {
    super(`Prompt hash collision for ${kind}:${hash}`);
    this.name = "PromptHashCollisionError";
  }
}

export async function getOrCreatePromptByHash(
  ctx: PromptPersistenceContext,
  args: { kind: PromptKind; text: string; hash?: string },
): Promise<{ promptId: string; hash: string }> {
  const hash = args.hash ?? hashHex(args.text);
  const promptQuery = ctx.db.query("prompts") as PromptTableQuery;
  const existing = await promptQuery
    .withIndex("by_hash_kind", (q) =>
      q.eq("hash", hash).eq("kind", args.kind),
    )
    .unique();

  if (existing) {
    if (existing.text !== args.text) {
      throw new PromptHashCollisionError(args.kind, hash);
    }
    return { promptId: existing._id, hash };
  }

  const promptId = await ctx.db.insert("prompts", {
    hash,
    kind: args.kind,
    text: args.text,
  });
  return { promptId, hash };
}

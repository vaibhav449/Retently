import { createHash } from "node:crypto";
import type { Database } from "@repo/db";
import { type BankItem, chunkCount, chunkText, NOTES } from "./bank";
import type { SynthConfig } from "./config";
import { seededUuid } from "./ids";
import type { Student } from "./student";

/** One student's copy of a bank item: the ids of its rows. Pure, so known before it is written. */
export interface OwnedItem {
  bank: BankItem;
  id: string;
  sourceId: string;
  chunkId: string;
  /** MCQ: the option ids in stored order. */
  optionIds: string[];
  answerOptionId: string | null;
  /** MCQ: the wrong option ids, the misconception's first (answer.ts). */
  wrongOptionIds: string[];
}

const noteIds = (student: Student, note: number) => ({
  documentId: seededUuid(student.id, "document", note),
  sourceId: seededUuid(student.id, "source", note),
});

/** The id of the student's copy of note `note`'s source: its topic key is `src:<this>`. */
export function sourceIdOf(student: Student, note: number): string {
  return noteIds(student, note).sourceId;
}

const chunkId = (student: Student, note: number, chunk: number) =>
  seededUuid(student.id, "chunk", note, chunk);

/** The student's copy of the bank: every id a release will write (V7). */
export function ownBank(student: Student, bank: readonly BankItem[]): OwnedItem[] {
  return bank.map((item) => {
    const optionIds = item.options.map((_, k) => seededUuid(student.id, "option", item.index, k));
    const answerAt = item.options.indexOf(item.answer);
    const answerOptionId = answerAt >= 0 ? (optionIds[answerAt] ?? null) : null;
    return {
      bank: item,
      id: seededUuid(student.id, "item", item.index),
      sourceId: sourceIdOf(student, item.note),
      chunkId: chunkId(student, item.note, item.chunk),
      optionIds,
      answerOptionId,
      wrongOptionIds: optionIds.filter((id) => id !== answerOptionId),
    };
  });
}

/** The synthetic user and their revision_settings, created at `at`. */
export async function createStudent(
  db: Database,
  student: Student,
  at: Date,
  cfg: SynthConfig,
): Promise<void> {
  await db.user.create({
    data: {
      id: student.id,
      name: student.name,
      email: student.email,
      emailVerified: false,
      dob: new Date("2004-01-01"),
      createdAt: at,
      updatedAt: at,
    },
  });
  await db.revisionSettings.create({
    data: {
      userId: student.id,
      dailyBudgetSec: student.budgetSec,
      timezone: cfg.timeZone,
      updatedAt: at,
    },
  });
}

/**
 * Note `note` as the student writes it at `at`: a document with TipTap JSON and Markdown, its
 * source, and one chunk per few facts, each chunk citing its paragraph's block id, as the editor
 * and ingestion leave them (citations, readable-by checks and the ranker see a normal note).
 */
async function writeNote(
  db: Database,
  student: Student,
  note: number,
  at: Date,
  cfg: SynthConfig,
): Promise<void> {
  const template = NOTES[note];
  if (template === undefined) throw new Error(`no note ${note}`);
  const { documentId, sourceId } = noteIds(student, note);
  const chunks = Array.from({ length: chunkCount(note, cfg) }, (_, c) => ({
    id: chunkId(student, note, c),
    blockId: seededUuid(student.id, "block", note, c),
    text: chunkText(note, c, cfg),
  }));
  const titleBlock = seededUuid(student.id, "block", note, "title");

  await db.document.create({
    data: {
      id: documentId,
      ownerId: student.id,
      title: template.title,
      contentJson: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { id: titleBlock, level: 2 },
            content: [{ type: "text", text: template.title }],
          },
          ...chunks.map((chunk) => ({
            type: "paragraph",
            attrs: { id: chunk.blockId },
            content: [{ type: "text", text: chunk.text }],
          })),
        ],
      },
      contentMd: [`## ${template.title}`, ...chunks.map((chunk) => chunk.text)].join("\n\n"),
      version: 1,
      createdAt: at,
      updatedAt: at,
    },
  });
  await db.source.create({
    data: {
      id: sourceId,
      ownerId: student.id,
      kind: "note",
      documentId,
      title: template.title,
      createdAt: at,
    },
  });
  await db.chunk.createMany({
    data: chunks.map((chunk) => ({
      id: chunk.id,
      sourceId,
      blockIds: [chunk.blockId],
      text: chunk.text,
      contentHash: createHash("sha256").update(chunk.text).digest("hex"),
      createdAt: at,
    })),
  });
}

/**
 * A release (REQ §3): the items whose release day is `day` appear at `at`, with created_at = at;
 * a note is written when its first item appears. `written` holds the notes written so far and is
 * updated. Returns the items released. Nothing from a later day is ever inserted early, so the
 * ranker only sees what the student could have seen.
 */
export async function release(
  db: Database,
  student: Student,
  owned: readonly OwnedItem[],
  day: number | "end",
  at: Date,
  written: Set<number>,
  cfg: SynthConfig,
): Promise<OwnedItem[]> {
  const items = owned.filter((item) => item.bank.releaseDay === day);
  for (const note of [...new Set(items.map((item) => item.bank.note))].sort((a, b) => a - b)) {
    if (written.has(note)) continue;
    await writeNote(db, student, note, at, cfg);
    written.add(note);
  }
  if (items.length === 0) return [];
  await db.item.createMany({
    data: items.map((item) => ({
      id: item.id,
      sourceChunkId: item.chunkId,
      type: item.bank.type,
      prompt: item.bank.prompt,
      answer: item.bank.answer,
      options: item.bank.options.map((text, k) => ({ id: item.optionIds[k] as string, text })),
      answerOptionId: item.answerOptionId,
      rubric:
        item.bank.type === "short_answer" ? `Accept “${item.bank.answer}” or the same.` : null,
      createdAt: at,
    })),
  });
  return items;
}

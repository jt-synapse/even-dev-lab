import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { CopilotTurnResult } from "../domain/copilot.ts";

export interface TypedSessionSnapshot {
  readonly sessionId: string;
  readonly problemId: string;
  readonly turns: readonly CopilotTurnResult[];
}

export interface TypedSessionStore {
  readActive(): TypedSessionSnapshot;
  findTurn(turnId: string): CopilotTurnResult | null;
  append(snapshot: TypedSessionSnapshot, turn: CopilotTurnResult): void;
  startNew(): TypedSessionSnapshot;
  close(): void;
}

export class TypedSessionConflictError extends Error {
  constructor() {
    super(
      "The active problem changed while answering. Please retry your question.",
    );
  }
}

// Each session currently contains one problem. The last session created is active.
const activeSessionSql =
  "SELECT session_id, problem_id FROM typed_sessions ORDER BY session_seq DESC LIMIT 1";

function insertSession(db: DatabaseSync): TypedSessionSnapshot {
  const sessionId = randomUUID();
  const problemId = randomUUID();
  db.prepare(
    "INSERT INTO typed_sessions (session_id, problem_id) VALUES (?, ?)",
  ).run(sessionId, problemId);
  return { sessionId, problemId, turns: [] };
}

export function createTypedSessionStore(filePath: string): TypedSessionStore {
  let connection: DatabaseSync | undefined;

  function database(): DatabaseSync {
    if (connection) return connection;
    if (filePath !== ":memory:") {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
      // Create the file with private permissions before SQLite opens it.
      closeSync(openSync(filePath, "a", 0o600));
    }
    const db = new DatabaseSync(filePath, { timeout: 2000 });
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS typed_sessions (
          session_seq INTEGER PRIMARY KEY,
          session_id TEXT NOT NULL UNIQUE,
          problem_id TEXT NOT NULL UNIQUE
        );
        CREATE TABLE IF NOT EXISTS typed_turns (
          turn_id TEXT NOT NULL PRIMARY KEY,
          problem_id TEXT NOT NULL REFERENCES typed_sessions(problem_id),
          ordinal INTEGER NOT NULL,
          result TEXT NOT NULL,
          UNIQUE (problem_id, ordinal)
        );
      `);
    } catch (error) {
      db.close();
      throw error;
    }
    connection = db;
    return db;
  }

  return {
    readActive() {
      const db = database();
      // Select or create the first session and read its history as one snapshot.
      db.exec("BEGIN IMMEDIATE");
      try {
        const row = db.prepare(activeSessionSql).get();
        let snapshot: TypedSessionSnapshot;
        if (row) {
          const problemId = String(row.problem_id);
          const rows = db
            .prepare(
              "SELECT result FROM typed_turns WHERE problem_id = ? ORDER BY ordinal",
            )
            .all(problemId);
          snapshot = {
            sessionId: String(row.session_id),
            problemId,
            turns: rows.map(
              (entry) => JSON.parse(String(entry.result)) as CopilotTurnResult,
            ),
          };
        } else {
          snapshot = insertSession(db);
        }
        db.exec("COMMIT");
        return snapshot;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },

    findTurn(turnId) {
      const row = database()
        .prepare("SELECT result FROM typed_turns WHERE turn_id = ?")
        .get(turnId);
      return row ? (JSON.parse(String(row.result)) as CopilotTurnResult) : null;
    },

    append(snapshot, turn) {
      // The condition and insert are atomic even when dev and preview share the store.
      const { changes } = database()
        .prepare(
          `
        INSERT INTO typed_turns (turn_id, problem_id, ordinal, result)
        SELECT ?, problem_id, ?, ? FROM (${activeSessionSql}) AS active
        WHERE session_id = ? AND problem_id = ?
          AND (SELECT COUNT(*) FROM typed_turns WHERE problem_id = active.problem_id) = ?
      `,
        )
        .run(
          turn.turnId,
          snapshot.turns.length + 1,
          JSON.stringify(turn),
          snapshot.sessionId,
          snapshot.problemId,
          snapshot.turns.length,
        );
      if (changes === 0) throw new TypedSessionConflictError();
    },

    startNew() {
      return insertSession(database());
    },

    close() {
      connection?.close();
      connection = undefined;
    },
  };
}

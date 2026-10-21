import type { TestContext } from 'node:test';
import type { CompiledQuery, QueryResult } from 'kysely';
import { getDb } from '../../lib/db';

export interface QueryLog {
  /** The SQL of every statement sent through the pool, in the order they started. */
  statements: string[];
  /**
   * The longest chain of statements that ran one after another: a statement that starts after
   * others finished counts one more than the longest of those. Statements started together
   * share a step, however long each of them takes.
   */
  roundTrips: number;
  /** Starts counting from zero, e.g. after the test data was written. */
  reset(): void;
}

/**
 * Records the statements of the shared pool (not those of transactions), to check that a read
 * sends only what it needs and runs independent statements together.
 */
export function recordQueries(t: TestContext): QueryLog {
  const executor = getDb().getExecutor();
  const original = executor.executeQuery.bind(executor);
  let finished = 0;
  const log: QueryLog = {
    statements: [],
    roundTrips: 0,
    reset() {
      log.statements = [];
      log.roundTrips = 0;
      finished = 0;
    },
  };
  t.mock.method(
    executor,
    'executeQuery',
    async <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
      log.statements.push(query.sql);
      const step = finished + 1;
      log.roundTrips = Math.max(log.roundTrips, step);
      try {
        return await original<R>(query);
      } finally {
        finished = Math.max(finished, step);
      }
    }
  );
  return log;
}

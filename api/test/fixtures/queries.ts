import type { TestContext } from 'node:test';
import type { CompiledQuery, QueryResult } from 'kysely';
import { getDb } from '../../lib/db';

export interface QueryLog {
  /** The SQL of every statement sent through the pool, in the order they started. */
  statements: string[];
  /**
   * How many statements had to wait for an earlier one: a statement that starts while none is
   * running begins a new round trip, one that starts while others run shares theirs.
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
  let running = 0;
  const log: QueryLog = {
    statements: [],
    roundTrips: 0,
    reset() {
      log.statements = [];
      log.roundTrips = 0;
    },
  };
  t.mock.method(
    executor,
    'executeQuery',
    async <R>(query: CompiledQuery): Promise<QueryResult<R>> => {
      log.statements.push(query.sql);
      if (running === 0) log.roundTrips++;
      running++;
      try {
        return await original<R>(query);
      } finally {
        running--;
      }
    }
  );
  return log;
}

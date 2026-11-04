import type { Generated } from 'kysely';
export interface StaffUsageTable {
  month: string;
  module: string;
  visits: Generated<number>;
}

import type { StaffProtokoll } from './types';
export interface ProtokollSending {
  protokoll: StaffProtokoll;
  recipients: number;
  version: string;
  retry: boolean;
}

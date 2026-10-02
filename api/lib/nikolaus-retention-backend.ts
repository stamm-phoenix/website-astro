import { EnvironmentVariable, getEnvironment } from './environment';
import { listNikolausStates, serializeNikolausState } from './nikolaus-state';
import { retentionDigest } from './nikolaus-retention';
import type { RetentionBackend, RetentionList } from './nikolaus-retention';
import {
  deleteSharePointListItem,
  getSharePointListItems,
  updateSharePointListItem,
} from './sharepoint-data-access';

export interface ConfiguredRetentionBackend {
  targetDigest: string;
  backend: RetentionBackend;
}

/** Uses the same operator configuration as the deployed API, without exporting credentials. */
export function createNikolausRetentionBackend(): ConfiguredRetentionBackend {
  const ids: Record<RetentionList, string> = {
    booking: getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_LIST_ID),
    dispo: getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_DISPO_LIST_ID),
    helper: getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_HELFENDE_LIST_ID),
    einteilung: getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_EINTEILUNG_LIST_ID),
  };
  const stateListId = getEnvironment(EnvironmentVariable.SHAREPOINT_NIKOLAUS_STATE_LIST_ID);
  const targetDigest = retentionDigest({
    host: getEnvironment(EnvironmentVariable.SHAREPOINT_HOST_NAME),
    site: getEnvironment(EnvironmentVariable.SHAREPOINT_SITE_ID),
    ids,
    stateListId,
  });
  return {
    targetDigest,
    backend: {
      load: async () => {
        const [booking, dispo, helper, einteilung, states] = await Promise.all([
          getSharePointListItems(ids.booking, { expand: 'fields' }),
          getSharePointListItems(ids.dispo, { expand: 'fields' }),
          getSharePointListItems(ids.helper, { expand: 'fields' }),
          getSharePointListItems(ids.einteilung, { expand: 'fields' }),
          listNikolausStates(''),
        ]);
        return { booking, dispo, helper, einteilung, states };
      },
      delete: async (operation) => {
        const id =
          operation.kind === 'state-delete' ? stateListId : ids[operation.kind as RetentionList];
        if (!id) throw new Error('Invalid retention operation');
        await deleteSharePointListItem(id, operation.id, operation.etag);
      },
      updateState: async (operation, data) => {
        await updateSharePointListItem(
          stateListId,
          operation.id,
          { State: serializeNikolausState(data) },
          operation.etag
        );
      },
    },
  };
}

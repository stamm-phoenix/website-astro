export interface ProtokollMigrationFailure {
  scope: 'protocol-migration';
  failed: true;
  reason: string;
}

/** Never expose SDK messages, names, URLs, workflow values or tokens to operator logs. */
export function protokollMigrationFailure(error: unknown): ProtokollMigrationFailure {
  return { scope: 'protocol-migration', failed: true, reason: safeReason(error) };
}

function safeReason(error: unknown): string {
  if (!(error instanceof Error)) return 'UNKNOWN_FAILURE';
  if (error.message.startsWith('Usage:')) return 'INVALID_ARGUMENTS';
  const known = [
    'SQL_GATE_DEPLOYMENT_REQUIRED',
    'IMPORT_REQUIRES_INITIAL_FREEZE',
    'SQL_CHANGED_SINCE_IMPORT',
    'ACTIVATION_REQUIRES_FREEZE',
    'RESTORE_REQUIRES_SQL_FREEZE',
    'RESTORE_FILE_MISSING',
    'RESTORE_SOURCE_CHANGED',
    'RESTORE_SOURCE_VERSION_MISSING',
    'RESTORE_VERIFICATION_FAILED',
  ];
  if (known.includes(error.message)) return error.message;
  if (error.message.startsWith('Source metadata changed'))
    return 'SOURCE_CHANGED_REIMPORT_WHILE_FROZEN';
  if (error.message === 'Source changed while importing') return 'SOURCE_CHANGED_RETRY_IMPORT';
  if (error.message === 'Protocol import not complete') return 'IMPORT_REQUIRED';
  if (error.message === 'Unexpected protocol column type') return 'INVALID_SOURCE_COLUMN_TYPE';
  if (error.message === 'Lock protokoll-cutover not granted')
    return 'CUTOVER_BUSY_RETRY_AFTER_ACTIVE_REQUESTS';
  if (error.message === 'Protocol library missing') return 'PROTOCOL_LIBRARY_MISSING';
  return 'ACCESS_OR_OPERATION_FAILED_CHECK_GRAPH_AND_SQL';
}

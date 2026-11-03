interface AktionSaveFeedback {
  label: string;
  failure: string;
}

/** The retry instruction names the same action as the dialog's submit button. */
export function aktionSaveFeedback(hasEntry: boolean, hasEvent: boolean): AktionSaveFeedback {
  const label = hasEntry ? 'Speichern' : hasEvent ? 'Veröffentlichen' : 'Aktion anlegen';
  const result = hasEntry ? 'gespeichert' : hasEvent ? 'veröffentlicht' : 'angelegt';
  return {
    label,
    failure: `Die Aktion wurde nicht ${result}. Deine Eingaben sind noch da. Tippe noch einmal auf „${label}“.`,
  };
}

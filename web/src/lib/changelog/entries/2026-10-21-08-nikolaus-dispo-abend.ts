import type { ChangelogEntry } from '../../changelog';

const entry: ChangelogEntry = {
  id: '2026-10-21-08-nikolaus-dispo-abend',
  date: '2026-10-21',
  title: 'Die Dispo am Besuchsabend umplanen',
  changes: [
    {
      text: 'Abgehakte Besuche bleiben in der Dispo bei ihrem Team und stehen am Anfang der Tour. Auch „Neu berechnen“ verschiebt sie nicht mehr.',
      href: '/leitendenbereich/nikolaus-dispo',
    },
    'Gibst du am Abend einen Termin einem anderen Team, kommt er hinter die Besuche, die dieses Team schon abgehakt hat. Die Zeiten der übrigen Termine rechnet die Dispo ab dem letzten Abhaken, also mit der echten Verspätung.',
    'Hat ein Team einen Besuch abgehakt, nachdem du die Dispo geöffnet hast, speichert die Dispo deine Änderungen nicht. Sie sagt dir dann, dass du neu laden sollst.',
  ],
};

export default entry;

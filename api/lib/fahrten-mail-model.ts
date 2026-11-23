/** Who got a mail, who has no address in CampFlow and whose mail failed, by name. */
export interface FahrtenMailErgebnis {
  gesendet: string[];
  ohneAdresse: string[];
  /** Drivers whose mail did not go out, so the browser can send theirs again. */
  fehlgeschlagen: { id: string; name: string }[];
  /** In a PR preview nothing is sent; `gesendet` names who would have got a mail. */
  vorschau: boolean;
}

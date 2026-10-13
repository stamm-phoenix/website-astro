export interface SharePointSiteUser {
  name: string;
  /** Membership claim UPN, matching the Entra staff login. */
  login: string;
}

export interface ClientPrincipalClaim {
  typ: string;
  val: string;
}

/** User information that Static Web Apps passes to the API after a login. */
export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
  claims?: ClientPrincipalClaim[];
}

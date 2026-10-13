/** Browser-safe directory identity; account addresses never enter the model candidate list. */
export interface TaskDirectoryUser {
  name: string;
  login: string;
  givenName: string;
}

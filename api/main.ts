import { app } from "@azure/functions";
import "isomorphic-fetch";

import { GetTeams } from "./GetTeams";

app.http("teams", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetTeams,
});

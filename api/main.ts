import { app } from "@azure/functions";

import { GetTeams } from "./GetTeams";

app.http("teams", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetTeams,
});

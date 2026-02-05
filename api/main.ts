import { app } from "@azure/functions";

import { GetTeams } from "./endpoints/teams";
import { GetImage } from "./GetImage";

app.http("teams", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetTeams,
});

// app.http("image", {
//   methods: ["GET"],
//   authLevel: "anonymous",
//   route: "image/{id}",
//   handler: GetImage,
// });

import { app } from "@azure/functions";
import GetGruppenstundenEndpoint from "./endpoints/gruppenstunden";
import GetVorstandEndpoint from "./endpoints/vorstand";
import GetLeitendeEndpoint from "./endpoints/leitende";
import {GetImage} from "./endpoints/image";

app.http("gruppenstunden", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetGruppenstundenEndpoint,
});

app.http("vorstand", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetVorstandEndpoint,
});

app.http("leitende", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetLeitendeEndpoint,
});

app.http("image", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "leitende/{id}/image",
  handler: GetImage,
});

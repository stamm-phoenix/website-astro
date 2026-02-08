import { app } from "@azure/functions";
import GetGruppenstundenEndpoint from "./endpoints/gruppenstunden";
import GetVorstandEndpoint from "./endpoints/vorstand";
import GetLeitendeEndpoint from "./endpoints/leitende";
import {GetLeitendeImage, GetBlogImage} from "./endpoints/image";
import GetAktionenEndpoint from "./endpoints/aktionen";
import GetAktionenIcsEndpoint from "./endpoints/aktionen-ics";
import GetLeitendeIcsEndpoint from "./endpoints/leitende-ics";
import GetBlogEndpoint from "./endpoints/blog";

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

app.http("aktionen", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetAktionenEndpoint,
});

app.http("aktionenIcs", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "aktionen.ics",
  handler: GetAktionenIcsEndpoint,
});

app.http("leitendeIcs", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "leitende.ics",
  handler: GetLeitendeIcsEndpoint,
});

app.http("image", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "leitende/{id}/image",
  handler: GetLeitendeImage,
});

app.http("blogImage", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "blog/{id}/image",
  handler: GetBlogImage,
});

app.http("blog", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: GetBlogEndpoint,
});

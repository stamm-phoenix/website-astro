import {
  HttpRequest,
  InvocationContext,
  HttpResponseInit,
} from "@azure/functions";
import { getTeamMembers } from "../lib/teammembers";

export async function GetTeams(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const teamMembers = await getTeamMembers();
    return {
      status: 200,
      jsonBody: teamMembers,
    };
  } catch (error) {
    context.error(error);
    return { status: 500, body: "Internal Server Error" };
  }
}

export default GetTeams;

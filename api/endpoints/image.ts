import {
  HttpRequest,
  InvocationContext,
  HttpResponseInit,
} from "@azure/functions";
import { getTeamMembers } from "../lib/teammembers";

export async function GetImage(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const itemId = request.params.id;
    if (!itemId) {
      return {
        status: 400,
        body: "No item ID provided",
      };
    }

    const teamMembers = await getTeamMembers();

    const teamMember = teamMembers.find((member) => member.id === itemId);

    //     const url = new URL(env.SHAREPOINT_BASE_URL);
    //     const hostNameForToken = url.hostname;

    //     const token = await credential.getToken(`https://${hostNameForToken}/.default`);
    //     if (!token) {
    //       throw new Error("Failed to acquire access token from credential.getToken");
    //     }

    //     const apiUrl = `${env.SHAREPOINT_BASE_URL}/_api/v2.1/sites('${env.SHAREPOINT_SITE_ID}')/lists('${env.SHAREPOINT_LEITUNGSTEAMS_LIST_ID}')/items('${itemId}')/attachments('${encodeURIComponent(
    //       fileName,
    //     )}')/thumbnails/0/c400x400/content?prefer=noredirect,closestavailablesize`;

    //     context.log(`Calling SharePoint API URL: ${apiUrl}`);

    //     const response = await fetch(apiUrl, {
    //       method: "GET",
    //       headers: {
    //         Authorization: `Bearer ${token.token}`,
    //         Accept: "application/json;odata=verbose",
    //       },
    //     });

    //     if (!response.ok) {
    //       throw new Error(
    //         `SharePoint API Error: ${response.status} ${response.statusText}`,
    //       );
    //     }

    //     const arrayBuffer = await response.arrayBuffer();
    //     const contentType = getMimeType(fileName);

    //     return {
    //       status: 200,
    //       body: Buffer.from(arrayBuffer),
    //       headers: {
    //         "Content-Type": contentType,
    //         "Cache-Control": "public, max-age=86400",
    //       },
    //     };

    return {
      status: 200,
      jsonBody: teamMember,
    };
  } catch (error) {
    context.error(error);
    return { status: 500, body: "Internal Server Error" };
  }
}

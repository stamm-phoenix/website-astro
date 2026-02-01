import type {
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { getEnvironment } from "../lib/environment";

export async function GetImage(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const env = getEnvironment(context);

  if (!env) {
    return {
      status: 500,
      body: "Missing environment variables",
    };
  }

  const fileName = request.params.fileName;

  return {
    status: 200,
    jsonBody: {
      fileName: fileName,
    },
  };
}

export default GetImage;

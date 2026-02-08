import {
  HttpRequest,
  InvocationContext,
  HttpResponseInit,
} from "@azure/functions";
import {getLeitende} from "../lib/leitende-list";
import {getGruppenstunden} from "../lib/gruppenstunden-list";

interface LeitendeData {
  id: string;
  name: string;
  hasImage: boolean;
}

interface GruppenstundenData {
  id: string;
  stufe: string;
  weekday: string;
  time: string;
  location: string;
  ageRange: string;
  description: string;
  leitende: LeitendeData[]
}

export async function GetGruppenstundenEndpoint(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  try {
    const [leitende, gruppenstunden] = await Promise.all([
      getLeitende(),
      getGruppenstunden(),
    ]);
    
    const stufeToLeitende = new Map<string, LeitendeData[]>();
    for (const l of leitende) {
      const data: LeitendeData = {
        id: l.id,
        name: l.name,
        hasImage: l.hasImage,
      };
      for (const team of l.teams) {
        const list = stufeToLeitende.get(team) || [];
        list.push(data);
        stufeToLeitende.set(team, list);
      }
    }

    const data: GruppenstundenData[] = gruppenstunden.map(g => {
      return {
        id: g.id,
        time: g.time,
        stufe: g.stufe,
        description: g.description,
        ageRange: g.ageRange,
        weekday: g.weekday,
        location: g.location,
        leitende: stufeToLeitende.get(g.stufe) ?? []
      }
    })

    return {
      status: 200,
      jsonBody: data,
    };
  } catch (error: any) {
    context.error(error);
    return {
      status: 500,
      jsonBody: {
        error: error.name || "Error",
        message: error.message || "Internal Server Error",
        // stack: error.stack,
      },
    };
  }
}

export default GetGruppenstundenEndpoint;

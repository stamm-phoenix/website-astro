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
    const leitende = await getLeitende();
    const gruppenstunden = await getGruppenstunden();
    
    const data: GruppenstundenData[] = gruppenstunden.map(gruppenstunde => {
      const leitendeOfGruppenstunde = leitende
          .filter(l => l.teams.includes(gruppenstunde.stufe))
          .map((l): LeitendeData => {
            return {
              id: l.id,
              name: l.name,
              hasImage: l.hasImage
            }
          })

      return {
        id: gruppenstunde.id,
        time: gruppenstunde.time,
        stufe: gruppenstunde.stufe,
        description: gruppenstunde.description,
        ageRange: gruppenstunde.ageRange,
        weekday: gruppenstunde.weekday,
        location: gruppenstunde.location,
        leitende: leitendeOfGruppenstunde
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

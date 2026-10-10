import { getCredential } from './token';

/**
 * Requests to a model deployment on Azure OpenAI with structured outputs (strict JSON schema),
 * shared by the receipt check (`beleg-check.ts`) and the date detection of the minutes
 * (`protokoll-termin.ts`). With `AZURE_OPENAI_API_KEY` the key is used, otherwise the app
 * registration (Entra ID). See docs/belege-ki-pruefung.md for the setup.
 */

export interface AzureOpenAiDeployment {
  /** `https://<resource>.openai.azure.com`, without a trailing slash. */
  endpoint: string;
  deployment: string;
}

export class AzureOpenAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AzureOpenAiError';
  }
}

export interface StructuredRequest {
  /** Name of the schema, sent to the model. */
  schemaName: string;
  schema: Record<string, unknown>;
  messages: { role: 'system' | 'user'; content: unknown }[];
  maxCompletionTokens: number;
  timeoutMs: number;
}

/** Whether both endpoint and deployment are set; empty values switch the feature off. */
export function isDeploymentConfigured(deployment: AzureOpenAiDeployment): boolean {
  return deployment.endpoint !== '' && deployment.deployment !== '';
}

/**
 * A counter of calls per day and Functions instance, as a safety net against runaway costs;
 * the hard limit is the deployment's quota. The returned function counts one call and returns
 * false, without counting, once `limit()` calls were made on the current (UTC) day.
 */
export function dailyLimit(limit: () => number): (now?: Date) => boolean {
  const usage = { day: '', count: 0 };
  return (now = new Date()) => {
    const day = now.toISOString().slice(0, 10);
    if (usage.day !== day) {
      usage.day = day;
      usage.count = 0;
    }
    if (usage.count >= limit()) return false;
    usage.count++;
    return true;
  };
}

async function authHeaders(): Promise<Record<string, string>> {
  const apiKey = process.env.AZURE_OPENAI_API_KEY?.trim();
  if (apiKey) return { 'api-key': apiKey };
  const token = await getCredential().getToken('https://cognitiveservices.azure.com/.default');
  if (!token) throw new AzureOpenAiError('Failed to acquire Azure OpenAI access token');
  return { Authorization: `Bearer ${token.token}` };
}

/**
 * Sends a chat completion and returns the parsed JSON answer, unchecked. Errors carry only the
 * HTTP status, never the prompt or the answer, so they can be logged.
 */
export async function requestStructuredOutput(
  deployment: AzureOpenAiDeployment,
  request: StructuredRequest
): Promise<unknown> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new AzureOpenAiError('Azure OpenAI request timed out'));
    }, request.timeoutMs);
  });
  try {
    return await Promise.race([
      performStructuredRequest(deployment, request, controller.signal),
      deadline,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function performStructuredRequest(
  deployment: AzureOpenAiDeployment,
  request: StructuredRequest,
  signal: AbortSignal
): Promise<unknown> {
  let response: Response;
  try {
    const headers = await authHeaders();
    if (signal.aborted) throw new AzureOpenAiError('Azure OpenAI request timed out');
    response = await fetch(`${deployment.endpoint}/openai/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      signal,
      body: JSON.stringify({
        model: deployment.deployment,
        temperature: 0,
        max_completion_tokens: request.maxCompletionTokens,
        response_format: {
          type: 'json_schema',
          json_schema: { name: request.schemaName, strict: true, schema: request.schema },
        },
        messages: request.messages,
      }),
    });
  } catch (error: unknown) {
    if (error instanceof AzureOpenAiError) throw error;
    throw new AzureOpenAiError(
      signal.aborted ? 'Azure OpenAI request timed out' : 'Azure OpenAI unreachable'
    );
  }
  // 429: the quota of the deployment is used up
  if (!response.ok) {
    throw new AzureOpenAiError(`Azure OpenAI request failed: ${response.status}`);
  }
  let content: unknown;
  try {
    const body = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    content = body.choices?.[0]?.message?.content;
  } catch {
    throw new AzureOpenAiError('Unreadable answer of Azure OpenAI');
  }
  if (typeof content !== 'string') throw new AzureOpenAiError('Empty answer of the model');
  try {
    return JSON.parse(content) as unknown;
  } catch {
    // The message of a SyntaxError quotes the answer; keep it out of the logs
    throw new AzureOpenAiError('The answer of the model is no JSON');
  }
}

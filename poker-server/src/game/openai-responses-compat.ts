type CompatibleFetch = (
  input: URL | RequestInfo,
  init?: RequestInit,
) => Promise<Response>;

function normalizeOutputTextAnnotations(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeOutputTextAnnotations);
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  const record = value as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(record)) {
    normalized[key] = normalizeOutputTextAnnotations(child);
  }

  if (record.type === 'output_text') {
    if (!('annotations' in record)) {
      normalized.annotations = [];
    }
    if (!('text' in record)) {
      normalized.text = '';
    }
  }

  return normalized;
}

function normalizeResponsesJsonBody(body: string): string {
  try {
    return JSON.stringify(normalizeOutputTextAnnotations(JSON.parse(body)));
  } catch {
    return body;
  }
}

function normalizeResponsesEventStreamLine(line: string): string {
  if (!line.startsWith('data:')) {
    return line;
  }

  const payload = line.slice(5).trim();
  if (payload.length === 0 || payload === '[DONE]') {
    return line;
  }

  const normalized = normalizeResponsesJsonBody(payload);
  return normalized === payload ? line : `data: ${normalized}`;
}

function isResponsesItemReference(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === 'item_reference'
  );
}

function normalizeResponsesRequestBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (!Array.isArray(parsed.input)) {
      return body;
    }

    const normalizedInput = parsed.input.filter(
      (entry) => !isResponsesItemReference(entry),
    );
    if (normalizedInput.length === parsed.input.length) {
      return body;
    }

    return JSON.stringify({
      ...parsed,
      input: normalizedInput,
    });
  } catch {
    return body;
  }
}

function createResponsesEventStreamTransform(): TransformStream<string, string> {
  let buffer = '';

  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        controller.enqueue(`${normalizeResponsesEventStreamLine(line)}\n`);
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        controller.enqueue(normalizeResponsesEventStreamLine(buffer));
      }
    },
  });
}

export function isVolcengineResponsesBaseUrl(baseURL: string): boolean {
  try {
    return new URL(baseURL).hostname.endsWith('volces.com');
  } catch {
    return false;
  }
}

export function createVolcengineResponsesCompatFetch(
  fetchImpl: CompatibleFetch = globalThis.fetch,
): CompatibleFetch {
  return async (input, init) => {
    const normalizedInit =
      init?.body && typeof init.body === 'string'
        ? {
            ...init,
            body: normalizeResponsesRequestBody(init.body),
          }
        : init;

    const response = await fetchImpl(input, normalizedInit);

    if (!response.ok || response.body === null) {
      return response;
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/event-stream')) {
      return new Response(
        response.body
          .pipeThrough(new TextDecoderStream())
          .pipeThrough(createResponsesEventStreamTransform())
          .pipeThrough(new TextEncoderStream()),
        {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        },
      );
    }

    const normalizedBody = normalizeResponsesJsonBody(await response.text());

    return new Response(normalizedBody, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

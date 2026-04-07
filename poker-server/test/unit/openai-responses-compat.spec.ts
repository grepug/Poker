import {
  createVolcengineResponsesCompatFetch,
  isVolcengineResponsesBaseUrl,
} from '../../src/game/openai-responses-compat';

describe('openai responses compat', () => {
  it('detects Volcengine base URLs', () => {
    expect(
      isVolcengineResponsesBaseUrl(
        'https://ark.cn-beijing.volces.com/api/v3',
      ),
    ).toBe(true);
    expect(isVolcengineResponsesBaseUrl('https://api.openai.com/v1')).toBe(
      false,
    );
  });

  it('normalizes missing output_text fields in json responses', async () => {
    const compatFetch = createVolcengineResponsesCompatFetch(async () =>
      new Response(
        JSON.stringify({
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text' }],
            },
          ],
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    const response = await compatFetch('https://example.com/responses', {
      method: 'POST',
      body: JSON.stringify({ input: [] }),
    });
    const payload = await response.json();

    expect(payload.output[0].content[0]).toEqual({
      type: 'output_text',
      annotations: [],
      text: '',
    });
  });

  it('normalizes missing output_text fields in event streams', async () => {
    const compatFetch = createVolcengineResponsesCompatFetch(async () =>
      new Response(
        'data: {"output":[{"type":"message","content":[{"type":"output_text"}]}]}\n\n',
        {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        },
      ),
    );

    const response = await compatFetch('https://example.com/responses', {
      method: 'POST',
      body: JSON.stringify({ input: [] }),
    });
    const body = await response.text();

    expect(body).toContain('"annotations":[]');
    expect(body).toContain('"text":""');
  });

  it('removes item_reference inputs from request bodies', async () => {
    let capturedBody = '';
    const compatFetch = createVolcengineResponsesCompatFetch(
      async (_input, init) => {
        capturedBody = String(init?.body ?? '');
        return new Response('{}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    );

    await compatFetch('https://example.com/responses', {
      method: 'POST',
      body: JSON.stringify({
        input: [
          { type: 'message', role: 'user', content: 'hello' },
          { type: 'item_reference', id: 'item_123' },
        ],
      }),
    });

    expect(JSON.parse(capturedBody)).toEqual({
      input: [{ type: 'message', role: 'user', content: 'hello' }],
    });
  });
});

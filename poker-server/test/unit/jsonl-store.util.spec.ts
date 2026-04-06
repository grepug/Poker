import { parseJsonlRecords } from '../../src/storage/jsonl-store.util';

describe('jsonl-store.util', () => {
  it('ignores an incomplete trailing JSONL line while preserving committed records', () => {
    const records = parseJsonlRecords<{ seq: number }>(
      [
        JSON.stringify({ seq: 1 }),
        JSON.stringify({ seq: 2 }),
        '{"seq":',
      ].join('\n'),
    );

    expect(records).toEqual([{ seq: 1 }, { seq: 2 }]);
  });

  it('throws when corruption appears before the trailing line', () => {
    expect(() =>
      parseJsonlRecords<{ seq: number }>(
        [
          JSON.stringify({ seq: 1 }),
          '{"seq":',
          JSON.stringify({ seq: 2 }),
        ].join('\n'),
      ),
    ).toThrow();
  });
});

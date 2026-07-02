import { formatQueryResultForMcp, truncateText } from '../queryResultFormatter.js';

describe('queryResultFormatter', () => {
  it('limits Redash query result rows and records metadata', () => {
    const result = {
      id: 1,
      data: {
        columns: [{ name: 'id', type: 'integer' }],
        rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      },
    };

    const formatted = JSON.parse(formatQueryResultForMcp(result, { maxRows: 2, maxChars: 10_000 }));

    expect(formatted.data.rows).toEqual([{ id: 1 }, { id: 2 }]);
    expect(formatted.mcp_result_limit).toEqual({
      rowCount: 3,
      returnedRows: 2,
      truncatedRows: true,
      maxRows: 2,
      maxChars: 10_000,
    });
  });

  it('reduces returned rows to stay under the character limit', () => {
    const result = {
      id: 1,
      data: {
        columns: [{ name: 'payload', type: 'string' }],
        rows: Array.from({ length: 20 }, (_, i) => ({ payload: `${i}-${'x'.repeat(100)}` })),
      },
    };

    const text = formatQueryResultForMcp(result, { maxRows: 20, maxChars: 900 });
    const formatted = JSON.parse(text);

    expect(text.length).toBeLessThanOrEqual(900);
    expect(formatted.data.rows.length).toBeLessThan(20);
    expect(formatted.mcp_result_limit.truncatedRows).toBe(true);
  });

  it('truncates plain text output with a clear marker', () => {
    const text = truncateText('a'.repeat(200), 120);

    expect(text.length).toBeLessThanOrEqual(120);
    expect(text).toContain('[Output truncated by Redash MCP');
    expect(text.startsWith('aaaaaaaaaa')).toBe(true);
  });
});

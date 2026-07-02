export const DEFAULT_MAX_RESULT_ROWS = 1000;
export const DEFAULT_MAX_RESULT_CHARS = 500_000;

type RedashLikeResult = {
  data: {
    columns?: unknown[];
    rows: Record<string, unknown>[];
  };
  [key: string]: unknown;
};

type FormatOptions = {
  maxRows?: number;
  maxChars?: number;
};

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

export function resultLimitOptionsFromEnv(): Required<FormatOptions> {
  return {
    maxRows: positiveInt(process.env.REDASH_MAX_RESULTS, DEFAULT_MAX_RESULT_ROWS),
    maxChars: positiveInt(process.env.REDASH_MAX_RESULT_CHARS, DEFAULT_MAX_RESULT_CHARS),
  };
}

function isRedashLikeResult(value: unknown): value is RedashLikeResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = (value as RedashLikeResult).data;
  return !!data && typeof data === "object" && Array.isArray(data.rows);
}

function buildLimitedResult(result: RedashLikeResult, rowsToKeep: number, maxRows: number, maxChars: number) {
  const rows = result.data?.rows ?? [];
  const returnedRows = rows.slice(0, rowsToKeep);
  const truncatedRows = rows.length > returnedRows.length;

  return {
    ...result,
    data: {
      ...result.data,
      rows: returnedRows,
    },
    mcp_result_limit: {
      rowCount: rows.length,
      returnedRows: returnedRows.length,
      truncatedRows,
      maxRows,
      maxChars,
    },
  };
}

export function formatQueryResultForMcp(result: unknown, options: FormatOptions = {}): string {
  const envOptions = resultLimitOptionsFromEnv();
  const maxRows = options.maxRows ?? envOptions.maxRows;
  const maxChars = options.maxChars ?? envOptions.maxChars;

  if (!isRedashLikeResult(result)) {
    return truncateText(JSON.stringify(result, null, 2), maxChars);
  }

  const totalRows = result.data.rows.length;
  let rowsToKeep = Math.min(totalRows, maxRows);

  while (rowsToKeep > 0) {
    const text = JSON.stringify(buildLimitedResult(result, rowsToKeep, maxRows, maxChars), null, 2);
    if (text.length <= maxChars) {
      return text;
    }
    rowsToKeep = Math.floor(rowsToKeep / 2);
  }

  const metadataOnly = JSON.stringify(buildLimitedResult(result, 0, maxRows, maxChars), null, 2);
  return truncateText(metadataOnly, maxChars);
}

export function truncateText(text: string, maxChars = resultLimitOptionsFromEnv().maxChars): string {
  if (maxChars <= 0 || text.length <= maxChars) {
    return text;
  }
  const marker = `\n\n[Output truncated by Redash MCP: original ${text.length} chars, max ${maxChars} chars.]`;
  if (marker.length >= maxChars) {
    return text.slice(0, maxChars);
  }
  return `${text.slice(0, maxChars - marker.length)}${marker}`;
}

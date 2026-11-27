export interface ParsedCsvResult {
  headers: string[];
  rows: Array<{
    rowNumber: number;
    data: Record<string, string>;
  }>;
}

export function parseCsv(text: string): ParsedCsvResult {
  const normalized = text.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let currentField = '';
  let currentRow: string[] = [];
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        currentField += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        currentField += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      currentRow.push(currentField.trim());
      currentField = '';
    } else if (ch === '\r' && next === '\n') {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell !== '')) {
        records.push(currentRow);
      }
      currentRow = [];
      currentField = '';
      i++;
    } else if (ch === '\n' || ch === '\r') {
      currentRow.push(currentField.trim());
      if (currentRow.some((cell) => cell !== '')) {
        records.push(currentRow);
      }
      currentRow = [];
      currentField = '';
    } else {
      currentField += ch;
    }
  }

  if (currentField !== '' || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((cell) => cell !== '')) {
      records.push(currentRow);
    }
  }

  if (records.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = records[0];
  const rows = records.slice(1).map((cells, idx) => {
    const data: Record<string, string> = {};
    headers.forEach((header, colIdx) => {
      data[header] = cells[colIdx] ?? '';
    });
    return {
      rowNumber: idx + 2, // 1-based including header row
      data,
    };
  });

  return { headers, rows };
}

function escapeCsvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  // Prevent CSV formula injection when opened in spreadsheet tools
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

export function serializeCsv(
  headers: string[],
  rows: Array<Record<string, unknown>>
): string {
  const headerLine = headers.map(escapeCsvCell).join(',');
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvCell(row[h])).join(',')
  );
  return [headerLine, ...dataLines].join('\r\n');
}

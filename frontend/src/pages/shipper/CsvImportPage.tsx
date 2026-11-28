import { useState, type ChangeEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { downloadCsvTemplate, importShipmentsCsv } from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import type { CsvImportReport } from '@/types/api';

export function CsvImportPage() {
  const queryClient = useQueryClient();
  const [csvText, setCsvText] = useState('');
  const [report, setReport] = useState<CsvImportReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const importMutation = useMutation({
    mutationFn: importShipmentsCsv,
    onSuccess: (res) => {
      setErrorMsg(null);
      setReport(res);
      void queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  const handleDownloadTemplate = async () => {
    setErrorMsg(null);
    try {
      const csv = await downloadCsvTemplate();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'meecargo-shipments-template.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Download failed');
    }
  };

  const handleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Obsidian Dark Hero */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#8ea5e2]">
              Batch Manifest Processing
            </p>
            <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[36px]">
              Bulk CSV{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                style={{ fontStyle: 'italic' }}
              >
                import.
              </em>
            </h1>
            <p className="mt-1 text-xs text-[#a8b5d6] sm:text-sm">
              Validate rows individually, detect duplicate order references, and submit valid rows.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void handleDownloadTemplate()}
            className="inline-flex cursor-pointer items-center gap-2 self-start rounded-full bg-white px-5 py-2.5 text-xs font-semibold text-[#080b14] transition hover:-translate-y-0.5 hover:bg-[#eef3ff] sm:self-center"
          >
            <Download className="h-4 w-4 text-[#4673eb]" />
            Download CSV Template
          </button>
        </div>
      </section>

      {errorMsg ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {errorMsg}
        </div>
      ) : null}

      <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#080b14] text-white">
              <FileSpreadsheet className="h-4 w-4 text-[#82a2ff]" />
            </div>
            <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
              Upload or Paste CSV
            </h2>
          </div>

          <label className="cursor-pointer rounded-2xl border border-[#d5ddf0] bg-white px-4 py-2 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]">
            Choose .csv file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </div>

        <div className="space-y-4 p-6">
          <textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Paste CSV rows here (use Download CSV Template for exact headers)..."
            className="orbit-input-dark font-mono text-xs"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!csvText.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate({ csvText, dryRun: true })}
              className="cursor-pointer rounded-2xl border border-[#d5ddf0] bg-white px-5 py-2.5 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14] disabled:opacity-45"
            >
              Validate Rows (Dry Run)
            </button>
            <button
              type="button"
              disabled={!csvText.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate({ csvText, dryRun: false })}
              className="inline-flex cursor-pointer items-center gap-2 rounded-2xl bg-[#080b14] px-6 py-2.5 text-xs font-semibold text-white transition hover:bg-[#192038] disabled:opacity-45"
            >
              <Upload className="h-4 w-4 text-[#82a2ff]" />
              Import Valid Rows
            </button>
          </div>
        </div>
      </section>

      {report ? (
        <section className="orbit-reveal-1 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <h2 className="text-base font-semibold text-[#080b14]">Import Summary</h2>
          </div>

          <div className="space-y-5 p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl bg-[#080b14] p-4 text-white">
                <p className="text-xs text-[#9aa7c7]">Total Rows</p>
                <p className="mt-1 text-xl font-bold">{report.summary.totalRows}</p>
              </div>
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="text-xs text-emerald-700">Created / Valid</p>
                <p className="mt-1 text-xl font-bold text-emerald-900">
                  {report.summary.createdCount}
                </p>
              </div>
              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                <p className="text-xs text-rose-700">Rejected</p>
                <p className="mt-1 text-xl font-bold text-rose-900">
                  {report.summary.rejectedCount}
                </p>
              </div>
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs text-amber-800">Duplicates</p>
                <p className="mt-1 text-xl font-bold text-amber-950">
                  {report.summary.duplicateCount}
                </p>
              </div>
            </div>

            {report.rejected.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                  Rejected Rows
                </h3>
                {report.rejected.map((r) => (
                  <div
                    key={r.rowNumber}
                    className="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs text-rose-900"
                  >
                    <strong>Row {r.rowNumber}</strong>
                    {r.externalOrderRef ? ` (${r.externalOrderRef})` : ''}: {r.errors.join('; ')}
                  </div>
                ))}
              </div>
            ) : null}

            {report.duplicates.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                  Duplicate Order References
                </h3>
                {report.duplicates.map((d) => (
                  <div
                    key={`${d.rowNumber}-${d.externalOrderRef}`}
                    className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900"
                  >
                    <strong>Row {d.rowNumber}</strong> ({d.externalOrderRef}): {d.reason}
                  </div>
                ))}
              </div>
            ) : null}

            {report.created.length > 0 ? (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Created / Validated Bookings
                </h3>
                <div className="space-y-1.5">
                  {report.created.map((c) => (
                    <div
                      key={`${c.rowNumber}-${c.externalOrderRef}`}
                      className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs"
                    >
                      <span>
                        Row {c.rowNumber}: <strong>{c.externalOrderRef}</strong> →{' '}
                        <code className="font-mono">{c.reference}</code>
                      </span>
                      <Badge variant="success">{c.status}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
    </div>
  );
}

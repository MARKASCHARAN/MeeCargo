import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { downloadCsvTemplate, importShipmentsCsv } from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import type { CsvImportReport } from '../../types/api';

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

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Bulk CSV Import</h1>
          <p className="text-sm text-slate-500">
            Validate rows individually, detect duplicate order references, and submit valid rows.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void handleDownloadTemplate()}>
          <Download className="h-4 w-4" />
          Download CSV Template
        </Button>
      </div>

      {errorMsg ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMsg}
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            <h2 className="text-base font-semibold text-slate-900">Upload or Paste CSV</h2>
          </div>
          <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
            Choose .csv file
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="hidden"
            />
          </label>
        </CardHeader>
        <CardContent className="space-y-4">
          <textarea
            rows={8}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder="Paste CSV rows here (use Download CSV Template for exact headers)..."
            className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs focus:border-emerald-600 focus:outline-none"
          />

          <div className="flex flex-wrap gap-3">
            <Button
              variant="outline"
              disabled={!csvText.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate({ csvText, dryRun: true })}
            >
              Validate Rows (Dry Run)
            </Button>
            <Button
              variant="primary"
              disabled={!csvText.trim() || importMutation.isPending}
              onClick={() => importMutation.mutate({ csvText, dryRun: false })}
            >
              <Upload className="h-4 w-4" />
              Import Valid Rows
            </Button>
          </div>
        </CardContent>
      </Card>

      {report ? (
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">Import Summary</h2>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">Total Rows</p>
                <p className="text-lg font-bold text-slate-900">
                  {report.summary.totalRows}
                </p>
              </div>
              <div className="rounded-lg bg-emerald-50 p-3">
                <p className="text-xs text-emerald-700">Created / Valid</p>
                <p className="text-lg font-bold text-emerald-900">
                  {report.summary.createdCount}
                </p>
              </div>
              <div className="rounded-lg bg-rose-50 p-3">
                <p className="text-xs text-rose-700">Rejected</p>
                <p className="text-lg font-bold text-rose-900">
                  {report.summary.rejectedCount}
                </p>
              </div>
              <div className="rounded-lg bg-amber-50 p-3">
                <p className="text-xs text-amber-800">Duplicates</p>
                <p className="text-lg font-bold text-amber-950">
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
                    className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900"
                  >
                    <strong>Row {r.rowNumber}</strong>
                    {r.externalOrderRef ? ` (${r.externalOrderRef})` : ''}:{' '}
                    {r.errors.join('; ')}
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
                    className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
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
                      className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs"
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
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

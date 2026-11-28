import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  Search,
  ShieldAlert,
  Truck,
} from 'lucide-react';
import {
  ApiError,
  fetchDriverTier2Application,
  lookupPublicTier2Status,
  openAuthenticatedDriverDocument,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { useAuthStore } from '../../stores/authStore';
import type { PublicTier2StatusSummary, Tier2ApplicationStatus } from '../../types/api';

function statusBadge(status: Tier2ApplicationStatus) {
  if (status === 'APPROVED') return 'success';
  if (status === 'REJECTED') return 'danger';
  return 'warning';
}

export function Tier2ApplicationStatusPage() {
  const { user, accessToken } = useAuthStore();
  const isSignedInDriver = Boolean(user && accessToken && user.role === 'DRIVER');

  const signedInAppQuery = useQuery({
    queryKey: ['driver-tier2-status-signed-in'],
    queryFn: fetchDriverTier2Application,
    enabled: isSignedInDriver,
  });

  const [applicationRef, setApplicationRef] = useState('');
  const [email, setEmail] = useState('');
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupResult, setLookupResult] = useState<PublicTier2StatusSummary | null>(null);
  const [docError, setDocError] = useState<string | null>(null);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setLookupLoading(true);
    try {
      const res = await lookupPublicTier2Status({
        applicationRef: applicationRef.trim(),
        email: email.trim(),
      });
      setLookupResult(res);
    } catch (err) {
      setLookupResult(null);
      setLookupError(
        err instanceof ApiError ? err.message : 'Unable to find matching application.'
      );
    } finally {
      setLookupLoading(false);
    }
  };

  const fillDemo = (ref: string, mail: string) => {
    setApplicationRef(ref);
    setEmail(mail);
    setLookupError(null);
  };

  const signedInApp = signedInAppQuery.data?.application ?? null;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/become-a-driver"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Become a Driver
          </Link>
          <div className="flex items-center gap-3 text-xs">
            <Link to="/driver/apply" className="font-medium text-emerald-700 hover:underline">
              New Application
            </Link>
            <Link to="/driver/login" className="font-medium text-slate-700 hover:underline">
              Driver Login
            </Link>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-900 text-white">
            <Truck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Tier 2 Driver Application Status</h1>
            <p className="text-xs text-slate-500">
              Track your application progress with your reference ID and registered email address.
            </p>
          </div>
        </div>

        {isSignedInDriver && signedInApp ? (
          <Card className="border-emerald-200">
            <CardHeader className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100">
              <div>
                <p className="text-xs text-slate-500">Signed-in Driver Application</p>
                <h2 className="text-sm font-bold text-slate-900">
                  {signedInApp.fullName}{' '}
                  {signedInApp.applicationRef ? (
                    <span className="ml-1 font-mono text-xs text-slate-600">
                      ({signedInApp.applicationRef})
                    </span>
                  ) : null}
                </h2>
              </div>
              <Badge variant={statusBadge(signedInApp.status)}>{signedInApp.status}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 pt-4 text-xs text-slate-700">
              <div className="grid gap-2 sm:grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p>
                  <strong>Submitted:</strong>{' '}
                  {new Date(signedInApp.appliedAt).toLocaleString('en-IN')}
                </p>
                <p>
                  <strong>Vehicle:</strong> {signedInApp.vehicle.registrationNumber} (
                  {signedInApp.vehicle.vehicleCategory})
                </p>
                <p>
                  <strong>Documents Verification:</strong> {signedInApp.documents.verificationStatus}
                </p>
                {signedInApp.approvedAt ? (
                  <p>
                    <strong>Approved:</strong>{' '}
                    {new Date(signedInApp.approvedAt).toLocaleString('en-IN')}
                  </p>
                ) : null}
              </div>

              {signedInApp.status === 'REJECTED' && signedInApp.rejectionReason ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
                  <p className="font-semibold">Rejection Reason</p>
                  <p className="mt-1">{signedInApp.rejectionReason}</p>
                </div>
              ) : null}

              {signedInApp.uploadedDocuments && signedInApp.uploadedDocuments.length > 0 ? (
                <div className="space-y-2">
                  <p className="font-semibold text-slate-800">Uploaded Verification Documents</p>
                  {docError ? (
                    <p className="text-rose-700">{docError}</p>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {signedInApp.uploadedDocuments.map((doc) => (
                      <Button
                        key={doc.storageKey}
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          setDocError(null);
                          try {
                            await openAuthenticatedDriverDocument(
                              `/api/v1/driver/tier2-application/documents/${doc.storageKey}`
                            );
                          } catch (err) {
                            setDocError(
                              err instanceof Error ? err.message : 'Unable to open document'
                            );
                          }
                        }}
                      >
                        <FileText className="h-3.5 w-3.5" />
                        {doc.docType}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="pt-1">
                <Link to="/driver">
                  <Button variant="primary" size="sm">
                    {signedInApp.status === 'APPROVED'
                      ? 'Open Driver Marketplace'
                      : signedInApp.status === 'REJECTED'
                        ? 'Update & Resubmit in Driver Portal'
                        : 'Open Driver Portal'}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="border-b border-slate-100">
            <h2 className="text-sm font-bold text-slate-900">Public Reference Lookup</h2>
            <p className="text-xs text-slate-500">
              Check status without logging in using your application reference and email.
            </p>
          </CardHeader>
          <CardContent className="space-y-4 pt-4">
            <form onSubmit={handleLookup} className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Application Reference</span>
                <input
                  required
                  value={applicationRef}
                  onChange={(e) => setApplicationRef(e.target.value)}
                  placeholder="MC-T2-..."
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono uppercase"
                />
              </label>
              <label className="block space-y-1 text-xs">
                <span className="font-medium text-slate-700">Registered Email</span>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="driver@example.com"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2"
                />
              </label>
              <div className="flex items-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="w-full"
                  disabled={lookupLoading}
                >
                  <Search className="h-4 w-4" />
                  {lookupLoading ? 'Checking...' : 'Check Status'}
                </Button>
              </div>
            </form>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>Demo references:</span>
              <button
                type="button"
                onClick={() => fillDemo('MC-T2-DEMO-0001', 'driver2@meecargo.demo')}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-slate-700 hover:bg-slate-100"
              >
                MC-T2-DEMO-0001 (Approved)
              </button>
              <button
                type="button"
                onClick={() => fillDemo('MC-T2-DEMO-0002', 'driver3@meecargo.demo')}
                className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-slate-700 hover:bg-slate-100"
              >
                MC-T2-DEMO-0002 (Pending)
              </button>
            </div>

            {lookupError ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {lookupError}
              </div>
            ) : null}

            {lookupResult ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    {lookupResult.status === 'APPROVED' ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    ) : lookupResult.status === 'REJECTED' ? (
                      <ShieldAlert className="h-4 w-4 text-rose-600" />
                    ) : (
                      <Clock className="h-4 w-4 text-amber-600" />
                    )}
                    <span className="font-mono font-bold text-slate-900">
                      {lookupResult.applicationRef}
                    </span>
                  </div>
                  <Badge variant={statusBadge(lookupResult.status)}>{lookupResult.status}</Badge>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 text-slate-700">
                  <p>
                    <strong>Submitted:</strong>{' '}
                    {new Date(lookupResult.appliedAt).toLocaleString('en-IN')}
                  </p>
                  <p>
                    <strong>Vehicle:</strong> {lookupResult.vehicleRegistrationNumber} —{' '}
                    {lookupResult.vehicleCategory}
                  </p>
                  <p>
                    <strong>Document Check:</strong> {lookupResult.documentsVerificationStatus} (
                    {lookupResult.uploadedDocumentsCount} files)
                  </p>
                  {lookupResult.reviewedAt ? (
                    <p>
                      <strong>Reviewed:</strong>{' '}
                      {new Date(lookupResult.reviewedAt).toLocaleString('en-IN')}
                    </p>
                  ) : null}
                </div>

                {lookupResult.rejectionReason ? (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
                    <p className="font-semibold">Rejection Reason</p>
                    <p className="mt-1">{lookupResult.rejectionReason}</p>
                  </div>
                ) : null}

                <div className="rounded-lg border border-slate-200 bg-white p-3 text-slate-700">
                  <p className="font-semibold text-slate-900">Next Steps</p>
                  <p className="mt-1">{lookupResult.nextSteps}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Link to="/driver/login">
                    <Button size="sm" variant="primary">
                      Driver Portal Login
                    </Button>
                  </Link>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

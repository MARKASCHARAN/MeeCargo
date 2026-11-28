import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  ClipboardCheck,
  FileText,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  Truck,
  XCircle,
} from 'lucide-react';
import {
  approveOwnerTier2Application,
  fetchOwnerTier2Applications,
  openAuthenticatedDriverDocument,
  rejectOwnerTier2Application,
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { EmptyState, ErrorState, LoadingState } from '../../components/ui/StateViews';
import { formatPaise } from '../../lib/format';
import type { Tier2ApplicationStatus, Tier2DriverApplicationRecord } from '../../types/api';

function statusBadgeVariant(status: Tier2ApplicationStatus | string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'APPROVED' || status === 'VERIFIED') return 'success';
  if (status === 'REJECTED') return 'danger';
  if (status === 'PENDING') return 'warning';
  return 'neutral';
}

export function Tier2ApplicationsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [rejectMode, setRejectMode] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['owner-tier2-applications', statusFilter, search],
    queryFn: () => fetchOwnerTier2Applications({ status: statusFilter, search: search.trim() || undefined }),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string }) =>
      approveOwnerTier2Application(id, note),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(
        `Approved ${res.application.fullName}'s Tier 2 marketplace application and activated vehicle ${res.application.vehicle.registrationNumber}.`
      );
      setReviewNote('');
      setRejectMode(false);
      void queryClient.invalidateQueries({ queryKey: ['owner-tier2-applications'] });
    },
    onError: (err: Error) => {
      setBanner(null);
      setErrorBanner(err.message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rejectOwnerTier2Application(id, reason),
    onSuccess: (res) => {
      setErrorBanner(null);
      setBanner(`Rejected ${res.application.fullName}'s Tier 2 application.`);
      setRejectReason('');
      setRejectMode(false);
      void queryClient.invalidateQueries({ queryKey: ['owner-tier2-applications'] });
    },
    onError: (err: Error) => {
      setBanner(null);
      setErrorBanner(err.message);
    },
  });

  const applications = listQuery.data?.applications ?? [];
  const counts = listQuery.data?.counts ?? { pending: 0, approved: 0, rejected: 0, total: 0 };
  const activeApplication: Tier2DriverApplicationRecord | null =
    applications.find((a) => a._id === selectedId) ?? applications[0] ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Tier 2 Driver Applications</h1>
          <p className="text-sm text-slate-500">
            Review independent marketplace driver applications, verify identity and vehicle documents, and manage eligibility.
          </p>
        </div>
        <Badge variant="info">
          <ShieldCheck className="mr-1 h-3.5 w-3.5" />
          Single Platform Owner Review
        </Badge>
      </div>

      {banner ? (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{banner}</span>
        </div>
      ) : null}

      {errorBanner ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {errorBanner}
        </div>
      ) : null}

      {/* Filter Tabs & Search */}
      <Card>
        <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: 'PENDING', label: `Pending (${counts.pending})` },
                { key: 'APPROVED', label: `Approved (${counts.approved})` },
                { key: 'REJECTED', label: `Rejected (${counts.rejected})` },
                { key: 'ALL', label: `All (${counts.total})` },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => {
                  setStatusFilter(tab.key);
                  setRejectMode(false);
                }}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === tab.key
                    ? 'border-emerald-600 bg-emerald-600 text-white'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, email, phone, reg #..."
              className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-9 pr-3 text-sm focus:border-emerald-600 focus:outline-none"
            />
          </div>
        </CardContent>
      </Card>

      {listQuery.isLoading ? (
        <LoadingState title="Loading Tier 2 driver applications..." />
      ) : listQuery.isError ? (
        <ErrorState
          title="Could not load applications"
          description={listQuery.error.message}
          onRetry={() => void listQuery.refetch()}
        />
      ) : applications.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck className="h-6 w-6" />}
          title="No applications match this filter"
          description="Switch status tabs or clear your search query to inspect other Tier 2 driver applications."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-12">
          {/* Application List */}
          <div className="space-y-3 lg:col-span-5">
            {applications.map((app) => {
              const isSelected = activeApplication?._id === app._id;
              return (
                <button
                  key={app._id}
                  type="button"
                  onClick={() => {
                    setSelectedId(app._id);
                    setRejectMode(false);
                    setRejectReason('');
                    setReviewNote('');
                  }}
                  className={`w-full rounded-xl border p-4 text-left transition ${
                    isSelected
                      ? 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-500'
                      : 'border-slate-200 bg-white hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-slate-900">{app.fullName}</p>
                      <p className="text-xs text-slate-500">{app.email}</p>
                    </div>
                    <Badge variant={statusBadgeVariant(app.status)}>{app.status}</Badge>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                    <span className="font-mono font-semibold text-slate-800">
                      {app.vehicle.registrationNumber}
                    </span>
                    <span>•</span>
                    <span>{app.vehicle.vehicleCategory}</span>
                    <span>•</span>
                    <span>{app.vehicle.maxWeightKg} kg</span>
                  </div>

                  <p className="mt-1.5 text-[11px] text-slate-500">
                    Applied {new Date(app.appliedAt).toLocaleDateString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}{' '}
                    • {app.address.cityOrTown}, {app.address.district}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Inspection & Decision Panel */}
          {activeApplication ? (
            <div className="lg:col-span-7">
              <Card>
                <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold text-slate-900">
                        {activeApplication.fullName}
                      </h2>
                      <Badge variant={statusBadgeVariant(activeApplication.status)}>
                        {activeApplication.status}
                      </Badge>
                      <Badge variant={statusBadgeVariant(activeApplication.documents.verificationStatus)}>
                        Docs: {activeApplication.documents.verificationStatus}
                      </Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {activeApplication.applicationRef ? (
                        <>
                          Ref <strong className="font-mono text-slate-700">{activeApplication.applicationRef}</strong> •{' '}
                        </>
                      ) : null}
                      Independent Tier 2 Marketplace Applicant • Applied{' '}
                      {new Date(activeApplication.appliedAt).toLocaleString('en-IN')}
                      {activeApplication.resubmissionCount > 0
                        ? ` • Resubmitted ${activeApplication.resubmissionCount} time(s)`
                        : ''}
                    </p>
                  </div>
                </CardHeader>

                <CardContent className="space-y-5 pt-4 text-xs">
                  {/* Applicant Details */}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                      <p className="font-semibold text-slate-800">Applicant Contact &amp; Address</p>
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <Mail className="h-3.5 w-3.5 text-slate-400" />
                        {activeApplication.email}
                      </p>
                      <p className="flex items-center gap-1.5 text-slate-700">
                        <Phone className="h-3.5 w-3.5 text-slate-400" />
                        {activeApplication.phone}
                      </p>
                      <p className="flex items-start gap-1.5 text-slate-700">
                        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span>
                          {activeApplication.address.addressLine},{' '}
                          {activeApplication.address.cityOrTown},{' '}
                          {activeApplication.address.district},{' '}
                          {activeApplication.address.state} — {activeApplication.address.pincode}
                        </span>
                      </p>
                    </div>

                    {/* Vehicle Specs */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-1.5">
                      <p className="flex items-center gap-1.5 font-semibold text-slate-800">
                        <Truck className="h-3.5 w-3.5 text-emerald-700" />
                        Vehicle Specifications
                      </p>
                      <p className="text-slate-700">
                        Reg #: <strong className="font-mono">{activeApplication.vehicle.registrationNumber}</strong>
                      </p>
                      <p className="text-slate-700">
                        Category: <strong>{activeApplication.vehicle.vehicleCategory}</strong> ({activeApplication.vehicle.bodyType})
                      </p>
                      <p className="text-slate-700">
                        Capacity: <strong>{activeApplication.vehicle.maxWeightKg} kg</strong> •{' '}
                        <strong>{activeApplication.vehicle.maxVolumeCbm} m³</strong>
                      </p>
                      <p className="text-slate-700">
                        Bed (L×W×H): {activeApplication.vehicle.bedLengthCm} ×{' '}
                        {activeApplication.vehicle.bedWidthCm} ×{' '}
                        {activeApplication.vehicle.bedHeightCm} cm
                      </p>
                      <p className="text-slate-700">
                        Marketplace Per-km Rate:{' '}
                        <strong>{formatPaise(activeApplication.vehicle.perKmRatePaise)} / km</strong>{' '}
                        (No Tier 1 guarantee)
                      </p>
                    </div>
                  </div>

                  {/* Submitted Identity & Vehicle Documents */}
                  <div className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="flex items-center gap-1.5 font-semibold text-slate-900">
                        <FileText className="h-3.5 w-3.5 text-emerald-700" />
                        Identity &amp; Vehicle Documents
                      </p>
                      <Badge variant={statusBadgeVariant(activeApplication.documents.verificationStatus)}>
                        {activeApplication.documents.verificationStatus}
                      </Badge>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 text-slate-700">
                      <p>
                        Driving License: <strong className="font-mono">{activeApplication.identity.licenseNumber}</strong>
                      </p>
                      <p>
                        Identity Proof ({activeApplication.identity.idProofType}):{' '}
                        <strong className="font-mono">{activeApplication.identity.idProofNumber}</strong>
                      </p>
                      <p>
                        RC Number: <strong className="font-mono">{activeApplication.documents.rcNumber}</strong>
                      </p>
                      <p>
                        Insurance Policy:{' '}
                        <strong className="font-mono">{activeApplication.documents.insurancePolicyNumber}</strong>
                      </p>
                      {activeApplication.documents.insuranceValidUntil ? (
                        <p>
                          Insurance Expiry:{' '}
                          <strong>
                            {new Date(activeApplication.documents.insuranceValidUntil).toLocaleDateString('en-IN')}
                          </strong>
                        </p>
                      ) : null}
                      {activeApplication.documents.fitnessValidUntil ? (
                        <p>
                          Fitness Expiry:{' '}
                          <strong>
                            {new Date(activeApplication.documents.fitnessValidUntil).toLocaleDateString('en-IN')}
                          </strong>
                        </p>
                      ) : null}
                      {activeApplication.documents.permitNotes ? (
                        <p className="sm:col-span-2">
                          Permit Notes: <span>{activeApplication.documents.permitNotes}</span>
                        </p>
                      ) : null}
                    </div>

                    {activeApplication.uploadedDocuments &&
                    activeApplication.uploadedDocuments.length > 0 ? (
                      <div className="border-t border-slate-100 pt-2.5">
                        <p className="mb-1.5 text-[11px] font-semibold text-slate-600">
                          Uploaded Document Files ({activeApplication.uploadedDocuments.length})
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {activeApplication.uploadedDocuments.map((doc) => (
                            <Button
                              key={doc.storageKey}
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={async () => {
                                setErrorBanner(null);
                                try {
                                  await openAuthenticatedDriverDocument(
                                    `/api/v1/platform-owner/tier2-applications/${activeApplication._id}/documents/${doc.storageKey}`
                                  );
                                } catch (err) {
                                  setErrorBanner(
                                    err instanceof Error ? err.message : 'Unable to view document'
                                  );
                                }
                              }}
                            >
                              <FileText className="h-3.5 w-3.5" />
                              {doc.docType} ({doc.originalName})
                            </Button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>

                  {activeApplication.status === 'REJECTED' && activeApplication.rejectionReason ? (
                    <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
                      <p className="font-semibold">Rejection Reason</p>
                      <p className="mt-0.5">{activeApplication.rejectionReason}</p>
                    </div>
                  ) : null}

                  {activeApplication.status === 'APPROVED' ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                      <p className="font-semibold">Approved for Tier 2 Marketplace</p>
                      <p className="mt-0.5">
                        Approved on{' '}
                        {activeApplication.approvedAt
                          ? new Date(activeApplication.approvedAt).toLocaleString('en-IN')
                          : '—'}
                        {activeApplication.reviewNote ? ` • Note: ${activeApplication.reviewNote}` : ''}
                      </p>
                    </div>
                  ) : null}

                  {/* Decision Controls for PENDING Applications */}
                  {activeApplication.status === 'PENDING' ? (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
                      <p className="font-semibold text-slate-900">Review Decision</p>

                      {!rejectMode ? (
                        <>
                          <div>
                            <label className="mb-1 block text-[11px] font-medium text-slate-600">
                              Optional Verification / Approval Note
                            </label>
                            <input
                              type="text"
                              value={reviewNote}
                              onChange={(e) => setReviewNote(e.target.value)}
                              placeholder="RC, insurance & license verified"
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs"
                            />
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="primary"
                              size="sm"
                              disabled={approveMutation.isPending}
                              onClick={() =>
                                approveMutation.mutate({
                                  id: activeApplication._id,
                                  note: reviewNote.trim() || undefined,
                                })
                              }
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              {approveMutation.isPending
                                ? 'Approving...'
                                : 'Approve Tier 2 Application'}
                            </Button>
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setRejectMode(true)}
                            >
                              <XCircle className="h-4 w-4" />
                              Reject Application
                            </Button>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-2">
                          <label className="block text-[11px] font-semibold text-rose-800">
                            Rejection Reason (Required) *
                          </label>
                          <textarea
                            rows={2}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            placeholder="Explain why the application or documents were rejected (minimum 5 characters)..."
                            className="w-full rounded-lg border border-rose-300 bg-white p-2.5 text-xs"
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={
                                rejectMutation.isPending || rejectReason.trim().length < 5
                              }
                              onClick={() =>
                                rejectMutation.mutate({
                                  id: activeApplication._id,
                                  reason: rejectReason.trim(),
                                })
                              }
                            >
                              {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setRejectMode(false);
                                setRejectReason('');
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}

                  {/* Audit Log */}
                  {activeApplication.decisionHistory.length > 0 ? (
                    <div className="space-y-1.5 border-t border-slate-100 pt-3">
                      <p className="font-semibold text-slate-800">Decision Audit Trail</p>
                      {activeApplication.decisionHistory.map((h, idx) => (
                        <div
                          key={`${h.action}-${idx}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-50 px-2.5 py-1.5 text-[11px] text-slate-600"
                        >
                          <span>
                            <strong className="text-slate-800">{h.action}</strong>
                            {h.note ? ` — ${h.note}` : ''}
                          </span>
                          <span>{new Date(h.at).toLocaleString('en-IN')}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

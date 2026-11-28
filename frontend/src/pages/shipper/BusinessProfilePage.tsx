import { useEffect, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { z } from 'zod';
import {
  createBusinessProfile,
  fetchBusinessProfile,
  updateBusinessProfile,
} from '@/api/client';
import { Badge } from '@/components/ui/Badge';
import { ErrorState, LoadingState } from '@/components/ui/StateViews';
import { useAuthStore } from '@/stores/authStore';

const businessSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name is required'),
  businessType: z.enum([
    'MANUFACTURER',
    'WHOLESALER',
    'TEXTILE_MILL',
    'AGRO_PROCESSOR',
    'RETAILER',
    'OTHER',
  ]),
  contactName: z.string().trim().min(2, 'Contact name is required'),
  contactPhone: z.string().trim().min(8, 'Contact phone is required'),
  contactEmail: z.string().trim().email('Valid contact email is required'),
  gstin: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .toUpperCase()
        .regex(
          /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/,
          'Invalid GSTIN format'
        ),
    ])
    .optional(),
  addressLine: z.string().trim().min(3, 'Street / estate address is required'),
  villageOrTown: z.string().trim().min(2, 'Village or town is required'),
  district: z.string().trim().min(2, 'District is required'),
  state: z.string().trim().min(2, 'State is required'),
  pincode: z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits'),
  landmark: z.string().trim().optional(),
  longitude: z.coerce.number().min(-180).max(180),
  latitude: z.coerce.number().min(-90).max(90),
  serviceLocations: z.array(
    z.object({
      label: z.string().trim().min(2, 'Label required'),
      villageOrTown: z.string().trim().min(2, 'Town required'),
      district: z.string().trim().min(2, 'District required'),
      state: z.string().trim().min(2),
      pincode: z.string().trim().optional(),
    })
  ),
});

type BusinessFormValues = z.infer<typeof businessSchema>;

export function BusinessProfilePage() {
  const queryClient = useQueryClient();
  const { user, setUser } = useAuthStore();
  const [savedNotice, setSavedNotice] = useState(false);

  const profileQuery = useQuery({
    queryKey: ['shipper-business-profile'],
    queryFn: fetchBusinessProfile,
  });

  const existing = profileQuery.data?.businessProfile ?? null;

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<BusinessFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(businessSchema) as any,
    defaultValues: {
      businessName: '',
      businessType: 'OTHER',
      contactName: user?.name ?? '',
      contactPhone: user?.phone ?? '',
      contactEmail: user?.email ?? '',
      gstin: '',
      addressLine: '',
      villageOrTown: 'Vadodara',
      district: 'Vadodara',
      state: 'Gujarat',
      pincode: '390010',
      landmark: '',
      longitude: 73.1812,
      latitude: 22.3072,
      serviceLocations: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'serviceLocations',
  });

  useEffect(() => {
    if (existing) {
      reset({
        businessName: existing.businessName,
        businessType: existing.businessType,
        contactName: existing.contactName,
        contactPhone: existing.contactPhone,
        contactEmail: existing.contactEmail,
        gstin: existing.gstin ?? '',
        addressLine: existing.pickupAddress.addressLine,
        villageOrTown: existing.pickupAddress.villageOrTown,
        district: existing.pickupAddress.district,
        state: existing.pickupAddress.state,
        pincode: existing.pickupAddress.pincode,
        landmark: existing.pickupAddress.landmark ?? '',
        longitude: existing.pickupAddress.location.coordinates[0],
        latitude: existing.pickupAddress.location.coordinates[1],
        serviceLocations: existing.serviceLocations ?? [],
      });
    }
  }, [existing, reset]);

  const mutation = useMutation({
    mutationFn: async (values: BusinessFormValues) => {
      const payload = {
        businessName: values.businessName,
        businessType: values.businessType,
        contactName: values.contactName,
        contactPhone: values.contactPhone,
        contactEmail: values.contactEmail,
        gstin: values.gstin || undefined,
        pickupAddress: {
          addressLine: values.addressLine,
          villageOrTown: values.villageOrTown,
          district: values.district,
          state: values.state,
          pincode: values.pincode,
          landmark: values.landmark || undefined,
          location: {
            type: 'Point' as const,
            coordinates: [values.longitude, values.latitude] as [number, number],
          },
        },
        serviceLocations: values.serviceLocations,
      };
      return existing ? updateBusinessProfile(payload) : createBusinessProfile(payload);
    },
    onSuccess: (res) => {
      queryClient.setQueryData(['shipper-business-profile'], res);
      if (user) {
        setUser({
          ...user,
          businessId: res.businessProfile._id,
          businessName: res.businessProfile.businessName,
        });
      }
      setSavedNotice(true);
      setTimeout(() => setSavedNotice(false), 3000);
    },
  });

  if (profileQuery.isLoading) {
    return <LoadingState title="Loading business profile..." />;
  }

  if (profileQuery.isError) {
    return (
      <ErrorState
        title="Could not load business profile"
        description={profileQuery.error.message}
        onRetry={() => void profileQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Obsidian Dark Hero */}
      <section className="orbit-reveal-1 relative overflow-hidden rounded-[28px] border border-[#1d2542] bg-[#080b14] p-6 text-white shadow-[0_24px_65px_-28px_rgba(8,11,20,0.65)] sm:p-8">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-12 -top-16 h-60 w-60 rounded-full bg-[radial-gradient(circle,rgba(70,115,235,0.28),transparent_70%)] blur-xl"
        />
        <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.26em] text-[#8ea5e2]">
              Isolated Business Entity
            </p>
            <h1 className="mt-1.5 text-[28px] font-[550] leading-tight tracking-[-0.04em] text-white sm:text-[36px]">
              B2B business{' '}
              <em
                className="font-orbit-serif text-[1.12em] font-normal text-[#82a2ff]"
                style={{ fontStyle: 'italic' }}
              >
                profile.
              </em>
            </h1>
            <p className="mt-1 text-xs text-[#a8b5d6] sm:text-sm">
              Required before booking shipments. Data is isolated to your verified business.
            </p>
          </div>
          <Badge variant={existing ? 'success' : 'warning'}>
            <Building2 className="h-3.5 w-3.5" />
            {existing ? 'Profile Active' : 'Setup Required'}
          </Badge>
        </div>
      </section>

      {savedNotice ? (
        <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Business profile saved successfully.
        </div>
      ) : null}

      {mutation.isError ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-700">
          {mutation.error.message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit((vals) => mutation.mutate(vals))} className="space-y-6">
        <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
              Company &amp; Contact
            </h2>
          </div>

          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Business Name *
              </label>
              <input
                {...register('businessName')}
                className="orbit-input-dark"
                placeholder="Patel Textiles Pvt. Ltd."
              />
              {errors.businessName ? (
                <p className="mt-1 text-xs text-rose-600">{errors.businessName.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Business Type
              </label>
              <select {...register('businessType')} className="orbit-input-dark">
                <option value="MANUFACTURER">Manufacturer</option>
                <option value="WHOLESALER">Wholesaler</option>
                <option value="TEXTILE_MILL">Textile Mill</option>
                <option value="AGRO_PROCESSOR">Agro Processor</option>
                <option value="RETAILER">Retailer</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Contact Person *
              </label>
              <input {...register('contactName')} className="orbit-input-dark" />
              {errors.contactName ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contactName.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Contact Phone *
              </label>
              <input {...register('contactPhone')} className="orbit-input-dark" />
              {errors.contactPhone ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contactPhone.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Contact Email *
              </label>
              <input {...register('contactEmail')} className="orbit-input-dark" />
              {errors.contactEmail ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contactEmail.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                GSTIN (optional for prototype)
              </label>
              <input
                {...register('gstin')}
                placeholder="24AAACP1234A1Z5"
                className="orbit-input-dark font-mono uppercase"
              />
              {errors.gstin ? (
                <p className="mt-1 text-xs text-rose-600">{errors.gstin.message}</p>
              ) : null}
            </div>
          </div>
        </section>

        <section className="orbit-reveal-2 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
              Primary Pickup Address &amp; Coordinates
            </h2>
          </div>

          <div className="grid gap-4 p-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Address Line / Plot / Industrial Estate *
              </label>
              <input {...register('addressLine')} className="orbit-input-dark" />
              {errors.addressLine ? (
                <p className="mt-1 text-xs text-rose-600">{errors.addressLine.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                Village / Town *
              </label>
              <input {...register('villageOrTown')} className="orbit-input-dark" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">District *</label>
              <input {...register('district')} className="orbit-input-dark" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">State *</label>
              <input {...register('state')} className="orbit-input-dark" />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">PIN Code *</label>
              <input {...register('pincode')} className="orbit-input-dark font-mono" />
              {errors.pincode ? (
                <p className="mt-1 text-xs text-rose-600">{errors.pincode.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">Landmark</label>
              <input
                {...register('landmark')}
                placeholder="Near GIDC Main Gate"
                className="orbit-input-dark"
              />
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                  Longitude *
                </label>
                <input
                  type="number"
                  step="any"
                  {...register('longitude')}
                  className="orbit-input-dark"
                />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-[#3b476b]">
                  Latitude *
                </label>
                <input
                  type="number"
                  step="any"
                  {...register('latitude')}
                  className="orbit-input-dark"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="orbit-reveal-3 overflow-hidden rounded-[28px] border border-[#dce5fa] bg-white/95 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eaf0fd] bg-[#f8faff] px-6 py-4">
            <div>
              <h2 className="text-sm font-semibold text-[#080b14] sm:text-base">
                Service Locations
              </h2>
              <p className="text-xs text-[#5c6b94]">Frequent towns/hubs where this business ships.</p>
            </div>
            <button
              type="button"
              onClick={() =>
                append({
                  label: '',
                  villageOrTown: '',
                  district: '',
                  state: 'Gujarat',
                  pincode: '',
                })
              }
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-2xl border border-[#d5ddf0] bg-white px-3.5 py-2 text-xs font-semibold text-[#080b14] transition hover:border-[#080b14]"
            >
              <Plus className="h-4 w-4 text-[#4673eb]" />
              Add location
            </button>
          </div>

          <div className="space-y-3 p-6">
            {fields.length === 0 ? (
              <p className="text-xs text-[#5c6b94]">No extra service locations added yet.</p>
            ) : (
              fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid gap-2.5 rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-3.5 sm:grid-cols-5"
                >
                  <input
                    {...register(`serviceLocations.${index}.label`)}
                    placeholder="Label (e.g. Anand Hub)"
                    className="orbit-input-dark py-2"
                  />
                  <input
                    {...register(`serviceLocations.${index}.villageOrTown`)}
                    placeholder="Town"
                    className="orbit-input-dark py-2"
                  />
                  <input
                    {...register(`serviceLocations.${index}.district`)}
                    placeholder="District"
                    className="orbit-input-dark py-2"
                  />
                  <input
                    {...register(`serviceLocations.${index}.pincode`)}
                    placeholder="PIN (optional)"
                    className="orbit-input-dark py-2 font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    className="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-medium text-rose-600 transition hover:bg-rose-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remove
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="cursor-pointer rounded-2xl bg-[#080b14] px-7 py-3.5 text-sm font-semibold text-white shadow-[0_14px_34px_-14px_rgba(8,11,20,0.55)] transition hover:-translate-y-0.5 hover:bg-[#192038] disabled:opacity-50"
          >
            {mutation.isPending
              ? 'Saving...'
              : existing
                ? 'Update Business Profile'
                : 'Save & Activate Business Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}

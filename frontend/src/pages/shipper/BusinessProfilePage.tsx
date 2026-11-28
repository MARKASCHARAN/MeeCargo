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
} from '../../api/client';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';
import { ErrorState, LoadingState } from '../../components/ui/StateViews';
import { useAuthStore } from '../../stores/authStore';

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
        .regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN format'),
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
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">B2B Business Profile</h1>
          <p className="text-sm text-slate-500">
            Required before booking shipments. Data is isolated to your business.
          </p>
        </div>
        <Badge variant={existing ? 'success' : 'warning'}>
          <Building2 className="h-3.5 w-3.5" />
          {existing ? 'Profile Active' : 'Setup Required'}
        </Badge>
      </div>

      {savedNotice ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" />
          Business profile saved successfully.
        </div>
      ) : null}

      {mutation.isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mutation.error.message}
        </div>
      ) : null}

      <form onSubmit={handleSubmit((vals) => mutation.mutate(vals))} className="space-y-6">
        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">Company & Contact</h2>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Business Name *
              </label>
              <input
                {...register('businessName')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                placeholder="Patel Textiles Pvt. Ltd."
              />
              {errors.businessName ? (
                <p className="mt-1 text-xs text-rose-600">{errors.businessName.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Business Type
              </label>
              <select
                {...register('businessType')}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="MANUFACTURER">Manufacturer</option>
                <option value="WHOLESALER">Wholesaler</option>
                <option value="TEXTILE_MILL">Textile Mill</option>
                <option value="AGRO_PROCESSOR">Agro Processor</option>
                <option value="RETAILER">Retailer</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Contact Person *
              </label>
              <input
                {...register('contactName')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.contactName ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contactName.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Contact Phone *
              </label>
              <input
                {...register('contactPhone')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.contactPhone ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contactPhone.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Contact Email *
              </label>
              <input
                {...register('contactEmail')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.contactEmail ? (
                <p className="mt-1 text-xs text-rose-600">{errors.contactEmail.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                GSTIN (optional for prototype)
              </label>
              <input
                {...register('gstin')}
                placeholder="24AAACP1234A1Z5"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm uppercase"
              />
              {errors.gstin ? (
                <p className="mt-1 text-xs text-rose-600">{errors.gstin.message}</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-900">
              Primary Pickup Address & Coordinates
            </h2>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Address Line / Plot / Industrial Estate *
              </label>
              <input
                {...register('addressLine')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.addressLine ? (
                <p className="mt-1 text-xs text-rose-600">{errors.addressLine.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Village / Town *
              </label>
              <input
                {...register('villageOrTown')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                District *
              </label>
              <input
                {...register('district')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                State *
              </label>
              <input
                {...register('state')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                PIN Code *
              </label>
              <input
                {...register('pincode')}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              {errors.pincode ? (
                <p className="mt-1 text-xs text-rose-600">{errors.pincode.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Landmark
              </label>
              <input
                {...register('landmark')}
                placeholder="Near GIDC Main Gate"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Longitude *
                </label>
                <input
                  type="number"
                  step="any"
                  {...register('longitude')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Latitude *
                </label>
                <input
                  type="number"
                  step="any"
                  {...register('latitude')}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Service Locations</h2>
              <p className="text-xs text-slate-500">
                Frequent towns/hubs where this business ships.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                append({
                  label: '',
                  villageOrTown: '',
                  district: '',
                  state: 'Gujarat',
                  pincode: '',
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add location
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {fields.length === 0 ? (
              <p className="text-sm text-slate-500">No extra service locations added yet.</p>
            ) : (
              fields.map((field, index) => (
                <div
                  key={field.id}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-5"
                >
                  <input
                    {...register(`serviceLocations.${index}.label`)}
                    placeholder="Label (e.g. Anand Hub)"
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                  <input
                    {...register(`serviceLocations.${index}.villageOrTown`)}
                    placeholder="Town"
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                  <input
                    {...register(`serviceLocations.${index}.district`)}
                    placeholder="District"
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                  <input
                    {...register(`serviceLocations.${index}.pincode`)}
                    placeholder="PIN (optional)"
                    className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-rose-600"
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button type="submit" variant="primary" size="lg" disabled={mutation.isPending}>
            {mutation.isPending
              ? 'Saving...'
              : existing
                ? 'Update Business Profile'
                : 'Save & Activate Business Profile'}
          </Button>
        </div>
      </form>
    </div>
  );
}

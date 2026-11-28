import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import {
  Clock,
  Eye,
  EyeOff,
  Lock,
  Mail,
  QrCode,
  ShieldCheck,
  Sparkles,
  Truck,
  WifiOff,
} from 'lucide-react';
import { z } from 'zod';
import { ApiError, loginUser } from '@/api/client';
import {
  OrbitArrow,
  OrbitAuthLayout,
  type AuthHighlight,
} from '@/components/auth/OrbitAuthLayout';
import { useAuthStore } from '@/stores/authStore';

const driverLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type DriverLoginFormValues = z.infer<typeof driverLoginSchema>;

const DRIVER_HIGHLIGHTS: AuthHighlight[] = [
  {
    icon: Truck,
    title: 'LIFO Loading & Stop Sequence',
    description:
      'View reverse-stop cargo placement so every corridor drop unloads cleanly.',
  },
  {
    icon: QrCode,
    title: 'QR Pickup & OTP Delivery Proof',
    description:
      'Scan parcel labels at pickup and verify handoff with recipient OTP.',
  },
  {
    icon: WifiOff,
    title: 'Offline-Ready Driver PWA',
    description:
      'Cached trip manifests and IndexedDB event queuing along rural stretches.',
  },
];

export function DriverLoginPage() {
  const { setSession } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<DriverLoginFormValues>({
    resolver: zodResolver(driverLoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: DriverLoginFormValues) => {
    setServerError(null);
    try {
      const res = await loginUser(values);
      setSession({
        user: res.user,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      if (res.user.role === 'SHIPPER') {
        navigate('/shipper', { replace: true });
      } else if (res.user.role === 'PLATFORM_OWNER') {
        navigate('/owner', { replace: true });
      } else {
        navigate('/driver', { replace: true });
      }
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Unable to sign in right now.'
      );
    }
  };

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', 'Demo@1234', { shouldValidate: true });
  };

  return (
    <OrbitAuthLayout
      brandSub="driver portal"
      headerCtaLabel="Apply as Driver"
      headerCtaTo="/become-a-driver"
      eyebrow="Tier 1 & Tier 2 Fleet"
      headlineLines={['Ready for', 'your next', 'dispatch.']}
      description="Sign in to view assigned AM and PM corridor trips, pooling slots, earnings, and offline-ready delivery manifests."
      highlights={DRIVER_HIGHLIGHTS}
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#7a94df]">
              Driver PWA
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#080e2b]">
              Driver Portal Sign In
            </h2>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-[#dce5fa] bg-[#eef3ff] px-3 py-1 text-[11px] font-medium text-[#4673eb]">
            Offline Ready
          </span>
        </div>

        {serverError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {serverError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label
              htmlFor="driver-email"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="driver-email"
                type="email"
                autoComplete="email"
                {...register('email')}
                placeholder="driver@meecargo.demo"
                className="w-full rounded-2xl border border-[#dce5fa] bg-[#f8faff] py-3 pl-10 pr-4 text-sm text-[#080e2b] placeholder:text-[#94a7d1] transition focus:border-[#4773ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4773ec]/10"
              />
            </div>
            {errors.email ? (
              <p className="mt-1.5 text-xs text-rose-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="driver-password"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="driver-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                {...register('password')}
                placeholder="••••••••"
                className="w-full rounded-2xl border border-[#dce5fa] bg-[#f8faff] py-3 pl-10 pr-11 text-sm text-[#080e2b] placeholder:text-[#94a7d1] transition focus:border-[#4773ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4773ec]/10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-[#7a87aa] transition hover:text-[#4673eb]"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            {errors.password ? (
              <p className="mt-1.5 text-xs text-rose-600">
                {errors.password.message}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="mt-2 inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2.5 rounded-full bg-[#4773ec] px-6 py-3.5 text-[15px] font-medium text-white shadow-[inset_0_1px_0_#ffffff30] transition hover:-translate-y-0.5 hover:bg-[#345fda] active:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in to Driver Portal'}
            <OrbitArrow />
          </button>
        </form>

        <div className="rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-[#4d5a83]">
            <Sparkles className="h-3.5 w-3.5 text-[#4673eb]" />
            <span>Demo Driver Accounts</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fillDemo('driver1@meecargo.demo')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2c3b68] transition hover:border-[#4773ec] hover:bg-[#eef3ff] hover:text-[#4673eb]"
            >
              <Truck className="h-3.5 w-3.5 text-[#4673eb]" />
              Tier 1 Contract Driver
            </button>
            <button
              type="button"
              onClick={() => fillDemo('driver2@meecargo.demo')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2c3b68] transition hover:border-[#4773ec] hover:bg-[#eef3ff] hover:text-[#4673eb]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#4673eb]" />
              Tier 2 Approved
            </button>
            <button
              type="button"
              onClick={() => fillDemo('driver3@meecargo.demo')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2c3b68] transition hover:border-[#4773ec] hover:bg-[#eef3ff] hover:text-[#4673eb]"
            >
              <Clock className="h-3.5 w-3.5 text-[#4673eb]" />
              Tier 2 Pending
            </button>
          </div>
        </div>

        <div className="space-y-2 border-t border-[#e8eefc] pt-4 text-center text-xs text-[#5c6b94]">
          <p>
            Want to drive your own vehicle on MeeCargo?{' '}
            <Link
              to="/become-a-driver"
              className="font-semibold text-[#4673eb] hover:underline"
            >
              Become a Tier 2 Driver
            </Link>{' '}
            or{' '}
            <Link
              to="/driver/apply"
              className="font-semibold text-[#4673eb] hover:underline"
            >
              Apply Now
            </Link>
          </p>
          <p>
            Already applied?{' '}
            <Link
              to="/driver/application-status"
              className="font-medium text-[#080e2b] hover:underline"
            >
              Check Application Status
            </Link>{' '}
            •{' '}
            <Link to="/login" className="font-medium text-[#4673eb] hover:underline">
              Shipper / Owner Sign in
            </Link>
          </p>
        </div>
      </div>
    </OrbitAuthLayout>
  );
}

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Building2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react';
import { z } from 'zod';
import { ApiError, loginUser } from '@/api/client';
import {
  OrbitArrow,
  OrbitAuthLayout,
} from '@/components/auth/OrbitAuthLayout';
import { useAuthStore } from '@/stores/authStore';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, setSession, logout } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const redirectFrom = (location.state as { from?: string } | null)?.from;

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: LoginFormValues) => {
    setServerError(null);
    try {
      const res = await loginUser(values);
      setSession({
        user: res.user,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      const defaultTarget =
        res.user.role === 'SHIPPER'
          ? '/shipper'
          : res.user.role === 'PLATFORM_OWNER'
            ? '/owner'
            : '/driver';
      navigate(
        redirectFrom && redirectFrom.startsWith(defaultTarget)
          ? redirectFrom
          : defaultTarget,
        { replace: true }
      );
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Unable to reach MeeCargo API. Ensure the backend server is running.'
      );
    }
  };

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', 'Demo@1234', { shouldValidate: true });
  };

  const activePortalTarget = user
    ? user.role === 'SHIPPER'
      ? '/shipper'
      : user.role === 'PLATFORM_OWNER'
        ? '/owner'
        : '/driver'
    : '/login';

  return (
    <OrbitAuthLayout
      headerCtaLabel="Create account"
      headerCtaTo="/register"
      eyebrow="Shipper • Driver • Owner"
      headlineLines={['Welcome back.', 'Your corridor', 'awaits.']}
      description="Sign in to book pooled corridor slots, manage active truck-bed manifests, or oversee attached fleet operations."
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#7a94df]">
              Portal Access
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#080e2b]">
              Sign in to MeeCargo
            </h2>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-[#dce5fa] bg-[#eef3ff] px-3 py-1 text-[11px] font-medium text-[#4673eb]">
            UM-02 Auth
          </span>
        </div>

        {user ? (
          <div className="rounded-2xl border border-[#c9d7f5] bg-[#eef3ff]/75 p-4 text-sm text-[#080e2b]">
            <p className="font-medium">
              Currently signed in as{' '}
              <span className="font-semibold text-[#4673eb]">{user.name}</span>{' '}
              <span className="text-xs text-[#5c6b94]">({user.role})</span>
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to={activePortalTarget}
                className="inline-flex items-center gap-1.5 rounded-full bg-[#4773ec] px-4 py-2 text-xs font-medium text-white transition hover:bg-[#345fda]"
              >
                Continue to portal
                <OrbitArrow />
              </Link>
              <button
                type="button"
                onClick={logout}
                className="inline-flex items-center rounded-full border border-[#c9d7f5] bg-white px-4 py-2 text-xs font-medium text-[#4d5a83] transition hover:border-[#4773ec] hover:text-[#4773ec]"
              >
                Sign out
              </button>
            </div>
          </div>
        ) : null}

        {serverError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {serverError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label
              htmlFor="login-email"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                {...register('email')}
                placeholder="you@company.in"
                className="w-full rounded-2xl border border-[#dce5fa] bg-[#f8faff] py-3 pl-10 pr-4 text-sm text-[#080e2b] placeholder:text-[#94a7d1] transition focus:border-[#4773ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4773ec]/10"
              />
            </div>
            {errors.email ? (
              <p className="mt-1.5 text-xs text-rose-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="login-password"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="login-password"
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
            {isSubmitting ? 'Signing in…' : 'Sign in'}
            <OrbitArrow />
          </button>
        </form>

        <div className="rounded-2xl border border-[#dce5fa] bg-[#f8faff] p-4">
          <div className="mb-2.5 flex items-center gap-1.5 text-xs font-medium text-[#4d5a83]">
            <Sparkles className="h-3.5 w-3.5 text-[#4673eb]" />
            <span>Quick-fill seeded demo credentials</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => fillDemo('shipper1@meecargo.demo')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2c3b68] transition hover:border-[#4773ec] hover:bg-[#eef3ff] hover:text-[#4673eb]"
            >
              <Building2 className="h-3.5 w-3.5 text-[#4673eb]" />
              Demo Shipper
            </button>
            <button
              type="button"
              onClick={() => fillDemo('driver1@meecargo.demo')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2c3b68] transition hover:border-[#4773ec] hover:bg-[#eef3ff] hover:text-[#4673eb]"
            >
              <Truck className="h-3.5 w-3.5 text-[#4673eb]" />
              Demo Driver
            </button>
            <button
              type="button"
              onClick={() => fillDemo('owner@meecargo.demo')}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-[#dce5fa] bg-white px-3.5 py-1.5 text-xs font-medium text-[#2c3b68] transition hover:border-[#4773ec] hover:bg-[#eef3ff] hover:text-[#4673eb]"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#4673eb]" />
              Platform Owner
            </button>
          </div>
        </div>

        <div className="space-y-2 border-t border-[#e8eefc] pt-4 text-center text-sm text-[#5c6b94]">
          <p>
            New to MeeCargo?{' '}
            <Link
              to="/register"
              className="font-semibold text-[#4673eb] hover:underline"
            >
              Create an account
            </Link>
          </p>
          <p className="text-xs text-[#7a87aa]">
            Drive with MeeCargo:{' '}
            <Link
              to="/become-a-driver"
              className="font-medium text-[#4673eb] hover:underline"
            >
              Become a Driver
            </Link>{' '}
            •{' '}
            <Link
              to="/driver/login"
              className="font-medium text-[#4d5a83] hover:text-[#080e2b] hover:underline"
            >
              Driver Login
            </Link>{' '}
            •{' '}
            <Link
              to="/driver/application-status"
              className="font-medium text-[#4d5a83] hover:text-[#080e2b] hover:underline"
            >
              Check Status
            </Link>
          </p>
        </div>
      </div>
    </OrbitAuthLayout>
  );
}

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Phone,
  Truck,
  User,
} from 'lucide-react';
import { z } from 'zod';
import { ApiError, registerUser } from '@/api/client';
import {
  OrbitArrow,
  OrbitAuthLayout,
} from '@/components/auth/OrbitAuthLayout';
import { cn } from '@/lib/cn';
import { useAuthStore } from '@/stores/authStore';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .optional()
    .refine(
      (val) => !val || val.length >= 8,
      'Phone must be at least 8 digits'
    ),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  role: z.enum(['SHIPPER', 'DRIVER']),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { setSession } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      password: '',
      role: 'SHIPPER',
    },
  });

  const selectedRole = useWatch({ control, name: 'role' });

  const onSubmit = async (values: RegisterFormValues) => {
    setServerError(null);
    try {
      const res = await registerUser({
        ...values,
        phone: values.phone || undefined,
      });
      setSession({
        user: res.user,
        accessToken: res.accessToken,
        refreshToken: res.refreshToken,
      });
      navigate(res.user.role === 'SHIPPER' ? '/shipper/profile' : '/driver', {
        replace: true,
      });
    } catch (error) {
      setServerError(
        error instanceof ApiError
          ? error.message
          : 'Unable to register right now.'
      );
    }
  };

  return (
    <OrbitAuthLayout
      headerCtaLabel="Sign in"
      headerCtaTo="/login"
      eyebrow="Crowd-Pooled Onboarding"
      headlineLines={['Join the', 'shared freight', 'corridor.']}
      description="Create a shipper or driver account in moments. Recipients never need an account — they track deliveries via secure tokenized links."
    >
      <div className="space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#7a94df]">
              Get Started
            </p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-0.03em] text-[#080e2b]">
              Create MeeCargo Account
            </h2>
          </div>
          <span className="inline-flex shrink-0 items-center rounded-full border border-[#dce5fa] bg-[#eef3ff] px-3 py-1 text-[11px] font-medium text-[#4673eb]">
            Free Setup
          </span>
        </div>

        {serverError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {serverError}
          </div>
        ) : null}

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-[#4d5a83]">
              Account Role
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => setValue('role', 'SHIPPER')}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-2 rounded-2xl border px-3.5 py-3 text-sm font-medium transition',
                  selectedRole === 'SHIPPER'
                    ? 'border-[#4773ec] bg-[#eef3ff] text-[#4673eb] shadow-2xs'
                    : 'border-[#dce5fa] bg-[#f8faff] text-[#4d5a83] hover:border-[#c9d7f5] hover:bg-white'
                )}
              >
                <Building2 className="h-4 w-4" />
                Shipper
              </button>
              <button
                type="button"
                onClick={() => setValue('role', 'DRIVER')}
                className={cn(
                  'flex cursor-pointer items-center justify-center gap-2 rounded-2xl border px-3.5 py-3 text-sm font-medium transition',
                  selectedRole === 'DRIVER'
                    ? 'border-[#4773ec] bg-[#eef3ff] text-[#4673eb] shadow-2xs'
                    : 'border-[#dce5fa] bg-[#f8faff] text-[#4d5a83] hover:border-[#c9d7f5] hover:bg-white'
                )}
              >
                <Truck className="h-4 w-4" />
                Driver
              </button>
            </div>
            {selectedRole === 'DRIVER' ? (
              <div className="mt-2.5 space-y-1 rounded-2xl border border-[#c9d7f5] bg-[#eef3ff]/75 px-3.5 py-2.5 text-[11px] leading-relaxed text-[#2c3b68]">
                <p>
                  Public driver registration creates a Tier 2 Marketplace
                  applicant account (reviewed by Platform Owner).
                </p>
                <p>
                  Ready with your vehicle specs &amp; documents?{' '}
                  <Link
                    to="/driver/apply"
                    className="font-semibold text-[#4673eb] underline"
                  >
                    Complete full Tier 2 application here
                  </Link>
                  .
                </p>
              </div>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="register-name"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Full name
            </label>
            <div className="relative">
              <User className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="register-name"
                type="text"
                autoComplete="name"
                {...register('name')}
                placeholder="Kiran Patel"
                className="w-full rounded-2xl border border-[#dce5fa] bg-[#f8faff] py-3 pl-10 pr-4 text-sm text-[#080e2b] placeholder:text-[#94a7d1] transition focus:border-[#4773ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4773ec]/10"
              />
            </div>
            {errors.name ? (
              <p className="mt-1.5 text-xs text-rose-600">{errors.name.message}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="register-email"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Email address
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="register-email"
                type="email"
                autoComplete="email"
                {...register('email')}
                placeholder="ops@business.in"
                className="w-full rounded-2xl border border-[#dce5fa] bg-[#f8faff] py-3 pl-10 pr-4 text-sm text-[#080e2b] placeholder:text-[#94a7d1] transition focus:border-[#4773ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4773ec]/10"
              />
            </div>
            {errors.email ? (
              <p className="mt-1.5 text-xs text-rose-600">{errors.email.message}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="register-phone"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Phone number{' '}
              <span className="font-normal text-[#7a87aa]">
                (optional for shipper, recommended for driver)
              </span>
            </label>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="register-phone"
                type="tel"
                autoComplete="tel"
                {...register('phone')}
                placeholder="+919800000101"
                className="w-full rounded-2xl border border-[#dce5fa] bg-[#f8faff] py-3 pl-10 pr-4 text-sm text-[#080e2b] placeholder:text-[#94a7d1] transition focus:border-[#4773ec] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#4773ec]/10"
              />
            </div>
            {errors.phone ? (
              <p className="mt-1.5 text-xs text-rose-600">{errors.phone.message}</p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="register-password"
              className="mb-1.5 block text-xs font-medium text-[#4d5a83]"
            >
              Password{' '}
              <span className="font-normal text-[#7a87aa]">
                (minimum 8 characters)
              </span>
            </label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7a94df]" />
              <input
                id="register-password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
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
            {isSubmitting ? 'Creating account…' : 'Create account'}
            <OrbitArrow />
          </button>
        </form>

        <p className="border-t border-[#e8eefc] pt-4 text-center text-sm text-[#5c6b94]">
          Already registered?{' '}
          <Link
            to="/login"
            className="font-semibold text-[#4673eb] hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </OrbitAuthLayout>
  );
}

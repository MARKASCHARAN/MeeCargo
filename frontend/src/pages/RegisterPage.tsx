import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Truck, UserPlus } from 'lucide-react';
import { z } from 'zod';
import { ApiError, registerUser } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader } from '../components/ui/Card';
import { cn } from '../lib/cn';

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Full name is required').max(120),
  email: z.string().trim().email('Enter a valid email address'),
  phone: z
    .string()
    .trim()
    .optional()
    .refine((val) => !val || val.length >= 8, 'Phone must be at least 8 digits'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  role: z.enum(['SHIPPER', 'DRIVER']),
});

type RegisterFormValues = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { setSession } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const navigate = useNavigate();

  const {
    register,
    control,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: '', email: '', phone: '', password: '', role: 'SHIPPER' },
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
      navigate(res.user.role === 'SHIPPER' ? '/shipper/profile' : '/driver/profile', {
        replace: true,
      });
    } catch (error) {
      setServerError(
        error instanceof ApiError ? error.message : 'Unable to register right now.'
      );
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Truck className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-slate-900">MeeCargo</span>
      </Link>

      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-lg font-semibold text-slate-900">Create MeeCargo Account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Recipients do not need an account — they use secure tracking links.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {serverError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {serverError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                Account Role
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setValue('role', 'SHIPPER')}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer',
                    selectedRole === 'SHIPPER'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <Building2 className="h-4 w-4" />
                  Shipper
                </button>
                <button
                  type="button"
                  onClick={() => setValue('role', 'DRIVER')}
                  className={cn(
                    'flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer',
                    selectedRole === 'DRIVER'
                      ? 'border-emerald-600 bg-emerald-50 text-emerald-800'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  )}
                >
                  <Truck className="h-4 w-4" />
                  Driver
                </button>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Full name
              </label>
              <input
                type="text"
                {...register('name')}
                placeholder="Kiran Patel"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              />
              {errors.name ? (
                <p className="mt-1 text-xs text-rose-600">{errors.name.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Email address
              </label>
              <input
                type="email"
                {...register('email')}
                placeholder="ops@business.in"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              />
              {errors.email ? (
                <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Phone number (optional for shipper, recommended for driver)
              </label>
              <input
                type="tel"
                {...register('phone')}
                placeholder="+919800000101"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              />
              {errors.phone ? (
                <p className="mt-1 text-xs text-rose-600">{errors.phone.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Password (minimum 8 characters)
              </label>
              <input
                type="password"
                {...register('password')}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              />
              {errors.password ? (
                <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>
              ) : null}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              disabled={isSubmitting}
            >
              <UserPlus className="h-4 w-4" />
              {isSubmitting ? 'Creating account...' : 'Create account'}
            </Button>
          </form>

          <p className="text-center text-sm text-slate-600">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-emerald-700 hover:underline">
              Sign in
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

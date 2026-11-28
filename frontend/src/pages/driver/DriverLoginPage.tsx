import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { LogIn, Truck } from 'lucide-react';
import { z } from 'zod';
import { ApiError, loginUser } from '../../api/client';
import { useAuthStore } from '../../stores/authStore';
import { Button } from '../../components/ui/Button';
import { Card, CardContent, CardHeader } from '../../components/ui/Card';

const driverLoginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type DriverLoginFormValues = z.infer<typeof driverLoginSchema>;

export function DriverLoginPage() {
  const { setSession } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
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
        error instanceof ApiError ? error.message : 'Unable to sign in right now.'
      );
    }
  };

  const fillDemo = (email: string) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', 'Demo@1234', { shouldValidate: true });
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link to="/" className="mb-6 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-600 text-white">
          <Truck className="h-5 w-5" />
        </div>
        <span className="text-lg font-bold text-slate-900">MeeCargo Driver Portal</span>
      </Link>

      <Card className="w-full max-w-md">
        <CardHeader>
          <h1 className="text-lg font-semibold text-slate-900">Driver Portal Sign In</h1>
          <p className="mt-1 text-sm text-slate-500">
            For contracted Tier 1 drivers and approved Tier 2 marketplace drivers.
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
                Email Address
              </label>
              <input
                type="email"
                autoComplete="email"
                {...register('email')}
                placeholder="driver@meecargo.demo"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              />
              {errors.email ? (
                <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">
                Password
              </label>
              <input
                type="password"
                autoComplete="current-password"
                {...register('password')}
                placeholder="••••••••"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
              />
              {errors.password ? (
                <p className="mt-1 text-xs text-rose-600">{errors.password.message}</p>
              ) : null}
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={isSubmitting}
            >
              <LogIn className="h-4 w-4" />
              {isSubmitting ? 'Signing in...' : 'Sign in to Driver Portal'}
            </Button>
          </form>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">Demo Driver Accounts:</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fillDemo('driver1@meecargo.demo')}
              >
                Tier 1 Contract Driver
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fillDemo('driver2@meecargo.demo')}
              >
                Tier 2 Approved
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fillDemo('driver3@meecargo.demo')}
              >
                Tier 2 Pending
              </Button>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-slate-100 pt-3 text-center text-xs text-slate-600">
            <p>
              Want to drive your own vehicle on MeeCargo?{' '}
              <Link to="/become-a-driver" className="font-semibold text-emerald-700 hover:underline">
                Become a Tier 2 Driver
              </Link>{' '}
              or{' '}
              <Link to="/driver/apply" className="font-semibold text-emerald-700 hover:underline">
                Apply Now
              </Link>
            </p>
            <p>
              Already applied?{' '}
              <Link
                to="/driver/application-status"
                className="font-medium text-slate-800 hover:underline"
              >
                Check Application Status
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

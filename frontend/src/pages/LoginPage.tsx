import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { LogIn, Truck } from 'lucide-react';
import { z } from 'zod';
import { ApiError, loginUser } from '../api/client';
import { useAuthStore } from '../stores/authStore';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardContent, CardHeader } from '../components/ui/Card';

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginPage() {
  const { user, setSession, logout } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
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
      const defaultTarget = res.user.role === 'SHIPPER' ? '/shipper' : '/driver';
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
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900">Sign in to MeeCargo</h1>
            <Badge variant="info">Shipper & Driver</Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Access your shipper booking portal or driver execution PWA.
          </p>
        </CardHeader>

        <CardContent className="space-y-4">
          {user ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Currently signed in as <strong>{user.name}</strong> ({user.role}).
              <div className="mt-2 flex gap-2">
                <Link to={user.role === 'SHIPPER' ? '/shipper' : '/driver'}>
                  <Button size="sm" variant="primary">
                    Continue to portal
                  </Button>
                </Link>
                <Button size="sm" variant="outline" onClick={logout}>
                  Sign out
                </Button>
              </div>
            </div>
          ) : null}

          {serverError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {serverError}
            </div>
          ) : null}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Email address
              </label>
              <input
                type="email"
                {...register('email')}
                placeholder="you@company.in"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-emerald-600 focus:outline-none"
              />
              {errors.email ? (
                <p className="mt-1 text-xs text-rose-600">{errors.email.message}</p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">
                Password
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
              <LogIn className="h-4 w-4" />
              {isSubmitting ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-xs font-medium text-slate-600">
              Fill seeded demo credentials (requires running API + seeded DB):
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fillDemo('shipper1@meecargo.demo')}
              >
                Demo Shipper
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => fillDemo('driver1@meecargo.demo')}
              >
                Demo Driver
              </Button>
            </div>
          </div>

          <p className="text-center text-sm text-slate-600">
            New to MeeCargo?{' '}
            <Link to="/register" className="font-medium text-emerald-700 hover:underline">
              Create an account
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

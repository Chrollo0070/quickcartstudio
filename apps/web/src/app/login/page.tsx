'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { login } from '@/lib/api-client';
import { useAuthStore } from '@/lib/auth-store';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const loginFormSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});
type LoginForm = z.infer<typeof loginFormSchema>;

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuthStore((state) => state.setSession);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginFormSchema),
    defaultValues: { email: '', password: '' },
  });

  const loginMutation = useMutation({
    mutationFn: (values: LoginForm) => login(values.email, values.password),
    onSuccess: (result) => {
      setSession(result.accessToken, result.user);
      router.push('/catalogue');
    },
  });

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 pb-16">
      <h1 className="text-2xl font-semibold tracking-tight">Staff sign in</h1>
      <p className="mt-2 text-sm text-ink-2">
        QuickCart staff accounts (admin, manager, cashier, inventory) — customer checkout stays
        sign-in-light in a later phase.
      </p>
      <Card className="mt-6">
        <form
          className="flex flex-col gap-4"
          onSubmit={form.handleSubmit((values) => loginMutation.mutate(values))}
        >
          <div>
            <label htmlFor="email" className="mb-1 block text-sm font-medium text-zinc-700">
              Email
            </label>
            <Input
              id="email"
              type="email"
              autoComplete="username"
              placeholder="cashier@quickmart.dev"
              {...form.register('email')}
            />
            {form.formState.errors.email && (
              <p className="mt-1 text-sm text-[#b91c1c]">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm font-medium text-zinc-700">
              Password
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
            {form.formState.errors.password && (
              <p className="mt-1 text-sm text-[#b91c1c]">
                {form.formState.errors.password.message}
              </p>
            )}
          </div>
          {loginMutation.isError && (
            <p className="rounded-lg bg-[#fef2f2] px-3 py-2 text-sm text-[#b91c1c] ring-1 ring-inset ring-[#dc2626]/20">
              {loginMutation.error instanceof Error
                ? loginMutation.error.message
                : 'Sign-in failed. Check your credentials.'}
            </p>
          )}
          <Button type="submit" disabled={loginMutation.isPending} size="lg">
            {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </Card>
    </div>
  );
}

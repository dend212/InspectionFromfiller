export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-svh items-center justify-center bg-gradient-to-br from-background to-muted p-4">{children}</div>;
}

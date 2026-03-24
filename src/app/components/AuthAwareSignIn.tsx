"use client";

import Link from "next/link";
import { useMembership } from "../context/MembershipContext";

interface AuthAwareSignInProps {
  className?: string;
}

export function AuthAwareSignIn({ className }: AuthAwareSignInProps) {
  const { isSignedIn, authLoading } = useMembership();

  if (authLoading || isSignedIn) {
    return null;
  }

  return (
    <Link href="/login" className={className}>
      Sign In
    </Link>
  );
}

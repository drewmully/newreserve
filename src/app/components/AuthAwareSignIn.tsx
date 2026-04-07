"use client";

import Link from "next/link";
import { useMembership } from "../context/MembershipContext";

interface AuthAwareSignInProps {
  className?: string;
  dashboardHref?: string;
  signInHref?: string;
  dashboardLabel?: string;
  signInLabel?: string;
}

export function AuthAwareSignIn({
  className,
  dashboardHref = "/home",
  signInHref = "/login",
  dashboardLabel = "Dashboard",
  signInLabel = "Sign In",
}: AuthAwareSignInProps) {
  const { isSignedIn, authLoading } = useMembership();

  if (authLoading) {
    return null;
  }

  return (
    <Link href={isSignedIn ? dashboardHref : signInHref} className={className}>
      {isSignedIn ? dashboardLabel : signInLabel}
    </Link>
  );
}

"use client";

import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: "bg-accent text-white hover:bg-accent/90 disabled:bg-accent/40",
  secondary: "bg-panelAlt text-textPrimary border border-border hover:bg-border disabled:opacity-40",
  ghost: "bg-transparent text-textMuted hover:text-textPrimary hover:bg-panelAlt disabled:opacity-40",
  danger: "bg-red-600/90 text-white hover:bg-red-600 disabled:bg-red-600/40",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", className = "", ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    />
  );
});

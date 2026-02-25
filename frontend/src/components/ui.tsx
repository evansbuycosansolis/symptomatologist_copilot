"use client";

import Link from "next/link";
import type { PropsWithChildren } from "react";

export function Panel({
  title,
  subtitle,
  className = "",
  children,
}: PropsWithChildren<{ title?: string; subtitle?: string; className?: string }>) {
  return (
    <section className={`panel ${className}`.trim()}>
      {(title || subtitle) && (
        <header className="panel-header">
          {title ? <h2>{title}</h2> : null}
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
      )}
      {children}
    </section>
  );
}

export function PortalCard(props: {
  href: string;
  title: string;
  description: string;
  accent: string;
}) {
  return (
    <Link className="portal-card" href={props.href} style={{ ["--accent" as string]: props.accent }}>
      <div className="portal-card__bar" />
      <h3>{props.title}</h3>
      <p>{props.description}</p>
      <span className="portal-card__cta">Open workspace</span>
    </Link>
  );
}

export function SmallMeta({ children }: PropsWithChildren) {
  return <p className="small-meta">{children}</p>;
}


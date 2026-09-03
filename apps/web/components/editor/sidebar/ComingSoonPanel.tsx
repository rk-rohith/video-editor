export function ComingSoonPanel({ name, phase, note }: { name: string; phase: string; note?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-sm text-textMuted">
      <p className="font-medium text-textPrimary">{name}</p>
      <p className="mt-1">
        Not built yet — planned for <span className="text-textPrimary">{phase}</span> of the roadmap.
      </p>
      {note && <p className="mt-2 text-xs">{note}</p>}
    </div>
  );
}

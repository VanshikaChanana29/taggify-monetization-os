const dateTime = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function formatDateTime(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : "—";
}

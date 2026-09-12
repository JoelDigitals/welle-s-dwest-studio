import { BarChart3 } from "lucide-react";
import type { ListenerStats } from "@/lib/use-listener-stats";
import type { MediaRecord } from "@/lib/media-db";
import type { AdCampaign, NewsFeedItem, TrafficFeedItem } from "@/lib/broadcast-types";

const KIND_LABEL: Record<MediaRecord["kind"], string> = {
  music: "Musik",
  jingle: "Jingles",
  slogan: "Slogans",
  ad: "Werbespots",
  recording: "Aufnahmen",
};

function WeekdayLabel(dayKey: string) {
  const d = new Date(`${dayKey}T12:00:00`);
  return d.toLocaleDateString("de-DE", { weekday: "short" });
}

export function StatistikPanel({
  listenerStats,
  media,
  campaigns,
  news,
  traffic,
}: {
  listenerStats: ListenerStats | null;
  media: MediaRecord[];
  campaigns: AdCampaign[];
  news: NewsFeedItem[];
  traffic: TrafficFeedItem[];
}) {
  const byKind = (Object.keys(KIND_LABEL) as MediaRecord["kind"][]).map((kind) => ({
    kind,
    label: KIND_LABEL[kind],
    count: media.filter((m) => m.kind === kind).length,
  }));
  const activeCampaigns = campaigns.filter((c) => c.status === "freigegeben").length;
  const maxDayCount = Math.max(1, ...(listenerStats?.byDay.map((d) => d.count) ?? [0]));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="panel space-y-4 p-5">
        <h3 className="display flex items-center gap-2 text-xl">
          <BarChart3 className="size-5 text-primary" /> Zuhörer
        </h3>
        <dl className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">Live jetzt</dt>
            <dd className="display text-2xl">{listenerStats?.concurrent ?? "—"}</dd>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">Heute</dt>
            <dd className="display text-2xl">{listenerStats?.playsToday ?? "—"}</dd>
          </div>
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <dt className="text-xs uppercase tracking-widest text-muted-foreground">7 Tage</dt>
            <dd className="display text-2xl">{listenerStats?.playsLast7Days ?? "—"}</dd>
          </div>
        </dl>

        {listenerStats && listenerStats.byDay.length > 0 && (
          <div className="space-y-1.5 pt-2">
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Stream-Starts je Tag
            </p>
            {listenerStats.byDay.map((d) => (
              <div key={d.day} className="flex items-center gap-2">
                <span className="w-8 shrink-0 text-xs text-muted-foreground">
                  {WeekdayLabel(d.day)}
                </span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${Math.round((d.count / maxDayCount) * 100)}%` }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">
                  {d.count}
                </span>
              </div>
            ))}
          </div>
        )}
        {!listenerStats && (
          <p className="text-sm text-muted-foreground">Lädt …</p>
        )}
      </section>

      <section className="panel space-y-3 p-5">
        <h3 className="display text-xl">Inhalte</h3>
        <dl className="grid grid-cols-2 gap-2">
          {byKind.map((k) => (
            <div
              key={k.kind}
              className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2"
            >
              <dt className="text-sm text-muted-foreground">{k.label}</dt>
              <dd className="display text-lg">{k.count}</dd>
            </div>
          ))}
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <dt className="text-sm text-muted-foreground">Aktive Werbekampagnen</dt>
            <dd className="display text-lg">{activeCampaigns}</dd>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <dt className="text-sm text-muted-foreground">News im Feed</dt>
            <dd className="display text-lg">{news.length}</dd>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border bg-secondary/40 px-3 py-2">
            <dt className="text-sm text-muted-foreground">Verkehrsmeldungen</dt>
            <dd className="display text-lg">{traffic.length}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

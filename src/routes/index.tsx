import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Radio } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnAirBar } from "@/components/studio/OnAirBar";
import { QueuePanel } from "@/components/studio/QueuePanel";
import { AutopilotPanel } from "@/components/studio/AutopilotPanel";
import { TopicPreview } from "@/components/studio/TopicPreview";
import { LivePanel } from "@/components/studio/LivePanel";
import { NewsPanel } from "@/components/studio/NewsPanel";
import { NewsroomPanel } from "@/components/studio/NewsroomPanel";
import { LibraryPanel } from "@/components/studio/LibraryPanel";
import { HotlinePanel } from "@/components/studio/HotlinePanel";
import { DashboardPanel } from "@/components/studio/DashboardPanel";
import { OutputPanel } from "@/components/studio/OutputPanel";
import { ApprovalPanel } from "@/components/studio/ApprovalPanel";
import { StreamHealth } from "@/components/studio/StreamHealth";
import { AdRequestsPanel } from "@/components/studio/AdRequestsPanel";
import { useRadioEngine } from "@/lib/use-radio-engine";
import { useLiveBroadcast } from "@/lib/use-live-broadcast";
import { useMediaLibrary } from "@/lib/use-media-library";
import { useNewsFeed, useTrafficFeed } from "@/lib/use-feeds";
import { useHotline } from "@/lib/use-hotline";
import { useAdRequests } from "@/lib/use-ad-requests";
import { useFreeMusicPool } from "@/lib/use-free-music";
import { loadReports, saveReports } from "@/lib/reports";
import { loadCampaigns, loadLiveSlots, saveCampaigns, saveLiveSlots } from "@/lib/studio-store";
import type { AdCampaign, LiveSlot, PlanItem, Report } from "@/lib/broadcast-types";

const TITLE = "Welle Südwest – Radiostudio für Saarland & Rheinland-Pfalz";
const DESCRIPTION =
  "Sendestudio mit Autopilot, Live-Mischpult, KI-Moderation, Nachrichten aus Saarland, Rheinland-Pfalz und der Welt sowie Verkehrsmeldungen.";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
    ],
  }),
  component: Index,
});

function Index() {
  const library = useMediaLibrary();
  const newsQuery = useNewsFeed();
  const trafficQuery = useTrafficFeed();
  const hotlineQuery = useHotline();
  const adRequestsQuery = useAdRequests();
  const freeMusicQuery = useFreeMusicPool();
  const [reports, setReports] = useState<Report[]>([]);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [liveSlots, setLiveSlots] = useState<LiveSlot[]>([]);
  const [approvalRequired, setApprovalRequired] = useState(false);

  useEffect(() => {
    setReports(loadReports());
    setCampaigns(loadCampaigns());
    setLiveSlots(loadLiveSlots());
  }, []);

  const addReport = useCallback((r: Omit<Report, "id" | "createdAt">) => {
    setReports((prev) => {
      const next = [{ ...r, id: `r${Date.now()}`, createdAt: Date.now() }, ...prev];
      saveReports(next);
      return next;
    });
  }, []);
  const removeReport = useCallback((id: string) => {
    setReports((prev) => {
      const next = prev.filter((r) => r.id !== id);
      saveReports(next);
      return next;
    });
  }, []);

  const updateCampaigns = useCallback((fn: (prev: AdCampaign[]) => AdCampaign[]) => {
    setCampaigns((prev) => {
      const next = fn(prev);
      saveCampaigns(next);
      return next;
    });
  }, []);
  // Werbe-Bewerbungen laufen serverseitig über /api/public/ad-requests, damit die autonome
  // Sende-Engine (läuft unabhängig vom Studio-Tab) freigegebene Werbung auch wirklich kennt.
  const addCampaign = useCallback(
    async (c: Omit<AdCampaign, "id" | "createdAt" | "status">) => {
      const fallback: AdCampaign = {
        ...c,
        id: `ad${Date.now()}`,
        createdAt: Date.now(),
        status: "eingereicht",
      };
      try {
        const res = await fetch("/api/public/ad-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(c),
        });
        const data = (await res.json().catch(() => null)) as { campaign?: AdCampaign } | null;
        const campaign = res.ok && data?.campaign ? data.campaign : fallback;
        updateCampaigns((prev) => [campaign, ...prev]);
      } catch {
        updateCampaigns((prev) => [fallback, ...prev]);
      }
    },
    [updateCampaigns],
  );
  const setCampaignStatus = useCallback(
    (id: string, status: AdCampaign["status"]) => {
      updateCampaigns((prev) => prev.map((c) => (c.id === id ? { ...c, status } : c)));
      void fetch("/api/public/ad-requests", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      }).catch(() => undefined);
    },
    [updateCampaigns],
  );
  const removeCampaign = useCallback(
    (id: string) => {
      updateCampaigns((prev) => prev.filter((c) => c.id !== id));
      void fetch(`/api/public/ad-requests?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      }).catch(() => undefined);
    },
    [updateCampaigns],
  );

  // Öffentlich eingereichte Werbe-Bewerbungen (/werbung) in die Studio-Liste übernehmen,
  // ohne bereits bearbeitete (freigegeben/abgelehnt) lokale Einträge zu überschreiben.
  useEffect(() => {
    const incoming = adRequestsQuery.data?.items ?? [];
    if (!incoming.length) return;
    updateCampaigns((prev) => {
      const knownIds = new Set(prev.map((c) => c.id));
      const fresh = incoming.filter((c) => !knownIds.has(c.id));
      return fresh.length ? [...fresh, ...prev] : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adRequestsQuery.data]);

  const updateLive = useCallback((fn: (prev: LiveSlot[]) => LiveSlot[]) => {
    setLiveSlots((prev) => {
      const next = fn(prev);
      saveLiveSlots(next);
      return next;
    });
  }, []);
  const addLiveSlot = useCallback(
    (s: Omit<LiveSlot, "id">) => updateLive((prev) => [...prev, { ...s, id: `ls${Date.now()}` }]),
    [updateLive],
  );
  const removeLiveSlot = useCallback(
    (id: string) => updateLive((prev) => prev.filter((s) => s.id !== id)),
    [updateLive],
  );

  const news = newsQuery.data?.items ?? [];
  const traffic = trafficQuery.data?.items ?? [];
  const hotline = hotlineQuery.data?.items ?? [];
  const freeMusic = freeMusicQuery.data ?? [];
  const musicCount = library.media.filter((m) => m.kind === "music").length;

  const e = useRadioEngine({
    media: library.media,
    news,
    traffic,
    reports,
    hotline,
    freeMusic,
    adCampaigns: campaigns,
    liveSlots,
    approvalRequired,
  });

  // Was wirklich gesendet wird, kommt von der autonomen Server-Engine – nicht aus der lokalen
  // Simulation oben. OnAirBar zeigt und spielt damit exakt das, was auch der Webplayer zeigt.
  const live = useLiveBroadcast();
  const liveCurrent = live.nowPlaying?.uid
    ? {
        kind: live.nowPlaying.kind ?? "music",
        title: live.nowPlaying.title ?? "",
        subtitle: live.nowPlaying.subtitle ?? "",
        duration: live.nowPlaying.duration,
      }
    : null;

  // Echte Timeline statt lokaler Simulation: dieselbe Liste, die auch tatsächlich gesendet wird.
  const livePlan: PlanItem[] = live.nowPlaying?.uid
    ? [
        {
          uid: live.nowPlaying.uid,
          kind: (live.nowPlaying.kind ?? "music") as PlanItem["kind"],
          title: live.nowPlaying.title ?? "",
          subtitle: live.nowPlaying.subtitle ?? "",
          duration: live.nowPlaying.duration,
          introSeconds: live.nowPlaying.introSeconds,
          plannedAt: live.nowPlaying.startedAt ?? Date.now(),
          status: "ready",
        },
        ...live.nowPlaying.next.map((i): PlanItem => ({
          uid: i.uid,
          kind: i.kind as PlanItem["kind"],
          title: i.title,
          subtitle: i.subtitle,
          duration: i.duration,
          introSeconds: i.introSeconds,
          plannedAt: i.plannedAt,
          status: "ready",
        })),
      ]
    : [];

  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 md:px-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Radio className="size-7 text-primary" />
          <div>
            <h1 className="display text-3xl leading-none md:text-4xl">Welle Südwest</h1>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Saarland · Rheinland-Pfalz · Welt
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <span className="rounded-full border border-border px-3 py-1">
            {musicCount} Titel in der Bibliothek
          </span>
          <span className="rounded-full border border-border px-3 py-1">{news.length} News</span>
          <span className="rounded-full border border-border px-3 py-1">
            {traffic.length} Verkehr
          </span>
          <span className="rounded-full border border-border px-3 py-1">News :00 · :30</span>
        </div>
      </header>

      <OnAirBar
        current={liveCurrent}
        elapsed={live.elapsed}
        playing={live.playing}
        live={e.live}
        speaking={e.speaking}
        onToggle={() => live.setPlaying((p) => !p)}
        onNext={() => void live.skip()}
      />

      {e.ttsError && (
        <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {e.ttsError}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Tabs defaultValue="autopilot">
          <TabsList className="flex h-auto flex-wrap justify-start gap-1">
            <TabsTrigger value="autopilot">Autopilot</TabsTrigger>
            <TabsTrigger value="live">Livesendung</TabsTrigger>
            <TabsTrigger value="newsroom">Newsroom</TabsTrigger>
            <TabsTrigger value="redaktion">Nachrichten & Verkehr</TabsTrigger>
            <TabsTrigger value="werbung">Werbung</TabsTrigger>
            <TabsTrigger value="freigabe">Freigabe</TabsTrigger>
            <TabsTrigger value="hotline">Hotline</TabsTrigger>
            <TabsTrigger value="bibliothek">Bibliothek</TabsTrigger>
            <TabsTrigger value="monitor">Monitor</TabsTrigger>
            <TabsTrigger value="ausgabe">Ausgabe</TabsTrigger>
          </TabsList>

          <TabsContent value="autopilot" className="mt-4 space-y-4">
            <section className="panel space-y-2 p-5">
              <h3 className="display text-xl">Sendeablauf</h3>
              <p className="text-sm text-muted-foreground">
                Nachrichten laufen sekundengenau: Anmoderation mit Themenüberblick, Trenner, dann
                der ausführliche Block – zur vollen Stunde lang, zur halben Stunde kompakt. Danach
                folgt ein gemeinsamer Verkehrsblock für Saarland und Rheinland-Pfalz, bei Unfällen
                oder Sperrungen zusätzlich eine wichtige Meldung. Vergangene Elemente verschwinden
                automatisch aus dem Plan, Werbung läuft nur nach freigegebener Bewerbung.
              </p>
            </section>
            <AutopilotPanel
              autopilot={e.autopilot}
              setAutopilot={e.setAutopilot}
              totalPlanned={e.totalPlanned}
              planCount={e.plan.length}
              readyCount={e.readyCount}
              regenerate={() => e.regenerate()}
              extendPlan={e.extendPlan}
              clearPlan={e.clearPlan}
              prunePast={e.prunePast}
            />
            <div className="mt-4">
              <TopicPreview plan={e.plan} />
            </div>
          </TabsContent>

          <TabsContent value="live" className="mt-4">
            <LivePanel
              live={e.live}
              setLive={e.setLive}
              micOn={e.micOn}
              setMicOn={e.setMicOn}
              micLevel={e.micLevel}
              musicVolume={e.musicVolume}
              setMusicVolume={e.setMusicVolume}
              voiceVolume={e.voiceVolume}
              setVoiceVolume={e.setVoiceVolume}
              playNow={e.playNow}
              cueNext={e.cueNext}
              media={library.media}
              traffic={traffic}
              liveSlots={liveSlots}
              addLiveSlot={addLiveSlot}
              removeLiveSlot={removeLiveSlot}
              plan={e.plan}
              reorder={e.reorder}
              remove={e.remove}
              fallbackEnabled={e.fallbackEnabled}
              setFallbackEnabled={e.setFallbackEnabled}
            />
          </TabsContent>

          <TabsContent value="newsroom" className="mt-4">
            <NewsroomPanel
              news={news}
              traffic={traffic}
              hotline={hotline}
              reports={reports}
              refetch={() => {
                void newsQuery.refetch();
                void trafficQuery.refetch();
                void hotlineQuery.refetch();
              }}
              playNow={e.playNow}
              cueNext={e.cueNext}
            />
          </TabsContent>

          <TabsContent value="redaktion" className="mt-4">
            <NewsPanel
              playNow={e.playNow}
              cueNext={e.cueNext}
              news={news}
              traffic={traffic}
              newsError={newsQuery.error instanceof Error ? newsQuery.error.message : null}
              trafficError={trafficQuery.error instanceof Error ? trafficQuery.error.message : null}
              refetch={() => {
                void newsQuery.refetch();
                void trafficQuery.refetch();
              }}
              reports={reports}
              addReport={addReport}
              removeReport={removeReport}
            />
          </TabsContent>

          <TabsContent value="werbung" className="mt-4">
            <AdRequestsPanel
              campaigns={campaigns}
              add={addCampaign}
              setStatus={setCampaignStatus}
              remove={removeCampaign}
            />
          </TabsContent>

          <TabsContent value="freigabe" className="mt-4">
            <ApprovalPanel
              plan={e.plan}
              approvalRequired={approvalRequired}
              setApprovalRequired={setApprovalRequired}
              approve={e.approve}
              approveAll={e.approveAll}
            />
          </TabsContent>

          <TabsContent value="hotline" className="mt-4">
            <HotlinePanel playNow={e.playNow} cueNext={e.cueNext} />
          </TabsContent>

          <TabsContent value="bibliothek" className="mt-4">
            <LibraryPanel
              media={library.media}
              error={library.error}
              upload={library.upload}
              addOnline={library.addOnline}
              remove={library.remove}
            />
          </TabsContent>

          <TabsContent value="monitor" className="mt-4 space-y-4">
            <DashboardPanel
              log={e.log}
              outputLevel={e.outputLevel}
              micLevel={e.micLevel}
              playing={e.playing}
              live={e.live}
              current={e.current}
              planCount={e.plan.length}
              readyCount={e.readyCount}
              totalPlanned={e.totalPlanned}
            />
            <StreamHealth onLog={e.addLog} />
          </TabsContent>

          <TabsContent value="ausgabe" className="mt-4">
            <OutputPanel current={liveCurrent} />
          </TabsContent>
        </Tabs>

        <QueuePanel queue={livePlan} onRemove={() => {}} readOnly />
      </div>
    </main>
  );
}

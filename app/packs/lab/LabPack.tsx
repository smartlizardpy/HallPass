"use client";

/**
 * DEV-ONLY: the pack on its own, for judging the foil and the tear without
 * the flow around it: `?view=pack&id=<catalogue pack id>`. To see the DOM
 * fallback, use a browser with WebGL turned off.
 */

import Link from "next/link";
import { useRef, useState } from "react";
import { getPack } from "@/app/lib/collectibles/catalogue";
import { seedOf } from "@/app/components/collectibles/opening/noise";
import { PackStage, type PackStageHandle } from "@/app/components/collectibles/opening/pack/PackStage";

const IDS = ["ff26-participation", "ff26-overall-winner", "hpo-standard", "inet-standard", "brr-standard", "tr-standard"];

export function LabPack({ id }: { id: string }) {
  const stage = useRef<PackStageHandle>(null);
  const [log, setLog] = useState<string[]>([]);
  const [renderer, setRenderer] = useState("…");
  const [round, setRound] = useState(0);
  const note = (s: string) => setLog((l) => [...l.slice(-5), s]);
  const pack = getPack(id);
  if (!pack) return <p>Unknown pack {id}</p>;

  return (
    <section className="hc-root" style={{ display: "grid", justifyItems: "center", gap: 16, padding: "24px 0" }}>
      <nav style={{ display: "flex", flexWrap: "wrap", gap: 12, fontSize: 14 }}>
        {IDS.map((p) => (
          <Link key={p} href={`/packs/lab?view=pack&id=${p}`} style={{ textDecoration: p === id ? "underline" : "none" }}>
            {p}
          </Link>
        ))}
      </nav>
      <div style={{ ["--ho-pack-w" as string]: "min(300px, 72vw)", padding: "40px 0" }}>
        <PackStage
          key={round}
          ref={stage}
          packId={id}
          seed={seedOf(`lab-${id}-${round}`)}
          interactive
          reducedMotion={false}
          label={`${pack.name}. Drag across the top to tear it open, or press Enter.`}
          onTearStart={() => note("tear start")}
          onTearAdvance={() => {}}
          onTearSettle={() => note("tear settled back")}
          onCommit={() => {
            note("COMMIT");
            window.setTimeout(() => stage.current?.loosen(true), 700);
          }}
          onHandle={() => {}}
          onRenderer={(k) => setRenderer(k)}
        />
      </div>
      <p style={{ fontSize: 13, opacity: 0.8 }} data-testid="lab-renderer">
        renderer: {renderer}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" onClick={() => stage.current?.autoTear()}>
          Auto tear
        </button>
        <button type="button" onClick={() => stage.current?.loosen(true)}>
          Loosen
        </button>
        <button type="button" onClick={() => stage.current?.tug(1)}>
          Tug
        </button>
        <button type="button" onClick={() => void stage.current?.dropAway()}>
          Drop away
        </button>
        <button type="button" onClick={() => stage.current?.reset()}>
          Reset
        </button>
        <button type="button" onClick={() => setRound((r) => r + 1)}>
          New seed
        </button>
      </div>
      <pre style={{ fontSize: 12, opacity: 0.7, minHeight: 80 }}>{log.join("\n")}</pre>
    </section>
  );
}

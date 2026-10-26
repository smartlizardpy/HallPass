"use client";

/**
 * A sealed pack, drawn in its collection's wrapper: a crimped prize bag, a hall
 * pass tag, a browser sleeve, a snack sachet or a tea box. CSS around the
 * collection's pixel emblem; no images besides the emblem, no WebGL.
 *
 * The seal is its own element (`.hp-pack-seal`) so the opening flow can tear
 * it away; `sealStyle` lets it move the strip. `tilt` lets the pointer turn the
 * pack (±degrees) and moves the foil; reduced motion keeps it still.
 */

import "./collectibles.css";
import { useRef, type CSSProperties, type Ref } from "react";
import { getPack, packEmblemSrc } from "@/app/lib/collectibles/catalogue";
import { useHolo } from "./useHolo";

export function PackArt({
  packId,
  size = "md",
  tilt = 0,
  sealStyle,
  sealRef,
  decorative = false,
}: {
  packId: string;
  size?: "sm" | "md";
  tilt?: number;
  sealStyle?: CSSProperties;
  sealRef?: Ref<HTMLDivElement>;
  decorative?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useHolo(ref, { enabled: tilt > 0, tilt });
  const pack = getPack(packId);
  if (!pack) return null;
  return (
    <div
      ref={ref}
      className="hc-root hp-pack"
      data-wrapper={pack.wrapper}
      data-collection={pack.collection}
      data-size={size}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : `${pack.name}, sealed`}
      aria-hidden={decorative || undefined}
    >
      <div className="hp-pack-body">
        {/* eslint-disable-next-line @next/next/no-img-element -- pixel emblem at a whole-number scale */}
        <img className="hp-pack-emblem" src={packEmblemSrc(pack.collection)} alt="" width={48} height={48} draggable={false} />
        <span className="hp-pack-name">{pack.name}</span>
        <span className="hp-pack-foil" aria-hidden="true" />
      </div>
      <div className="hp-pack-seal" ref={sealRef} style={sealStyle} />
    </div>
  );
}

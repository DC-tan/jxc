"use client";

import type { CSSProperties, ReactNode } from "react";
import { useCallback, useRef, useState } from "react";
import type { PartyASealConfig } from "@/lib/purchase-template-visual";

const imgBase: CSSProperties = {
  position: "absolute",
  objectFit: "contain",
  zIndex: 4,
  userSelect: "none",
  touchAction: "none",
};

export function PartyAFooterSealOverlay({
  seal,
  onSealOffsetChange,
  textMinHeight,
  children,
}: {
  seal: PartyASealConfig;
  /** 传入后在合同区拖动印章，松手后写入模板 */
  onSealOffsetChange?: (offset: { offsetXPx: number; offsetYPx: number }) => void;
  /** 覆盖区域最小高度，便于把章拖到字下方仍有空间 */
  textMinHeight?: number;
  children: ReactNode;
}) {
  const url = seal.imageUrl?.trim();
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
  } | null>(null);
  const [delta, setDelta] = useState({ dx: 0, dy: 0 });
  const [dragging, setDragging] = useState(false);

  const clamp = useCallback((x: number, y: number) => {
    return {
      offsetXPx: Math.round(Math.min(900, Math.max(-400, x))),
      offsetYPx: Math.round(Math.min(500, Math.max(-250, y))),
    };
  }, []);

  const left = seal.offsetXPx + delta.dx;
  const top = seal.offsetYPx + delta.dy;

  const commitDrag = useCallback(
    (clientX: number, clientY: number) => {
      const d = dragRef.current;
      if (!d || !onSealOffsetChange) return;
      const nx = d.origX + (clientX - d.startClientX);
      const ny = d.origY + (clientY - d.startClientY);
      onSealOffsetChange(clamp(nx, ny));
    },
    [clamp, onSealOffsetChange],
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
    setDelta({ dx: 0, dy: 0 });
    setDragging(false);
  }, []);

  if (!url) {
    return <>{children}</>;
  }

  const interactive = Boolean(onSealOffsetChange);

  return (
    <div
      style={{
        position: "relative",
        overflow: "visible",
        minHeight: textMinHeight,
      }}
    >
      <div style={{ position: "relative", zIndex: 1 }}>{children}</div>
      <img
        src={url}
        alt=""
        draggable={false}
        onPointerDown={(e) => {
          if (!interactive) return;
          e.preventDefault();
          e.stopPropagation();
          dragRef.current = {
            pointerId: e.pointerId,
            startClientX: e.clientX,
            startClientY: e.clientY,
            origX: seal.offsetXPx,
            origY: seal.offsetYPx,
          };
          setDelta({ dx: 0, dy: 0 });
          setDragging(true);
          (e.currentTarget as HTMLImageElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!interactive || !dragRef.current || dragRef.current.pointerId !== e.pointerId) {
            return;
          }
          setDelta({
            dx: e.clientX - dragRef.current.startClientX,
            dy: e.clientY - dragRef.current.startClientY,
          });
        }}
        onPointerUp={(e) => {
          if (!interactive || !dragRef.current || dragRef.current.pointerId !== e.pointerId) {
            return;
          }
          try {
            (e.currentTarget as HTMLImageElement).releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          commitDrag(e.clientX, e.clientY);
          endDrag();
        }}
        onPointerCancel={(e) => {
          if (!interactive || !dragRef.current || dragRef.current.pointerId !== e.pointerId) {
            return;
          }
          try {
            (e.currentTarget as HTMLImageElement).releasePointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          /* 取消拖动，不写入新坐标 */
          endDrag();
        }}
        style={{
          ...imgBase,
          left,
          top,
          width: seal.widthPx,
          height: "auto",
          cursor: interactive ? (dragging ? "grabbing" : "grab") : "default",
          pointerEvents: interactive ? "auto" : "none",
        }}
      />
    </div>
  );
}

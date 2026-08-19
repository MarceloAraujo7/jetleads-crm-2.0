'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ZoomIn } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const VIEWPORT = 260;
const OUTPUT_SIZE = 512;

interface Point {
  x: number;
  y: number;
}

interface AvatarCropDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The just-picked file to crop. */
  file: File | null;
  /** Fires with the cropped square PNG once the user confirms. */
  onCropped: (blob: Blob) => void;
}

/**
 * Minimal drag-to-reposition + zoom cropper — no external cropping
 * library, just a covered image inside a fixed square viewport. The
 * image always fully covers the viewport (cover-fit at zoom=1, more
 * at higher zoom), so drag offsets only ever need clamping, never
 * letterboxing logic.
 */
export function AvatarCropDialog({
  open,
  onOpenChange,
  file,
  onCropped,
}: AvatarCropDialogProps) {
  const t = useTranslations('Settings.profile');
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{
    w: number;
    h: number;
  } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origin: Point;
  } | null>(null);

  // Derived from the prop during render (not an effect) — File →
  // object URL is a pure, synchronous browser API call, no need to
  // route it through setState-in-effect. Revocation is the one actual
  // side effect, handled below.
  const imgSrc = useMemo(
    () => (open && file ? URL.createObjectURL(file) : null),
    [open, file]
  );
  useEffect(() => {
    return () => {
      if (imgSrc) URL.revokeObjectURL(imgSrc);
    };
  }, [imgSrc]);

  function clamp(
    next: Point,
    size: { w: number; h: number },
    z: number
  ): Point {
    const baseScale = Math.max(VIEWPORT / size.w, VIEWPORT / size.h);
    const scale = baseScale * z;
    const dw = size.w * scale;
    const dh = size.h * scale;
    const minX = VIEWPORT - dw;
    const minY = VIEWPORT - dh;
    return {
      x: Math.min(0, Math.max(minX, next.x)),
      y: Math.min(0, Math.max(minY, next.y)),
    };
  }

  function onImgLoad() {
    const el = imgRef.current;
    if (!el) return;
    const size = { w: el.naturalWidth, h: el.naturalHeight };
    setNaturalSize(size);
    setZoom(1);
    const baseScale = Math.max(VIEWPORT / size.w, VIEWPORT / size.h);
    const dw = size.w * baseScale;
    const dh = size.h * baseScale;
    setOffset({ x: (VIEWPORT - dw) / 2, y: (VIEWPORT - dh) / 2 });
  }

  function onPointerDown(e: React.PointerEvent) {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, origin: offset };
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current || !naturalSize) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const next = {
      x: dragRef.current.origin.x + dx,
      y: dragRef.current.origin.y + dy,
    };
    setOffset(clamp(next, naturalSize, zoom));
  }

  function onPointerUp() {
    dragRef.current = null;
  }

  function onZoomChange(next: number) {
    if (!naturalSize) return;
    setZoom(next);
    setOffset((prev) => clamp(prev, naturalSize, next));
  }

  const handleApply = useCallback(() => {
    const el = imgRef.current;
    if (!el || !naturalSize) return;
    const baseScale = Math.max(
      VIEWPORT / naturalSize.w,
      VIEWPORT / naturalSize.h
    );
    const scale = baseScale * zoom;
    const sourceX = -offset.x / scale;
    const sourceY = -offset.y / scale;
    const sourceSize = VIEWPORT / scale;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(
      el,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      OUTPUT_SIZE,
      OUTPUT_SIZE
    );
    canvas.toBlob((blob) => {
      if (blob) onCropped(blob);
    }, 'image/png');
  }, [naturalSize, zoom, offset, onCropped]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-popover border-border text-popover-foreground sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            {t('cropTitle')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {t('cropDesc')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4">
          <div
            className="border-border bg-muted relative touch-none overflow-hidden rounded-full border select-none"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
          >
            {imgSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={imgRef}
                src={imgSrc}
                alt=""
                onLoad={onImgLoad}
                draggable={false}
                className="pointer-events-none absolute top-0 left-0 max-w-none cursor-move"
                style={
                  naturalSize
                    ? {
                        width:
                          naturalSize.w *
                          Math.max(
                            VIEWPORT / naturalSize.w,
                            VIEWPORT / naturalSize.h
                          ) *
                          zoom,
                        height:
                          naturalSize.h *
                          Math.max(
                            VIEWPORT / naturalSize.w,
                            VIEWPORT / naturalSize.h
                          ) *
                          zoom,
                        transform: `translate(${offset.x}px, ${offset.y}px)`,
                      }
                    : undefined
                }
              />
            )}
          </div>

          <div className="flex w-full items-center gap-3">
            <ZoomIn className="text-muted-foreground size-4 shrink-0" />
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => onZoomChange(Number(e.target.value))}
              className="accent-primary w-full"
            />
          </div>
        </div>

        <DialogFooter className="bg-popover border-border">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            {t('cancel')}
          </Button>
          <Button type="button" onClick={handleApply} disabled={!naturalSize}>
            {t('cropApply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

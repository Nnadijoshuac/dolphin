"use node";

import { ConvexError, v } from "convex/values";
import { Jimp } from "jimp";

import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action } from "./_generated/server";
import {
  MAX_ICON_SIDE,
  MAX_ICON_UPLOAD_BYTES,
  MIN_ICON_SIDE,
  STORED_JPEG_QUALITY,
  STORED_JPEG_SIDE,
  STORED_PNG_SIDE,
  sniffIconType,
} from "./lib/iconPolicy";

/**
 * AN UPLOADED ICON, CHECKED AND REDRAWN. (2026-09-26)
 *
 * The browser uploads the raw file to Convex storage (builtAgents.iconUploadUrl),
 * then calls this. Every step refuses rather than repairs, and the raw upload
 * is deleted whatever the outcome - it is never served:
 *
 *   1. signed-in wallet, under its daily limit
 *   2. size under MAX_ICON_UPLOAD_BYTES, before reading a byte of it
 *   3. the first bytes say PNG or JPEG (lib/iconPolicy.ts) - not the name
 *   4. it decodes as that image, within the side limits
 *   5. it is REDRAWN: resized, re-encoded from pixels. Metadata, appended
 *      files and anything else in the upload do not survive. Opaque icons
 *      become JPEG, transparent ones PNG.
 *
 * Node runtime because jimp, the image library, needs Buffer. It is pure
 * JavaScript (no native binaries), MIT, added 2026-09-26 for this.
 */
export const process = action({
  args: { sessionToken: v.string(), storageId: v.id("_storage") },
  handler: async (ctx, { sessionToken, storageId }): Promise<{ iconId: Id<"_storage">; url: string | null; contentType: string }> => {
    const discard = async () => {
      await ctx.storage.delete(storageId).catch(() => undefined);
    };

    let owner: string;
    try {
      owner = await ctx.runQuery(internal.builtAgents.iconUploader, { sessionToken });
    } catch (cause) {
      await discard();
      throw cause;
    }

    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new ConvexError("That upload is gone. Pick the image again.");
    if (blob.size > MAX_ICON_UPLOAD_BYTES) {
      await discard();
      throw new ConvexError(`That image is ${(blob.size / 1024 / 1024).toFixed(1)} MB. Icons can be at most 2 MB.`);
    }

    const bytes = Buffer.from(await blob.arrayBuffer());
    await discard();

    const kind = sniffIconType(bytes.subarray(0, 16));
    if (!kind) throw new ConvexError("Icons must be PNG or JPEG images. That file is not one, whatever its name says.");

    let image: Awaited<ReturnType<typeof Jimp.read>>;
    try {
      image = await Jimp.read(bytes);
    } catch {
      throw new ConvexError("That file starts like an image but is not a valid one. Export it again as PNG or JPEG.");
    }

    const { width, height } = image.bitmap;
    if (width < MIN_ICON_SIDE || height < MIN_ICON_SIDE) {
      throw new ConvexError(`That image is ${width}×${height}. Icons need to be at least ${MIN_ICON_SIDE}×${MIN_ICON_SIDE}.`);
    }
    if (width > MAX_ICON_SIDE || height > MAX_ICON_SIDE) {
      throw new ConvexError(`That image is ${width}×${height}. Icons can be at most ${MAX_ICON_SIDE}×${MAX_ICON_SIDE}.`);
    }

    let transparent = false;
    const pixels = image.bitmap.data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 255) {
        transparent = true;
        break;
      }
    }

    const side = transparent ? STORED_PNG_SIDE : STORED_JPEG_SIDE;
    image.cover({ w: side, h: side });
    const contentType = transparent ? "image/png" : "image/jpeg";
    const output = transparent
      ? await image.getBuffer("image/png")
      : await image.getBuffer("image/jpeg", { quality: STORED_JPEG_QUALITY });

    const iconId = await ctx.storage.store(new Blob([new Uint8Array(output)], { type: contentType }));
    await ctx.runMutation(internal.builtAgents.recordIcon, {
      storageId: iconId,
      ownerAddress: owner,
      contentType,
      width: side,
      height: side,
      bytes: output.length,
    });
    return { iconId, url: await ctx.storage.getUrl(iconId), contentType };
  },
});

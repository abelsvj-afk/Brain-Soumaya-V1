/**
 * The Book's pictures (docs/specs/living-worlds-dialogue-2026-10-31.md S5): a painting beside an entry, shown ONLY once the entry is found. Web-sized copies (1024 px WebP, a few
 * dozen KB each) of the canon picks in docs/lore/art/ — the originals stay in the repo, out of the Docker image. Only pictures the owner/Claude approved by eye are listed; an entry
 * with none simply shows words. `alt` describes what is painted, never what it means.
 */
export const STORY_ART: Readonly<Record<string, { src: string; alt: string }>> = {
  "obj.sleepwalkers-lantern": { src: "/lore/obj.sleepwalkers-lantern.webp", alt: "A woman in a pale nightgown walks a misty harbor pier at dusk, holding a dark glass lantern in both hands." },
  "companion.dock-1": { src: "/lore/companion.dock-1.webp", alt: "A traveller sits on a crate on a night dock; a stranger's hand, in a brown cloak, holds out a flask beside two cups." },
  "sight.blank-nameplate": { src: "/lore/sight.blank-nameplate.webp", alt: "A sleek blue-white ship with a violet edge and a single blank rectangular plate on its flank." },
  "sight.lullaby-hollow": { src: "/lore/sight.lullaby-hollow.webp", alt: "A pale ship shaped like a swan with its neck curved, a long hollow along its side and petal-shaped vanes." },
};

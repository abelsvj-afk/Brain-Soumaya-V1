# Muse task — lore image prompts: pull, sort, and (if you can) generate

*Owner request (2026-10-30): "delegate to Muse … pull the prompts for the image generation so I can take them and generate the images … if Muse can't generate images, I have another bot that can." Mechanical + docs work: Muse's lane. There is no MCP bridge — the owner hands this over.*

## Source
`docs/lore/IMAGE_PROMPTS.md` — 36 prompts, numbered §1–36 (core §1–11, Act II §12–20, Draft 3 §21–27, Draft 4 §28–36). The **Global style** and **Global negative** blocks at the top apply to every prompt.

## Do (docs only; text files push fine through the connector)
1. Create `docs/lore/art/PROMPT_SHEET.md`: for each prompt, one block with **number, title, aspect ratio, and the full paste-ready text** (global style already merged into the prompt body; the negative block on its own line labelled `NEGATIVE:`). One block per prompt, no commentary, no edits to the wording.
2. In the same file put a **priority order** for generating (suggested: 1, 3, 6, 7, 28, 31 first — key art and the three most story-defining scenes; then the portraits/ships; then the rest) and a one-line note per prompt on what it needs to *not* look like (e.g. "no halo copied from a religion", "Vesh's chest gap must be clean, no gore").
3. Create `docs/lore/art/README.md` stating the **naming convention** for returned images: `NN-short-title-vK.png` (K = variant 1–4), and where they live (`docs/lore/art/`).

## If Muse can generate images
Generate 3–4 variants of each in priority order, keep the ones that look like the **same universe** (indigo-black space, warm gold + pale cyan accents, painterly, no text), and report which look consistent. Do **not** push binaries through the connector (it is text-only) — hand the images to the owner to upload on the GitHub website into `docs/lore/art/`.

## If Muse cannot
Say so plainly and stop after step 3 — the owner has another generator and will use the sheet.

## Do NOT
- Rewrite, improve or soften the prompts (they are specific on purpose; Claude owns them).
- Add real-world religious iconography to any prompt.
- Touch code, `LORE_CANON.md`, or any draft.
- Present a guess as a finding: report which prompts were generated, which were not, and why.

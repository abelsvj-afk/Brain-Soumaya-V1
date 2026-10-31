import { useEffect, useState } from "react";
import { getFoldChoice, putFoldChoice, type FoldChoice as Choice } from "../api/story.js";

/**
 * The Folded Letter's one choice (docs/specs/seam-the-folded-letter-2026-10-31.md §Choice). Shown inside the letter's "Look closely" card: keep it folded, or open it. Opening asks once more and cannot be undone;
 * keeping is not final. Whichever is chosen, the words are never shown — this screen says only that it was read, by you, and that the room will not say what it said or whether it was kind. Nothing is counted,
 * scored or rewarded, and the door stays open. The server stores only which was chosen, never any text.
 */
type Stage = "loading" | "choose" | "confirm" | "kept" | "opened" | "trouble";

export const FOLD_LINES = {
  choose: "You may open it. Nothing here will say what it reads, or whether it is kind, or ask you to.",
  confirm: "It will be read once, by you, and cannot be unread. The room will not say what it says.",
  kept: "You leave it folded. Somewhere near, someone lets out a breath they had been holding. You may open it later, or never.",
  opened: "You read it. It is one sentence, and it is yours. The room does not keep it and will not say what it said, or whether it was kind.",
  keeper: { kept: "From the seat by the door: “Thank you. That was the thing I needed most.”", opened: "From the seat by the door: nothing is asked. A kettle is put on." },
  door: "The door is still ajar.",
  trouble: "The room is quiet just now. Try again in a moment.",
} as const;

export default function FoldChoice() {
  const [stage, setStage] = useState<Stage>("loading");
  useEffect(() => {
    let live = true;
    void getFoldChoice().then((c) => {
      if (live) setStage(c ?? "choose");
    });
    return () => {
      live = false;
    };
  }, []);
  const choose = async (value: Choice) => {
    const got = await putFoldChoice(value);
    setStage(got ?? "trouble");
  };
  if (stage === "loading") return null;
  return (
    <div className="fold-choice" aria-live="polite">
      {stage === "choose" && (
        <>
          <p>{FOLD_LINES.choose}</p>
          <div className="fold-choice-row">
            <button type="button" className="fold-choice-btn" onClick={() => void choose("kept")}>
              Keep it folded
            </button>
            <button type="button" className="fold-choice-btn" onClick={() => setStage("confirm")}>
              Open it
            </button>
          </div>
        </>
      )}
      {stage === "confirm" && (
        <>
          <p>{FOLD_LINES.confirm}</p>
          <div className="fold-choice-row">
            <button type="button" className="fold-choice-btn" onClick={() => void choose("opened")}>
              Open it
            </button>
            <button type="button" className="fold-choice-btn" onClick={() => setStage("choose")}>
              Not yet
            </button>
          </div>
        </>
      )}
      {stage === "kept" && (
        <>
          <p>{FOLD_LINES.kept}</p>
          <p className="fold-choice-keeper">{FOLD_LINES.keeper.kept}</p>
          <div className="fold-choice-row">
            <button type="button" className="fold-choice-btn" onClick={() => setStage("confirm")}>
              Open it
            </button>
          </div>
        </>
      )}
      {stage === "opened" && (
        <>
          <p>{FOLD_LINES.opened}</p>
          <p className="fold-choice-keeper">{FOLD_LINES.keeper.opened}</p>
          <p>{FOLD_LINES.door}</p>
        </>
      )}
      {stage === "trouble" && (
        <>
          <p>{FOLD_LINES.trouble}</p>
          <div className="fold-choice-row">
            <button type="button" className="fold-choice-btn" onClick={() => setStage("choose")}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  );
}

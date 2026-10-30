import { STORY_LINES, lineView } from "@brain/shared";

/**
 * The seven Lines of keeping (docs/specs/story-lines-2026-10-31.md): who stood after whom. A person appears only once you have found something of theirs; two lit
 * people make the story join them with a thread, said in words. Nothing is counted, nothing is named before it is found, and a Line with no light shows only a shape.
 */
export default function BookLines({ found }: { found: ReadonlySet<string> }) {
  const views = STORY_LINES.map((l) => lineView(l, found));
  if (views.every((v) => v.lit.length === 0)) return null;
  return (
    <section className="book-lines" aria-label="Lines of keeping">
      <h3>Lines</h3>
      <ul>
        {views.map((v) => (
          <li key={v.id} className={v.lit.length === 0 ? "is-dark" : v.thread ? "is-joined" : "is-lit"}>
            {v.lit.length === 0 ? (
              <span className="book-line-title">◌ A Line not yet seen</span>
            ) : (
              <>
                <span className="book-line-title">{v.thread ? "◉" : "●"} {v.title}</span>
                <span className="book-line-people">{v.lit.join(" · ")}</span>
                {v.thread && <span className="book-line-thread">The story joins them.</span>}
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

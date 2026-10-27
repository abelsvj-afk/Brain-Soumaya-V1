import { enterLiteMode } from "../App.helpers.js";

/**
 * Batch I — GH-01 (REG-060): the galaxy error card. A device that cannot
 * render WebGL loops on Reload otherwise — the card must offer the Lite
 * escape that exists for exactly this failure: open the app without the
 * 3D galaxy. Reuses the `.galaxy-off-note.galaxy-err` / `.lite-escape`
 * classes the loading screen already styles.
 */
export function GalaxyErrorCard({ onReload }: { onReload: () => void }) {
  return (
    <div className="galaxy-off-note galaxy-err" role="alert">
      <div className="galaxy-off-title">The 3D galaxy hit an error</div>
      <p className="galaxy-off-copy">
        Your brain is safe — only the 3D view failed. Reloading usually fixes
        it; if your device can&apos;t run the 3D galaxy, you can open the app
        without it instead.
      </p>
      <div className="galaxy-off-actions">
        <button type="button" className="lite-escape" onClick={onReload}>
          Reload
        </button>
        <button type="button" className="lite-escape" onClick={() => enterLiteMode()}>
          Open without the 3D galaxy
        </button>
      </div>
    </div>
  );
}

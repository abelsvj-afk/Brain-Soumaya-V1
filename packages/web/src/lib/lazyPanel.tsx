import { Suspense, lazy, type ComponentProps, type ComponentType } from "react";

/**
 * Load a rarely used component on demand (speed audit S2): the entry bundle no longer carries every panel and the whole
 * worlds layer, so the first screen parses less. Each wrapped component brings its own Suspense boundary (fallback: nothing
 * — panels already render their own loading states), so call sites stay exactly as they were, with the same prop types.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPanel<T extends ComponentType<any>>(load: () => Promise<T>): T {
  const Lazy = lazy(async () => ({ default: await load() }));
  const Wrapped = (props: ComponentProps<T>) => (
    <Suspense fallback={null}>
      <Lazy {...props} />
    </Suspense>
  );
  return Wrapped as unknown as T;
}

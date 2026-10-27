import "@/app/components/board/board.css";

/**
 * Loads the scoped Board Mode theme. The styles hang off `.bp-root`, which
 * `BoardMode` renders, so nothing here reaches any other route.
 */
export default function BoardLayout({ children }: { children: React.ReactNode }) {
  return children;
}

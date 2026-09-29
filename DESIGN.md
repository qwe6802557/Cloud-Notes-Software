# Design System: 云笔记「文件暂存」跨端传输看板 (File Stash)

## 1. Visual Theme & Atmosphere
A restrained, daily-app balanced file transfer and stash workspace with confident asymmetric layouts and fluid spring-physics transitions. The atmosphere is tactile, clean, and utilitarian — prioritizing instant clarity of file lifecycles, unambiguous storage partitioning, and effortless cross-device delivery between PC and mobile clients.
- **Density:** Daily App Balanced (5/10)
- **Variance:** Offset Asymmetric (6/10)
- **Motion:** Fluid CSS with Spring Physics (6/10)

## 2. Color Palette & Roles
- **Canvas Neutral** (`#F8FAFC`) — Primary background surface for PC stash content area and mobile tab body
- **Pure Surface** (`#FFFFFF`) — Card containers, drag-and-drop dropzones, and elevated sheets
- **Deep Slate Ink** (`#0F172A`) — Primary text, file names, headings, and high-emphasis metadata
- **Muted Zinc** (`#64748B`) — Secondary text, file sizes, creation timestamps, and empty-state descriptions
- **Whisper Border** (`#E2E8F0`) — Card outlines, tab dividers, and 1px structural separators
- **Dropzone Hover Border** (`#93C5FD`) — Dashed hover feedback for upload zones
- **Brand Accent Blue** (`#1890FF`) — Single primary accent for primary CTAs, active tab indicators, and progress bars
- **Urgent Amber** (`#D97706`) — Temporary file badge background, 10-minute active timer indicator
- **Critical Crimson** (`#DC2626`) — Sub-60s expiration countdown alert, file deletion confirm buttons
- **Emerald Mint** (`#059669`) — Permanent file badge, copy link success feedback

*(Strict Constraint: Maximum 1 primary brand accent `#1890FF`. No neon glowing buttons, no purple/pink AI gradients, no pure black `#000000`)*

## 3. Typography Rules
- **Display / Section Titles:** System Chinese Display (`-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif`) — Track-tight, controlled scale (18px ~ 22px), weight-driven hierarchy (600/700).
- **Body & Filenames:** System Sans (`14px` ~ `15px`), relaxed leading (`1.5`), truncated with ellipsis for extra-long filenames while preserving file extensions.
- **Monospace Metadata & Timers:** `SFMono-Regular, Consolas, "Liberation Mono", Menlo, Courier, monospace` — Exclusively used for 10-minute real-time countdowns (`MM:SS`), file byte sizes (`42.8 MB`), and download hash fragments.
- **Banned:** Generic serif fonts in UI, Inter, all decorative novelty fonts.

## 4. Component Stylings
- **Upload Dropzone (PC):**
  - Border: 2px dashed `#CBD5E1`, smooth transition to `#1890FF` on drag-over.
  - Fill: `#F8FAFC` idle, `#EFF6FF` on hover/dragover.
  - Tactile feedback: cursor pointer, subtle 1px elevation lift on drag enter.
  - Empty state: clean SVG cloud-upload illustration with dual-action trigger ("拖拽文件至此处，或点击浏览选择").
- **Partition Tabs (临时文件 / 永久文件):**
  - Segmented pill design or clean bottom-border tab indicator.
  - Temporary tab displays an active count badge with warm amber dot.
  - Permanent tab displays total count and storage summary.
- **File Card / Table Row:**
  - Shape: Generously rounded corners (12px on PC, 14px on mobile).
  - File Icon: Distinctive, semantic icon chips based on MIME type (Image = Blue, Document = Orange, Archive = Purple, Video = Red, Code = Slate).
  - Countdown Chip (Temporary files): Pill badge containing pulsing dot (`#D97706` -> `#DC2626` when `< 60s`) + Monospace countdown (`剩余 08:35`).
  - Action Cluster: Flat ghost buttons with subtle hover backgrounds (`#F1F5F9`). Includes: [直接下载], [复制链接], [转为永久] (临时文件专享), [删除].
- **Mobile Action Sheet & Cards:**
  - Card touch target minimum `56px` height.
  - Bottom sheet for dual upload channels: [从手机相册选取] vs [从手机系统文件选取].
  - Inline progress indicator for active uploads (0% ~ 100%).

## 5. Layout Principles
- **PC Layout:**
  - Integrated into main shell: Left sidebar item in `SYSTEM_VIEWS` triggers active view mode `stash`.
  - Main viewport: Top header with title + storage stats, upper section with responsive drag-and-drop zone, lower section with tabbed file collection.
  - Max-width containment: Up to 1280px with generous 24px padding, single scroll container.
- **Mobile Layout:**
  - Dedicated 4th tab in bottom navigation (`(tabs)/stash.tsx`).
  - Sticky top segmented control for [临时文件 (10分钟)] and [永久文件].
  - Sticky floating action button (FAB) or top upload button triggering dual-channel file picker.
  - Strict single-column layout, zero horizontal overflow.

## 6. Motion & Interaction
- **Spring Physics:** `stiffness: 120, damping: 18` for tab switching and card reveal.
- **Countdown Tick:** 1-second interval timer driving sub-60s subtle pulse animation.
- **Auto-Expiration Exit:** When a temporary file reaches `00:00`, it triggers an exit fade-out + height collapse (`opacity: 0, height: 0, 300ms ease-out`) and unmounts from list.
- **Hardware Acceleration:** All animations strictly operate on `transform` and `opacity`.

## 7. Anti-Patterns (Banned)
- No emojis anywhere in the interface (use Lucide / Ant Design / Ionicons vectors).
- No pure black (`#000000`).
- No neon shadows or purple button glows.
- No AI copywriting clichés ("Elevate your files", "Seamless transfer").
- No circular generic spinners without context (use linear progress bar or skeletal rows).
- No blocking dialogs for normal file downloads.

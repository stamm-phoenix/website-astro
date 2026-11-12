/**
 * Browser storage key of the sidebar choice (`ausgeklappt` or `eingeklappt`), per device. Also
 * read by the inline script of StaffLayout, so the page shows the sidebar right from the start.
 */
export const SIDEBAR_KEY = 'phoenix:staff-sidebar:v1';

/** Shows the choice on the page at once and keeps it in this browser for the next page load. */
export function storeSidebarChoice(collapsed: boolean): void {
  const stored = collapsed ? 'eingeklappt' : 'ausgeklappt';
  document.documentElement.dataset.staffSidebar = stored;
  try {
    localStorage.setItem(SIDEBAR_KEY, stored);
  } catch {
    // Without browser storage the choice lasts until the next full page load
  }
}

/**
 * The name that slides out next to an icon of the folded sidebar while it is pointed at or has
 * the focus. Fixed on the page, because the scrolling sidebar would clip it.
 */
export interface SidebarFlyout {
  top: number;
  left: number;
  height: number;
  label: string;
  icon: string;
  current: boolean;
}

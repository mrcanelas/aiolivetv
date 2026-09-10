export interface Instance {
  /** Unique slug used for tab keys etc. */
  id: string;
  /** Display name */
  name: string;
  /** Handle / username of the host */
  hostedBy?: string;
  /** Profile / org URL for the host */
  hostedByUrl?: string;
  /** Short description shown in the tab body */
  description?: string;
  /** If set, rendered as a warning callout inside the tab */
  warning?: string;
  /**
   * Base URL for the stable channel (no trailing slash).
   * If only this is set, the instance is stable-only.
   */
  stable?: string;
  /**
   * Base URL for the nightly channel (no trailing slash).
   * If only this is set, the instance is nightly-only.
   */
  nightly?: string;
}

/** AIOLiveTV has no official or community public instances. */
export const instances: Instance[] = [];

/** Returns the primary (preferred) base URL for an instance — stable if available, otherwise nightly. */
export function getPrimaryUrl(instance: Instance): string {
  return instance.stable ?? instance.nightly!;
}

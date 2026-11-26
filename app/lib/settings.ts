/** Editable decision thresholds and projection/simulation assumptions (stored in app_settings). */

export interface Thresholds {
  /** Scale if CAC per visitor < scale_cac_ratio x median and volume is adequate. */
  scale_cac_ratio: number;
  /** Minimum attributed visitors (or registrations before the event) for "volume adequate". */
  min_volume: number;
  /** Stop if CAC per visitor > stop_cac_ratio x median ... */
  stop_cac_ratio: number;
  /** ... or show-up rate < stop_showup_ratio x median. */
  stop_showup_ratio: number;
  /** "Change" if CAC is fine but a stage conversion is below bad_stage_ratio x the overall rate. */
  bad_stage_ratio: number;
}

export interface ProjectionAssumptions {
  /** Days of registration pace used to extrapolate to the event start. */
  pace_window_days: number;
  /** Show-up rate range applied to projected registrations before any check-in data exists. */
  showup_low: number;
  showup_mid: number;
  showup_high: number;
  /** Walk-ins as a share of registered visitors (pre-event assumption). */
  walkin_ratio: number;
}

export interface SimulatorAssumptions {
  /** Days of recent spend/registrations used for marginal CAC. */
  window_days: number;
  /** Diminishing returns: extra spend's CAC rises by k x (added / recent spend). */
  diminishing_k: number;
}

export const DEFAULT_SETTINGS = {
  thresholds: {
    scale_cac_ratio: 0.8,
    min_volume: 100,
    stop_cac_ratio: 1.5,
    stop_showup_ratio: 0.6,
    bad_stage_ratio: 0.75,
  } satisfies Thresholds,
  projection: {
    pace_window_days: 14,
    showup_low: 0.6,
    showup_mid: 0.7,
    showup_high: 0.8,
    walkin_ratio: 0.05,
  } satisfies ProjectionAssumptions,
  simulator: {
    window_days: 28,
    diminishing_k: 0.5,
  } satisfies SimulatorAssumptions,
};

export type SettingsKey = keyof typeof DEFAULT_SETTINGS;
export type Settings = typeof DEFAULT_SETTINGS;

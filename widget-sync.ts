import { SuperappNative } from './modules/superapp-native';
import type { ScheduleEntry } from './schedule-data';

/** Hands the schedule to the Horario widget; a no-op outside the standalone build. */
export function syncScheduleWidget(entries: ScheduleEntry[]) {
  try {
    SuperappNative?.setWidgetSchedule(JSON.stringify(entries));
  } catch {
    // The widget keeps its previous copy.
  }
}
